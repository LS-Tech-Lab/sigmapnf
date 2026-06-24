// Carga de horarios desde un archivo Excel: validación de formato/tamaño,
// parseo, detección de duplicados e inserción de filas nuevas.
// Extraído de useAppData.js.

import { useState } from "react";
import { parseClase } from "../../utils/parsing";
import { parseExcelFile } from "../../utils/excelParser";
import { supabase } from "../../lib/supabase";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];

export default function useUpload({
  lapso, selectedPrograma, showToast, setError,
  fetchHorarios, fetchProgramas, fetchDocenteNames, fetchMateriaNames,
  setConflictsRefreshKey,
}) {
  const [uploading, setUploading] = useState(false);

  const UPLOAD_TIMEOUT_MS = 60_000; // 60 s — si la operación no resuelve, liberar la UI

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

    // Timeout de seguridad: si la operación cuelga (red caída, Supabase lento),
    // libera el estado uploading para no bloquear la UI indefinidamente.
    const timeoutId = setTimeout(() => {
      setUploading(false);
      setError("La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.");
      showToast("Tiempo de espera agotado. Verifica tu conexión.", "error");
    }, UPLOAD_TIMEOUT_MS);

    let allRows, advertencias;
    try {
      const resultado = await parseExcelFile(file, { lapso, selectedPrograma });
      allRows      = resultado.rows;
      advertencias = resultado.advertencias;
      if (advertencias.length > 0) {
        showToast(`${advertencias.join(" | ")}`, "warning");
      }
    } catch (err) {
      setError("Error al leer el archivo: " + err.message);
      showToast("Error al leer el archivo: " + err.message, "error");
      setUploading(false);
      return;
    }

    if (!allRows.length) {
      setError("No se encontraron datos válidos.");
      showToast("No se encontraron datos válidos en el archivo.", "warning");
      setUploading(false);
      return;
    }

    const sheetsEnArchivo    = [...new Set(allRows.map(r => r.sheet))];
    const programasEnArchivo = [...new Set(allRows.map(r => r.programa))];

    if (lapso) {
      const { error: partError } = await supabase.rpc("asegurar_particion_lapso", { p_lapso: lapso });
      if (partError) console.warn("asegurar_particion_lapso no disponible:", partError.message);
    }

    let dupQuery = supabase.from("horarios").select("sheet, dia, hora, clase, programa").in("sheet", sheetsEnArchivo).in("programa", programasEnArchivo);
    if (lapso) dupQuery = dupQuery.eq("lapso", lapso);
    const { data: existingData } = await dupQuery;
    const existingKeys = new Set(existingData?.map(r => `${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`) || []);
    const newRows = allRows.filter(r => !existingKeys.has(`${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`));

    if (!newRows.length) { showToast("Sin registros nuevos.", "warning"); setUploading(false); return; }

    const { error: insertError } = await supabase.from("horarios").insert(newRows);
    if (insertError) {
      showToast("Error al guardar.", "error");
      clearTimeout(timeoutId);
      setUploading(false);
      return;
    }
    showToast(`${newRows.length} clases cargadas.`, "success");
    await fetchHorarios(selectedPrograma);
    await fetchProgramas(lapso);
    const docs = new Set(), mats = new Set();
    newRows.forEach(r => { const { docente, materia } = parseClase(r.clase); if (docente) docs.add(docente); if (materia) mats.add(materia); });
    const docsArray = [...docs].map(d => ({ nombre_raw: d, nombre_display: d }));
    const matsArray = [...mats].map(m => ({ nombre_raw: m, nombre_display: m }));
    if (docsArray.length) await supabase.from("docentes").upsert(docsArray, { onConflict: "nombre_raw" });
    if (matsArray.length) await supabase.from("materias").upsert(matsArray, { onConflict: "nombre_raw" });
    await fetchDocenteNames();
    await fetchMateriaNames();
    setConflictsRefreshKey(k => k + 1);
    clearTimeout(timeoutId);
    setUploading(false);
  };

  return { uploading, setUploading, handleFileUpload };
}
