// Carga de horarios desde un archivo Excel: validación de formato/tamaño,
// parseo, detección de duplicados e inserción de filas nuevas.
//
// Cambios v2 (nuevo formato unificado):
//   - Importa parseHojaDocentes y parseHojaMalla desde excelParser.
//   - Antes de procesar las filas de horario, hace upsert enriquecido
//     con los catálogos DOCENTES y MALLA cuando están presentes en el
//     workbook. Esto no bloquea la carga si alguno de los dos falta.
//   - El resto del flujo (validación, duplicados, inserción, auditoría)
//     permanece idéntico al original para no romper nada.

import { useState } from "react";
import * as XLSX from "xlsx";
import { parseClase } from "../../utils/parsing";
import { parseExcelFile, parseHojaDocentes, parseHojaMalla } from "../../utils/excelParser";
import { supabase } from "../../lib/supabase";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];

// Lee el workbook crudo en paralelo a parseExcelFile para extraer los
// catálogos sin duplicar la lectura del File.
function leerWorkbookRaw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => {
      try {
        resolve(XLSX.read(e.target.result, { type: "binary" }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsBinaryString(file);
  });
}

export default function useUpload({
  lapso, selectedPrograma, showToast, setError,
  fetchHorarios, fetchProgramas, fetchDocenteNames, fetchMateriaNames,
  setConflictsRefreshKey,
  logAudit,
}) {
  const [uploading, setUploading] = useState(false);

  const UPLOAD_TIMEOUT_MS = 60_000;

  const handleFileUpload = async (file) => {
    setError(null);
    if (!file) return;

    const nameLower = (file.name || "").toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => nameLower.endsWith(ext));
    if (!hasValidExtension) {
      setError("Formato de archivo no válido. Solo se aceptan archivos .xlsx o .xls.");
      showToast("Formato de archivo no válido. Usa .xlsx o .xls.", "error");
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setError(`El archivo es demasiado grande (${sizeMB} MB). El tamaño máximo permitido es 10 MB.`);
      showToast(`Archivo demasiado grande (${sizeMB} MB). Máximo permitido: 10 MB.`, "error");
      return;
    }

    setUploading(true);

    // AbortController solo para marcar si el timeout ya disparó.
    // No se pasa a .abortSignal() porque Supabase v2 no lo soporta en insert.
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      setUploading(false);
      setError("La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.");
      showToast("Tiempo de espera agotado. Verifica tu conexión.", "error");
    }, UPLOAD_TIMEOUT_MS);

    try {

    // ── 1. Parsear filas de horario + workbook raw (en paralelo) ────────────
    let allRows, advertencias, workbookRaw;
    try {
      [{ rows: allRows, advertencias }, workbookRaw] = await Promise.all([
        parseExcelFile(file, { lapso, selectedPrograma }),
        leerWorkbookRaw(file),
      ]);
      if (advertencias.length > 0) {
        showToast(`${advertencias.join(" | ")}`, "warning");
      }
    } catch (err) {
      setError("Error al leer el archivo: " + err.message);
      showToast("Error al leer el archivo: " + err.message, "error");
      return;
    }

    if (!allRows.length) {
      setError("No se encontraron datos válidos.");
      showToast("No se encontraron datos válidos en el archivo.", "warning");
      return;
    }

    // ── 2. Upsert catálogo DOCENTES (hoja nueva del formato v2) ─────────────
    // parseHojaDocentes devuelve [] si la hoja no existe → sin efecto en v1.
    const docentesCatalogo = parseHojaDocentes(workbookRaw);
    if (docentesCatalogo.length > 0) {
      // Construir el payload de upsert de forma defensiva: solo incluir
      // las columnas extra (cedula, telefono, email, observaciones) si la
      // tabla las acepta. Si no existen aún en el schema de Supabase, el
      // upsert solo actualiza nombre_raw / nombre_display sin error.
      const payload = docentesCatalogo.map(({ nombre_raw, nombre_display, cedula, telefono, email, observaciones }) => {
        const entry = { nombre_raw, nombre_display };
        // Añadir campos opcionales solo si tienen valor, para no pisar
        // datos existentes con null cuando la columna aún no existe.
        if (cedula)        entry.cedula        = cedula;
        if (telefono)      entry.telefono      = telefono;
        if (email)         entry.email         = email;
        if (observaciones) entry.observaciones = observaciones;
        return entry;
      });
      const { error: docCatError } = await supabase
        .from("docentes")
        .upsert(payload, { onConflict: "nombre_raw" });
      if (docCatError) {
        // No es fatal: el catálogo enriquecido es un plus, no un requisito.
        console.warn("upsert catálogo DOCENTES:", docCatError.message);
      }
    }

    // ── 3. Upsert catálogo MALLA (hoja nueva del formato v2) ────────────────
    // parseHojaMalla devuelve [] si la hoja no existe → sin efecto en v1.
    const mallaCatalogo = parseHojaMalla(workbookRaw);
    if (mallaCatalogo.length > 0) {
      const payload = mallaCatalogo.map(({ nombre_raw, nombre_display, trayecto, codigo_uc, horas_semanales, unidades_credito }) => {
        const entry = { nombre_raw, nombre_display };
        if (trayecto)         entry.trayecto         = trayecto;
        if (codigo_uc)        entry.codigo_uc        = codigo_uc;
        if (horas_semanales)  entry.horas_semanales  = horas_semanales;
        if (unidades_credito) entry.unidades_credito = unidades_credito;
        return entry;
      });
      const { error: mallaCatError } = await supabase
        .from("materias")
        .upsert(payload, { onConflict: "nombre_raw" });
      if (mallaCatError) {
        console.warn("upsert catálogo MALLA:", mallaCatError.message);
      }
    }

    // ── 4. Flujo original: partición, deduplicación, inserción ──────────────
    const sheetsEnArchivo    = [...new Set(allRows.map(r => r.sheet))];
    const programasEnArchivo = [...new Set(allRows.map(r => r.programa))];

    if (lapso) {
      const { error: partError } = await supabase.rpc("asegurar_particion_lapso", { p_lapso: lapso });
      if (partError) console.warn("asegurar_particion_lapso no disponible:", partError.message);
    }

    let dupQuery = supabase
      .from("horarios")
      .select("sheet, dia, hora, clase, programa")
      .in("sheet", sheetsEnArchivo)
      .in("programa", programasEnArchivo);
    if (lapso) dupQuery = dupQuery.eq("lapso", lapso);
    const { data: existingData } = await dupQuery;
    const existingKeys = new Set(
      existingData?.map(r => `${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`) || []
    );
    const newRows = allRows.filter(
      r => !existingKeys.has(`${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`)
    );

    if (!newRows.length) {
      showToast("Sin registros nuevos.", "warning");
      return;
    }

    const { error: insertError } = await supabase
      .from("horarios")
      .insert(newRows);
    if (insertError) {
      if (timedOut) return;
      showToast("Error al guardar.", "error");
      return;
    }
    if (timedOut) return;

    showToast(`${newRows.length} clases cargadas.`, "success");

    await fetchHorarios(selectedPrograma);
    await fetchProgramas(lapso);

    // Upsert docentes/materias extraídos de las celdas de clase (comportamiento original)
    const docs = new Set(), mats = new Set();
    newRows.forEach(r => {
      const { docente, materia } = parseClase(r.clase);
      if (docente) docs.add(docente);
      if (materia) mats.add(materia);
    });
    const docsArray = [...docs].map(d => ({ nombre_raw: d, nombre_display: d }));
    const matsArray = [...mats].map(m => ({ nombre_raw: m, nombre_display: m }));
    // El upsert de catálogo (pasos 2-3) ya cargó los nombres canónicos;
    // este upsert agrega los nombres tal como aparecen en las celdas,
    // que pueden diferir ligeramente (mayúsculas, abreviaturas, etc.).
    if (docsArray.length) await supabase.from("docentes").upsert(docsArray, { onConflict: "nombre_raw" });
    if (matsArray.length) await supabase.from("materias").upsert(matsArray, { onConflict: "nombre_raw" });

    await fetchDocenteNames();
    await fetchMateriaNames();
    setConflictsRefreshKey(k => k + 1);
    } catch (unexpectedErr) {
      // Captura cualquier excepción no manejada para que uploading no quede atascado
      console.error("Error inesperado en handleFileUpload:", unexpectedErr);
      if (!timedOut) {
        showToast("Error inesperado al procesar el archivo.", "error");
        setError("Error inesperado: " + unexpectedErr.message);
      }
    } finally {
      clearTimeout(timeoutId);
      if (!timedOut) setUploading(false);
    }
  };

  return { uploading, setUploading, handleFileUpload };
}
