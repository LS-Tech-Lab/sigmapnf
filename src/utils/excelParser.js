// =====================================================================
// excelParser.js
//
// Formato v1 (original): hojas de horario con metadatos por hoja.
// Formato v2 (nuevo unificado): agrega hojas CONFIGURACIÓN, DOCENTES,
//   MALLA, INSTRUCCIONES, LISTA y plantillas BASE DIURNO / BASE VESP.
//
// Cambios v2:
//   1. HOJAS_IGNORADAS_SILENCIO — hojas conocidas del nuevo formato que
//      no son de horario; se saltan sin emitir advertencia al usuario.
//   2. parseHojaConfiguracion — lee la hoja CONFIGURACIÓN centralizada
//      y devuelve { sede, programa, trimestre, año } como fallback para
//      todas las hojas de horario que no repitan esos datos.
//   3. META_CAMPOS — agrega alias en mayúsculas para las etiquetas que
//      el nuevo formato escribe en caps (SEDE, SECCIÓN, TURNO, etc.).
//   4. parseHojaDocentes — lee el catálogo DOCENTES estructurado y
//      devuelve un array listo para upsert en la tabla `docentes`.
//   5. parseHojaMalla — lee el catálogo MALLA curricular y devuelve
//      un array listo para upsert en la tabla `materias`.
//
// Todo lo anterior es retrocompatible: los workbooks v1 sin esas hojas
// siguen funcionando exactamente igual.
// =====================================================================

import * as XLSX from "xlsx";
import { getTurnoByCodigo, normalizeTurno } from "./turno";
import { normalizarPrograma } from "./parsing";

export const TEMPLATE_VERSION = 2;

const DIAS_VALIDOS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];

// ── Hojas que se saltan silenciosamente (sin añadir a rechazadas) ────────────
// Incluye hojas fijas del nuevo formato y el prefijo "BASE " para plantillas.
const HOJAS_IGNORADAS_SILENCIO = new Set([
  "LISTA",
  "INSTRUCCIONES",
  "CONFIGURACIÓN",
  "CONFIGURACION",
  "DOCENTES",
  "MALLA",
]);

function esHojaIgnorada(nombre) {
  const upper = nombre.toUpperCase().trim();
  if (HOJAS_IGNORADAS_SILENCIO.has(upper)) return true;
  if (upper.startsWith("BASE ") || upper.startsWith("BASE_")) return true;
  return false;
}

// ── Campos de metadatos con alias v1 y v2 ───────────────────────────────────
const META_CAMPOS = [
  { campo: "programa",  etiquetas: ["PROGRAMA"] },
  { campo: "trayecto",  etiquetas: ["TRAYECTO"] },
  // v1: "Sede:" — v2: "SEDE"
  { campo: "sede",      etiquetas: ["Sede:", "SEDE"] },
  { campo: "aula",      etiquetas: ["AULA"] },
  // v1: "Sección" — v2: "SECCIÓN" / sin tilde
  { campo: "seccion",   etiquetas: ["Sección", "SECCIÓN", "SECCION"] },
  // v1: "Turno" — v2: "TURNO"
  { campo: "turno",     etiquetas: ["Turno", "TURNO"] },
];

// ── Helpers internos ─────────────────────────────────────────────────────────

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

// ── Hoja CONFIGURACIÓN — datos globales del archivo (nuevo formato) ──────────
// Devuelve { sede, programa, trimestre, año } para usar como fallback
// en hojas de horario que no repitan esos campos individualmente.
// Si la hoja no existe o no tiene los campos, devuelve un objeto vacío.
export function parseHojaConfiguracion(workbook) {
  const config = { sede: "", programa: "", trimestre: "", año: "" };

  // Busca la hoja con y sin tilde para ser robusto
  const ws =
    workbook.Sheets["CONFIGURACIÓN"] ||
    workbook.Sheets["CONFIGURACION"] ||
    null;
  if (!ws) return config;

  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const CAMPOS_CONFIG = [
    { campo: "sede",       etiquetas: ["Sede:", "SEDE"] },
    { campo: "programa",   etiquetas: ["Programa:", "PROGRAMA"] },
    { campo: "trimestre",  etiquetas: ["Trimestre académico:", "TRIMESTRE", "Trimestre:"] },
    { campo: "año",        etiquetas: ["Año:", "AÑO", "Año"] },
  ];

  for (const row of json) {
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cv = row[j]?.toString().trim();
      if (!cv) continue;
      for (const { campo, etiquetas } of CAMPOS_CONFIG) {
        if (config[campo]) continue;
        if (etiquetas.includes(cv)) {
          config[campo] =
            row[j + 1]?.toString().trim() ||
            row[j + 2]?.toString().trim() ||
            "";
        }
      }
    }
  }
  return config;
}

// ── Hoja DOCENTES — catálogo estructurado (nuevo formato) ───────────────────
// Columnas esperadas: ID | Apellidos y Nombres | Cédula | Teléfono | Email | Observaciones
// Devuelve array de objetos listos para upsert en tabla `docentes`.
// Si la hoja no existe, devuelve [].
export function parseHojaDocentes(workbook) {
  const ws = workbook.Sheets["DOCENTES"];
  if (!ws) return [];

  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Buscar la fila de encabezado que contenga "Apellidos y Nombres"
  let headerIdx = -1;
  let colNombre = -1, colCedula = -1, colTelefono = -1, colEmail = -1, colObs = -1;

  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    const idx = row.findIndex(
      (c) => c?.toString().trim().toLowerCase().includes("apellidos")
    );
    if (idx !== -1) {
      headerIdx  = i;
      colNombre  = idx;
      // Mapear el resto de columnas por nombre
      row.forEach((c, j) => {
        const label = c?.toString().trim().toLowerCase();
        if (label.includes("cédula") || label === "cedula")      colCedula   = j;
        if (label.includes("teléfono") || label === "telefono")  colTelefono = j;
        if (label.includes("email") || label.includes("correo")) colEmail    = j;
        if (label.includes("observ"))                            colObs      = j;
      });
      break;
    }
  }

  if (headerIdx === -1 || colNombre === -1) return [];

  const docentes = [];
  for (let i = headerIdx + 1; i < json.length; i++) {
    const row = json[i];
    if (!row) continue;
    const nombre = row[colNombre]?.toString().trim();
    if (!nombre) continue;

    docentes.push({
      nombre_raw:     nombre,
      nombre_display: nombre,
      cedula:         colCedula   >= 0 ? row[colCedula]?.toString().trim()   || null : null,
      telefono:       colTelefono >= 0 ? row[colTelefono]?.toString().trim() || null : null,
      email:          colEmail    >= 0 ? row[colEmail]?.toString().trim()    || null : null,
      observaciones:  colObs      >= 0 ? row[colObs]?.toString().trim()      || null : null,
    });
  }
  return docentes;
}

// ── Hoja MALLA — catálogo curricular (nuevo formato) ────────────────────────
// Columnas esperadas: ID | Unidad Curricular | Trayecto | Código UC |
//                    Horas Semanales | Unidades de Crédito | ...
// Devuelve array de objetos listos para upsert en tabla `materias`.
// Si la hoja no existe, devuelve [].
export function parseHojaMalla(workbook) {
  const ws = workbook.Sheets["MALLA"];
  if (!ws) return [];

  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Buscar fila de encabezado con "Unidad Curricular"
  let headerIdx = -1;
  let colNombre = -1, colTrayecto = -1, colCodigo = -1, colHoras = -1, colCreditos = -1;

  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    const idx = row.findIndex(
      (c) => c?.toString().trim().toLowerCase().includes("unidad curricular")
    );
    if (idx !== -1) {
      headerIdx  = i;
      colNombre  = idx;
      row.forEach((c, j) => {
        const label = c?.toString().trim().toLowerCase();
        if (label === "trayecto")                                      colTrayecto = j;
        if (label.includes("código uc") || label.includes("codigo"))  colCodigo   = j;
        if (label.includes("horas"))                                   colHoras    = j;
        if (label.includes("crédito") || label.includes("credito"))   colCreditos = j;
      });
      break;
    }
  }

  if (headerIdx === -1 || colNombre === -1) return [];

  const materias = [];
  for (let i = headerIdx + 1; i < json.length; i++) {
    const row = json[i];
    if (!row) continue;
    const nombre = row[colNombre]?.toString().trim();
    if (!nombre) continue;

    materias.push({
      nombre_raw:        nombre,
      nombre_display:    nombre,
      trayecto:          colTrayecto >= 0 ? row[colTrayecto]?.toString().trim()  || null : null,
      codigo_uc:         colCodigo   >= 0 ? row[colCodigo]?.toString().trim()    || null : null,
      horas_semanales:   colHoras    >= 0 ? row[colHoras]?.toString().trim()     || null : null,
      unidades_credito:  colCreditos >= 0 ? row[colCreditos]?.toString().trim()  || null : null,
    });
  }
  return materias;
}

// ── Función principal ────────────────────────────────────────────────────────
export async function parseExcelFile(file, { lapso = null, selectedPrograma = "todos" } = {}) {
  const binaryStr = await leerArchivo(file);
  const workbook  = XLSX.read(binaryStr, { type: "binary" });

  const rows         = [];
  const rechazadas   = [];
  const advertencias = [];

  // Leer configuración global centralizada (nuevo formato).
  // En workbooks v1 sin hoja CONFIGURACIÓN esto devuelve campos vacíos
  // y el fallback no altera el comportamiento original.
  const configGlobal = parseHojaConfiguracion(workbook);

  for (const sheetName of workbook.SheetNames) {
    // Saltar silenciosamente hojas conocidas que no son de horario
    if (esHojaIgnorada(sheetName)) continue;

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

    // Fallback: si la hoja no repite los campos, usa los de CONFIGURACIÓN
    const sedeEfectiva     = meta.sede     || configGlobal.sede     || "";
    const programaMeta     = meta.programa || configGlobal.programa || "";

    const programaFinal =
      selectedPrograma !== "todos"
        ? selectedPrograma
        : programaMeta
          ? normalizarPrograma(programaMeta) || programaMeta
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
          sede:     sedeEfectiva,
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
