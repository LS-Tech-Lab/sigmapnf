// =====================================================================
// excelParser.js — Mejora 1: parsing del Excel desacoplado del estado
//
// Antes: toda la lógica de detección de encabezados, merges y columnas
// vivía dentro de reader.onload en useAppData.js, mezclada con llamadas
// a setUploading, showToast y supabase. Imposible testear sin montar
// el hook completo.
//
// Ahora: función pura parseExcelFile(file, opciones) que:
//   1. Lee el archivo con FileReader (devuelve Promise).
//   2. Itera hojas, detecta encabezados y merges, extrae filas.
//   3. Devuelve { rows, rechazadas, advertencias } — sin side effects.
//
// useAppData importa parseExcelFile y solo se ocupa de persistir el
// resultado en Supabase. Esto permite:
//   - Testear el parser con Vitest pasando un Buffer de un .xlsx fijo.
//   - Versionar el esquema de plantilla (TEMPLATE_VERSION) y rechazar
//     archivos con formato incompatible con un mensaje claro.
//   - Reusar la lógica desde un script de migración o Edge Function.
//
// Esquema de plantilla esperado (v1):
//   - Fila de encabezado contiene celda "HORA" y al menos un día
//     (LUNES…VIERNES).
//   - Filas previas al encabezado contienen metadatos:
//     PROGRAMA, TRAYECTO, Sede:, AULA, Sección, Turno.
//   - Las celdas de clase pueden estar mergeadas verticalmente para
//     indicar bloques de más de un lapso.
// =====================================================================

import * as XLSX from "xlsx";
import { getTurnoByCodigo, normalizeTurno } from "./turno";
import { normalizarPrograma } from "./parsing";

export const TEMPLATE_VERSION = 1;

const DIAS_VALIDOS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];

const META_CAMPOS = [
  { campo: "programa",  etiquetas: ["PROGRAMA"] },
  { campo: "trayecto",  etiquetas: ["TRAYECTO"] },
  { campo: "sede",      etiquetas: ["Sede:"] },
  { campo: "aula",      etiquetas: ["AULA"] },
  { campo: "seccion",   etiquetas: ["Sección"] },
  { campo: "turno",     etiquetas: ["Turno"] },
];

function leerArchivo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = ()  => reject(new Error("No se pudo leer el archivo."));
    reader.readAsBinaryString(file);
  });
}

function construirMergeMap(worksheet) {
  const merges   = worksheet["!merges"] || [];
  const mergeMap = {};
  merges.forEach((m) => {
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        mergeMap[`${r}-${c}`] = { sr: m.s.r, er: m.e.r, sc: m.s.c, ec: m.e.c };
      }
    }
  });
  return mergeMap;
}

function detectarEncabezado(json) {
  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    if (!row) continue;
    const horaIdx = row.findIndex(
      (cell) => cell?.toString().trim().toUpperCase() === "HORA"
    );
    if (horaIdx === -1) continue;

    const diaCols = {};
    DIAS_VALIDOS.forEach((dia) => { diaCols[dia] = -1; });

    for (let j = 0; j < row.length; j++) {
      const cell = row[j]?.toString().toUpperCase().trim();
      if (DIAS_VALIDOS.includes(cell)) diaCols[cell] = j;
    }

    const diasEncontrados = DIAS_VALIDOS.filter((d) => diaCols[d] !== -1);
    if (diasEncontrados.length === 0) continue;

    return { headerRowIdx: i, horaColIdx: horaIdx, diaCols };
  }
  return null;
}

function extraerMetadatos(json, headerRowIdx) {
  const meta = { programa: "", trayecto: "", sede: "", aula: "", seccion: "", turno: "" };

  for (let i = 0; i < headerRowIdx; i++) {
    const row = json[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cv = row[j]?.toString().trim();
      if (!cv) continue;
      for (const { campo, etiquetas } of META_CAMPOS) {
        if (meta[campo]) continue;
        if (etiquetas.includes(cv)) {
          meta[campo] =
            row[j + 1]?.toString().trim() ||
            row[j + 2]?.toString().trim() ||
            "";
        }
      }
    }
  }
  return meta;
}

function calcularHora(json, rowIdx, horaColIdx, merge) {
  if (!merge) {
    return json[rowIdx][horaColIdx]?.toString().trim() || "";
  }
  const primeraFila = json[merge.sr];
  const ultimaFila  = json[merge.er];
  const hi = primeraFila[horaColIdx]?.toString().trim().split(/[-–]/)[0]?.trim();
  const partesFinal = ultimaFila[horaColIdx]?.toString().trim().split(/[-–]/);
  const hf = partesFinal[1]?.trim() || partesFinal[0]?.trim();
  return hf ? `${hi} - ${hf}` : hi || "";
}

export async function parseExcelFile(file, { lapso = null, selectedPrograma = "todos" } = {}) {
  const binaryStr = await leerArchivo(file);
  const workbook  = XLSX.read(binaryStr, { type: "binary" });

  const rows         = [];
  const rechazadas   = [];
  const advertencias = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const json      = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    const encabezado = detectarEncabezado(json);
    if (!encabezado) {
      rechazadas.push({ hoja: sheetName, razon: "No se encontró columna HORA con al menos un día." });
      continue;
    }
    const { headerRowIdx, horaColIdx, diaCols } = encabezado;

    const meta     = extraerMetadatos(json, headerRowIdx);
    const mergeMap = construirMergeMap(worksheet);

    const programaFinal =
      selectedPrograma !== "todos"
        ? selectedPrograma
        : meta.programa
          ? normalizarPrograma(meta.programa) || meta.programa
          : "Sin programa";

    const turnoFinal =
      getTurnoByCodigo(sheetName) ||
      normalizeTurno(meta.turno)  ||
      meta.turno;

    const processedMerges = new Set();

    for (let i = headerRowIdx + 1; i < json.length; i++) {
      const row = json[i];
      if (!row) continue;

      for (const [dia, colIdx] of Object.entries(diaCols)) {
        if (colIdx === -1) continue;

        const clase = row[colIdx]?.toString().trim();
        if (!clase) continue;

        const merge = mergeMap[`${i}-${colIdx}`] || null;

        if (merge && processedMerges.has(`${merge.sr}-${merge.sc}`)) continue;
        if (merge) processedMerges.add(`${merge.sr}-${merge.sc}`);

        const horaCompleta = calcularHora(json, i, horaColIdx, merge);
        if (!horaCompleta) continue;

        rows.push({
          sheet:    sheetName,
          programa: programaFinal,
          trayecto: meta.trayecto,
          seccion:  meta.seccion,
          turno:    turnoFinal,
          sede:     meta.sede,
          aula:     meta.aula || null,
          dia,
          hora:     horaCompleta,
          clase,
          lapso:    lapso || null,
        });
      }
    }
  }

  if (rechazadas.length > 0) {
    advertencias.push(
      `${rechazadas.length} hoja(s) no reconocida(s): ${rechazadas.map((r) => r.hoja).join(", ")}`
    );
  }

  return { rows, rechazadas, advertencias };
}
