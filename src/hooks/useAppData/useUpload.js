// Carga de horarios desde un archivo Excel: validación de formato/tamaño,
// parseo, detección de duplicados e inserción de filas nuevas.
//
// Flujo v3 (vista previa antes de confirmar):
//   1. Leer workbook raw → extraer catálogos
//   2. Parsear Excel con catálogo disponible (docente resuelto en el parseo)
//   3. Detectar duplicados
//   4. Abrir UploadPreviewModal con { rows, newRows, duplicados, advertencias,
//      docentesCatalogo, mallaCatalogo }
//   5. El usuario confirma → insertRows() hace la inserción real
//      El usuario cancela → limpiar estado, nada se guarda

import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { parseExcelFile, parseHojaDocentes, parseHojaMalla } from "../../utils/excelParser";
import { supabase } from "../../lib/supabase";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];
const UPLOAD_TIMEOUT_MS  = 60_000;

function leerWorkbookRaw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => {
      try { resolve(XLSX.read(e.target.result, { type: "binary" })); }
      catch (err) { reject(err); }
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
  const [uploading, setUploading]         = useState(false);
  // Estado del modal de vista previa
  const [previewData, setPreviewData]     = useState(null);   // null = cerrado
  // Guardamos la función que ejecuta la inserción real hasta que el usuario confirme
  const [pendingInsert, setPendingInsert] = useState(null);

  // ── Cancelar desde el modal ──────────────────────────────────────────
  const cancelPreview = useCallback(() => {
    setPreviewData(null);
    setPendingInsert(null);
    setUploading(false);
  }, []);

  // ── Confirmar desde el modal → ejecutar inserción ────────────────────
  const confirmPreview = useCallback(async () => {
    if (!pendingInsert) return;
    setPreviewData(null);  // cierra el modal de inmediato
    await pendingInsert();
    setPendingInsert(null);
  }, [pendingInsert]);

  // ── Entrada: el usuario selecciona el archivo ────────────────────────
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

    try {
      // ── 1. Leer workbook raw primero para tener el catálogo disponible ──
      let workbookRaw;
      try {
        workbookRaw = await leerWorkbookRaw(file);
      } catch (err) {
        setError("Error al leer el archivo: " + err.message);
        showToast("Error al leer el archivo: " + err.message, "error");
        setUploading(false);
        return;
      }

      // ── 2. Extraer catálogos del workbook ──────────────────────────────
      const docentesCatalogo = parseHojaDocentes(workbookRaw);
      const mallaCatalogo    = parseHojaMalla(workbookRaw);

      // ── 3. Parsear filas con catálogo disponible ───────────────────────
      //    parseExcelFile llama a parseClase con catalogoDocentes en cada
      //    celda, por lo que cada fila ya sale con docente y materia resueltos.
      let allRows, advertencias;
      try {
        ({ rows: allRows, advertencias } = await parseExcelFile(file, {
          lapso,
          selectedPrograma,
          catalogoDocentes: docentesCatalogo.map(d => d.nombre_raw),
        }));
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

      // ── 4. Detectar duplicados ─────────────────────────────────────────
      const sheetsEnArchivo    = [...new Set(allRows.map(r => r.sheet))];
      const programasEnArchivo = [...new Set(allRows.map(r => r.programa))];

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

      const newRows    = allRows.filter(r => !existingKeys.has(`${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`));
      const duplicados = allRows.filter(r =>  existingKeys.has(`${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`));

      // ── 5. Abrir modal de vista previa ─────────────────────────────────
      //    La inserción real se encapsula en pendingInsert y se ejecuta
      //    solo si el usuario confirma.
      const warnings = [];
      if (advertencias.length > 0) warnings.push(...advertencias);

      setPreviewData({
        rows:             allRows,
        newRows,
        duplicados,
        advertencias:     warnings,
        warnings:         [],
        docentesCatalogo,
        mallaCatalogo,
        fileName:         file.name,
      });

      // Definir la inserción que se ejecutará al confirmar
      setPendingInsert(() => async () => {
        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          setUploading(false);
          setError("La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.");
          showToast("Tiempo de espera agotado. Verifica tu conexión.", "error");
        }, UPLOAD_TIMEOUT_MS);

        try {
          // 2a. Upsert catálogo DOCENTES
          if (docentesCatalogo.length > 0) {
            const payload = docentesCatalogo.map(({ nombre_raw, nombre_display, cedula, telefono, email, observaciones }) => {
              const entry = { nombre_raw, nombre_display };
              if (cedula)        entry.cedula        = cedula;
              if (telefono)      entry.telefono      = telefono;
              if (email)         entry.email         = email;
              if (observaciones) entry.observaciones = observaciones;
              return entry;
            });
            const { error: docCatError } = await supabase
              .from("docentes")
              .upsert(payload, { onConflict: "nombre_raw" });
            if (docCatError) console.warn("upsert catálogo DOCENTES:", docCatError.message);
          }

          // 2b. Upsert catálogo MALLA
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
            if (mallaCatError) console.warn("upsert catálogo MALLA:", mallaCatError.message);
          }

          if (!newRows.length) {
            showToast("Sin registros nuevos.", "warning");
            return;
          }

          // ── Resolver docente_id / materia_id ──────────────────────────────
          // Las filas ya traen r.docente y r.materia como strings canónicos.
          // Consultamos los IDs reales de las tablas docentes y materias para
          // poblar las FK antes de insertar. Cualquier nombre sin match en BD
          // queda con null (se puede corregir luego en la vista de Docentes).

          // Recopilar nombres únicos presentes en las filas nuevas
          const nombresDocentes = [...new Set(newRows.map(r => r.docente).filter(Boolean))];
          const nombresMaterias = [...new Set(newRows.map(r => r.materia).filter(Boolean))];

          // Fetch IDs desde Supabase
          const [{ data: docsDB }, { data: matsDB }] = await Promise.all([
            nombresDocentes.length
              ? supabase.from("docentes").select("id, nombre_raw").in("nombre_raw", nombresDocentes)
              : Promise.resolve({ data: [] }),
            nombresMaterias.length
              ? supabase.from("materias").select("id, nombre_raw").in("nombre_raw", nombresMaterias)
              : Promise.resolve({ data: [] }),
          ]);

          const docenteIdMap = Object.fromEntries((docsDB || []).map(d => [d.nombre_raw, d.id]));
          const materiaIdMap = Object.fromEntries((matsDB || []).map(m => [m.nombre_raw, m.id]));

          // Construir payload limpio: solo columnas que existen en la tabla horarios
          const rowsParaInsertar = newRows.map(({ docente, materia, ...rest }) => ({
            ...rest,
            docente_id: (docente && docenteIdMap[docente]) || null,
            materia_id: (materia && materiaIdMap[materia]) || null,
          }));

          // Asegurar partición del lapso
          if (lapso) {
            const { error: partError } = await supabase.rpc("asegurar_particion_lapso", { p_lapso: lapso });
            if (partError) console.warn("asegurar_particion_lapso no disponible:", partError.message);
          }

          // Insertar filas con IDs resueltos
          const { error: insertError } = await supabase.from("horarios").insert(rowsParaInsertar);
          if (insertError) {
            if (timedOut) return;
            showToast("Error al guardar.", "error");
            return;
          }
          if (timedOut) return;

          showToast(`${newRows.length} clases cargadas.`, "success");

          await fetchHorarios(selectedPrograma);
          await fetchProgramas(lapso);
          await fetchDocenteNames();
          await fetchMateriaNames();
          setConflictsRefreshKey(k => k + 1);

        } catch (unexpectedErr) {
          console.error("Error inesperado en inserción:", unexpectedErr);
          if (!timedOut) {
            showToast("Error inesperado al procesar el archivo.", "error");
            setError("Error inesperado: " + unexpectedErr.message);
          }
        } finally {
          clearTimeout(timeoutId);
          if (!timedOut) setUploading(false);
        }
      });

    } catch (unexpectedErr) {
      console.error("Error inesperado en handleFileUpload:", unexpectedErr);
      showToast("Error inesperado al procesar el archivo.", "error");
      setError("Error inesperado: " + unexpectedErr.message);
      setUploading(false);
    }
  };

  return {
    uploading, setUploading, handleFileUpload,
    // Modal de vista previa
    previewData, cancelPreview, confirmPreview,
  };
}
