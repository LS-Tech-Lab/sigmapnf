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
import { tokensMatch } from "../../utils/parsing";
import { supabase } from "../../lib/supabase";
import { logger } from "../../utils/logger";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];
const UPLOAD_TIMEOUT_MS  = 60_000;

// ── UX-3: Mapeo de errores técnicos del parser a mensajes accionables ────────
// Traduce mensajes que llegarían crudos al Toast/setError en texto que el
// usuario pueda entender y actuar sobre él sin conocimiento técnico del sistema.
function humanizarErrorParser(mensaje) {
  if (!mensaje) return "Error desconocido al leer el archivo.";
  const m = mensaje.toLowerCase();

  if (m.includes("no se pudo leer el archivo") || m.includes("failed to read"))
    return "No se pudo abrir el archivo. Verifica que no esté dañado o abierto en otro programa.";

  if (m.includes("no se encontraron datos válidos") || m.includes("no se encontraron datos"))
    return "El archivo no contiene datos de horarios reconocibles. Revisa que uses la plantilla correcta y que las hojas tengan el formato esperado.";

  if (m.includes("columna hora") || m.includes("columna hora no encontrada"))
    return "Una hoja del archivo no tiene la columna HORA o días de la semana. Verifica que el encabezado de la tabla esté completo.";

  if (m.includes("columna turno") || m.includes("turno no encontrad"))
    return "No se encontró la columna TURNO en una hoja. Asegúrate de que el encabezado incluya la columna TURNO (o que la hoja CONFIGURACIÓN lo especifique).";

  if (m.includes("hoja") && (m.includes("no reconocida") || m.includes("rechazada")))
    return "Algunas hojas del archivo no pudieron leerse. Asegúrate de que cada hoja de horario tenga una tabla válida con columna HORA y al menos un día de la semana.";

  if (m.includes("formato de archivo no válido") || m.includes("extensión"))
    return "El archivo no es un Excel válido. Solo se aceptan archivos .xlsx o .xls.";

  if (m.includes("demasiado grande") || m.includes("tamaño máximo"))
    return mensaje; // este ya es accionable tal como viene

  if (m.includes("tiempo de espera") || m.includes("timeout") || m.includes("tardó demasiado"))
    return "La operación tardó demasiado. Verifica tu conexión a internet e intenta de nuevo.";

  if (m.includes("duplicate") || m.includes("duplicado") || m.includes("único"))
    return "Algunos registros ya existen en el sistema y no pudieron actualizarse. Contacta al administrador si el problema persiste.";

  if (m.includes("permission") || m.includes("permiso") || m.includes("row-level"))
    return "No tienes permiso para cargar datos en este programa. Contacta al administrador.";

  // Fallback: el mensaje original pero sin stack trace ni código técnico
  return `Error al procesar el archivo: ${mensaje.split("\n")[0]}`;
}

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
  fetchHorarios, fetchProgramas, fetchDocenteNames, fetchMateriaNames, invalidarCacheDocentes,
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
        const msg = humanizarErrorParser(err.message);
        setError(msg);
        showToast(msg, "error");
        setUploading(false);
        return;
      }

      // ── 2. Extraer catálogos del workbook ──────────────────────────────
      const docentesCatalogo = parseHojaDocentes(workbookRaw);
      const mallaCatalogo    = parseHojaMalla(workbookRaw);

      // ── 3. Parsear filas con catálogo disponible ───────────────────────
      //    Pasamos workbookRaw directamente para evitar leer el archivo
      //    por segunda vez. parseExcelFile acepta File o workbook XLSX.
      let allRows, advertencias;
      try {
        ({ rows: allRows, advertencias } = await parseExcelFile(workbookRaw, {
          lapso,
          selectedPrograma,
          catalogoDocentes: docentesCatalogo.map(d => d.nombre_raw),
        }));
      } catch (err) {
        const msg = humanizarErrorParser(err.message);
        setError(msg);
        showToast(msg, "error");
        setUploading(false);
        return;
      }

      if (!allRows.length) {
        const msg = humanizarErrorParser("no se encontraron datos válidos");
        setError(msg);
        showToast(msg, "warning");
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

      // Docentes del catálogo sin cédula — advertencia visible en el modal.
      // Sin cédula no se pueden insertar en BD (cedula NOT NULL).
      const normCedulaPrev = c => c ? c.replace(/[^0-9]/g, "") : null;
      const docentesSinCedula = docentesCatalogo.filter(
        d => !normCedulaPrev(d.cedula)
      );
      if (docentesSinCedula.length > 0) {
        warnings.push(
          `${docentesSinCedula.length} docente(s) sin cédula en la hoja DOCENTES: ` +
          docentesSinCedula.map(d => d.nombre_raw).join(", ") +
          ". Serán insertados pero deben completar su cédula en el menú Docentes."
        );
      }

      // Clases cuyo docente resuelto no tiene cédula en el catálogo
      const cedulasPorNombre = Object.fromEntries(
        docentesCatalogo
          .filter(d => normCedulaPrev(d.cedula))
          .map(d => [d.nombre_raw, normCedulaPrev(d.cedula)])
      );

      setPreviewData({
        rows:             allRows,
        newRows,
        duplicados,
        advertencias:     warnings,
        docentesCatalogo,
        mallaCatalogo,
        fileName:         file.name,
        cedulasPorNombre,
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
          // Estrategia de conflicto:
          //   - Si el registro tiene cédula → onConflict "cedula": un mismo docente
          //     escrito diferente en dos archivos no genera duplicado.
          //   - Si no tiene cédula → onConflict "nombre_raw": comportamiento anterior.
          // La cédula se normaliza quitando prefijos "V-" y espacios para consistencia
          // con el constraint de BD.
          if (docentesCatalogo.length > 0) {
            const normCedula = c => c ? c.replace(/[^0-9]/g, "") : null;

            const conCedula    = [];
            const sinCedulaArr = [];

            docentesCatalogo.forEach(({ nombre_raw, nombre_display, cedula, telefono, email, observaciones }) => {
              const cedulaNorm = normCedula(cedula);
              const entry = { nombre_raw, nombre_display };
              if (cedulaNorm)    entry.cedula        = cedulaNorm;
              if (telefono)      entry.telefono      = telefono;
              if (email)         entry.email         = email;
              if (observaciones) entry.observaciones = observaciones;
              if (cedulaNorm) conCedula.push(entry);
              else            sinCedulaArr.push(entry);
            });

            // Docentes con cédula → upsert por cédula (evita duplicados entre archivos)
            if (conCedula.length > 0) {
              const { error: e1 } = await supabase
                .from("docentes")
                .upsert(conCedula, { onConflict: "cedula" });
              if (e1) logger.warn("upsert DOCENTES (por cédula):", e1.message);
            }

            // FIX (docentes-duplicados-en-import): antes, un docente sin cédula
            // se upserteaba por nombre_raw exacto. Si el Excel maestro traía una
            // variante distinta (typo, nombre corto, tilde faltante) de un
            // docente ya unificado manualmente en `docentes`, el onConflict no
            // encontraba coincidencia exacta y se insertaba una fila NUEVA,
            // deshaciendo la unificación anterior y reintroduciendo el duplicado
            // en Ausentes (ver VistaAusentes.jsx). Ahora, antes del upsert,
            // cada nombre sin cédula se compara por fuzzy matching (mismo
            // criterio que ya se usa en el paso 3 más abajo) contra los
            // docentes sin cédula ya existentes en BD; si hay coincidencia, el
            // upsert se redirige a esa fila existente en vez de crear una nueva.
            if (sinCedulaArr.length > 0) {
              const { data: existentesSinCedula } = await supabase
                .from("docentes")
                .select("nombre_raw, cedula")
                .is("cedula", null);

              const nombresExistentes = existentesSinCedula || [];

              sinCedulaArr.forEach(entry => {
                const yaExacto = nombresExistentes.some(d => d.nombre_raw === entry.nombre_raw);
                if (yaExacto) return;
                const match = nombresExistentes.find(d => tokensMatch(entry.nombre_raw, d.nombre_raw, 1));
                if (match) {
                  logger.warn(`Docente "${entry.nombre_raw}" coincide con "${match.nombre_raw}" ya existente — se evita duplicado.`);
                  entry.nombre_raw = match.nombre_raw;
                }
              });

              // Dedupe: dos variantes distintas pudieron remapearse al mismo
              // nombre_raw canónico. Un upsert con el mismo conflict target
              // repetido en el mismo batch falla en Postgres.
              const sinCedulaMap = new Map();
              sinCedulaArr.forEach(entry => sinCedulaMap.set(entry.nombre_raw, entry));
              const sinCedulaDedup = [...sinCedulaMap.values()];

              const { error: e2 } = await supabase
                .from("docentes")
                .upsert(sinCedulaDedup, { onConflict: "nombre_raw" });
              if (e2) logger.warn("upsert DOCENTES (sin cédula, por nombre_raw):", e2.message);
            }
          }

          // 2b. Upsert catálogo MALLA
          if (mallaCatalogo.length > 0) {
            // Deduplicar por nombre_raw antes del upsert — Supabase rechaza
            // el batch si dos filas tienen el mismo valor de conflicto.
            const mallaMap = new Map();
            mallaCatalogo.forEach(({ nombre_raw, nombre_display, trayecto, codigo_uc, horas_semanales, unidades_credito }) => {
              if (!mallaMap.has(nombre_raw)) {
                const entry = { nombre_raw, nombre_display };
                if (trayecto)         entry.trayecto         = trayecto;
                if (codigo_uc)        entry.codigo_uc        = codigo_uc;
                if (horas_semanales)  entry.horas_semanales  = horas_semanales;
                if (unidades_credito) entry.unidades_credito = unidades_credito;
                mallaMap.set(nombre_raw, entry);
              }
            });
            const payload = [...mallaMap.values()];
            const { error: mallaCatError } = await supabase
              .from("materias")
              .upsert(payload, { onConflict: "nombre_raw" });
            if (mallaCatError) logger.warn("upsert catálogo MALLA:", mallaCatError.message);
          }

          if (!newRows.length) {
            showToast("Sin registros nuevos.", "warning");
            return;
          }

          // ── Resolver docente_id / materia_id ──────────────────────────────
          // Las filas ya traen r.docente y r.materia como strings canónicos.
          //
          // Problema (C-2): cuando el upsert anterior usó onConflict "cedula",
          // el nombre_raw que quedó en BD puede ser distinto al del Excel
          // (el registro ya existía con otro nombre canónico). Buscar solo por
          // nombre_raw falla silenciosamente → docente_id = null.
          //
          // Solución: lookup en dos pasos:
          //   1. Por cédula (puente seguro para docentes con cédula conocida).
          //   2. Por nombre_raw (fallback para docentes sin cédula o sin match).
          // Ambos resultados se combinan; la cédula tiene prioridad.

          const limpiarTel  = s => s.replace(/\s+0\d{9,11}$/, "").trim();
          const normCedula2 = c => c ? c.replace(/[^0-9]/g, "") : null;

          // Mapa nombre_raw_en_fila → cédula normalizada (solo docentes con cédula)
          const cedulaPorNombreFila = {};
          docentesCatalogo.forEach(d => {
            const ced = normCedula2(d.cedula);
            if (ced) cedulaPorNombreFila[d.nombre_raw] = ced;
          });

          const nombresDocentes = [...new Set(
            newRows.map(r => r.docente).filter(Boolean).map(limpiarTel)
          )];
          const nombresMaterias = [...new Set(newRows.map(r => r.materia).filter(Boolean))];

          // Cédulas únicas de los docentes que aparecen en filas nuevas
          const cedulasParaBuscar = [...new Set(
            nombresDocentes.map(n => cedulaPorNombreFila[n]).filter(Boolean)
          )];

          // Fetch en paralelo: por cédula + por nombre_raw + materias
          const [docsRespCedula, docsRespNombre, { data: matsDB }] = await Promise.all([
            cedulasParaBuscar.length
              ? supabase.from("docentes").select("id, nombre_raw, cedula").in("cedula", cedulasParaBuscar)
              : Promise.resolve({ data: [] }),
            nombresDocentes.length
              ? supabase.from("docentes").select("id, nombre_raw, cedula").in("nombre_raw", nombresDocentes)
              : Promise.resolve({ data: [] }),
            nombresMaterias.length
              ? supabase.from("materias").select("id, nombre_raw").in("nombre_raw", nombresMaterias)
              : Promise.resolve({ data: [] }),
          ]);

          // Construir docenteIdMap con doble clave: nombre_raw_fila → id
          // Estrategia: primero poblar con match por nombre_raw (fallback),
          // luego sobreescribir con match por cédula (más preciso).
          const docenteIdMap = {};

          // Paso 1 — por nombre_raw directo
          (docsRespNombre.data || []).forEach(d => {
            docenteIdMap[d.nombre_raw] = d.id;
          });

          // Paso 2 — por cédula: vincular nombre_fila → id usando cédula como puente
          // Construir mapa cédula → id desde los registros devueltos por Supabase
          const idPorCedula = {};
          (docsRespCedula.data || []).forEach(d => {
            if (d.cedula) idPorCedula[d.cedula] = d.id;
          });
          // Para cada nombre en las filas, si tenemos su cédula, sobreescribir el ID
          nombresDocentes.forEach(nombre => {
            const ced = cedulaPorNombreFila[nombre];
            if (ced && idPorCedula[ced]) {
              docenteIdMap[nombre] = idPorCedula[ced];
            }
          });

          // Paso 3 — fuzzy (M-2): para nombres sin match exacto ni cédula,
          // buscar el registro de BD más cercano por similitud de tokens.
          // Cubre variaciones tipográficas menores (tildes, un carácter cambiado).
          // Solo aplica si el nombre todavía no tiene ID resuelto.
          const todosDocentesDB = [
            ...(docsRespNombre.data || []),
            ...(docsRespCedula.data || []),
          ];
          const dbNombresUnicos = [...new Map(todosDocentesDB.map(d => [d.nombre_raw, d])).values()];

          nombresDocentes.forEach(nombre => {
            if (docenteIdMap[nombre]) return; // ya resuelto en paso 1 o 2
            const match = dbNombresUnicos.find(d => tokensMatch(nombre, d.nombre_raw, 1));
            if (match) {
              docenteIdMap[nombre] = match.id;
            }
          });

          const materiaIdMap = Object.fromEntries((matsDB || []).map(m => [m.nombre_raw, m.id]));

          // Construir payload limpio: solo columnas que existen en la tabla horarios
          const rowsParaInsertar = newRows.map(({ docente, materia, ...rest }) => ({
            ...rest,
            docente_id: (docente && docenteIdMap[limpiarTel(docente)]) || null,
            materia_id: (materia && materiaIdMap[materia]) || null,
          }));

          // Asegurar partición del lapso
          if (lapso) {
            const { error: partError } = await supabase.rpc("asegurar_particion_lapso", { p_lapso: lapso });
            if (partError) logger.warn("asegurar_particion_lapso no disponible:", partError.message);
          }

          // Insertar filas con IDs resueltos
          const { error: insertError } = await supabase.from("horarios").insert(rowsParaInsertar);
          if (insertError) {
            if (timedOut) return;
            logger.error("insert horarios:", insertError);
            showToast(`Error al guardar: ${insertError.message}`, "error");
            // M-6 fix: registrar fallo de insert en auditoría.
            // Antes: el error solo se mostraba en toast y console — sin rastro en audit_logs.
            await logAudit?.({
              accion:           "IMPORTAR_EXCEL",
              entidad:          "horarios",
              lapso,
              programa_afectado: selectedPrograma !== "todos" ? selectedPrograma : null,
              resumen:          `Fallo al importar: ${rowsParaInsertar.length} filas rechazadas — ${insertError.message}`,
              datos_despues:    { error: insertError.message, filas_intentadas: rowsParaInsertar.length },
            });
            return;
          }

          // A-2: si el insert terminó después del timeout la UI ya mostró
          // "tiempo agotado", pero los datos SÍ quedaron en BD. Refrescar
          // silenciosamente para que la vista refleje el estado real.
          if (timedOut) {
            await fetchHorarios(selectedPrograma);
            await fetchProgramas(lapso);
            setConflictsRefreshKey(k => k + 1);
            showToast(`Carga completada (${newRows.length} clases). La operación tardó más de lo esperado.`, "warning");
            return;
          }

          showToast(`${newRows.length} clases cargadas.`, "success");

          await fetchHorarios(selectedPrograma);
          await fetchProgramas(lapso);
          invalidarCacheDocentes?.(); // fuerza fetch fresco sin caché viejo
          await fetchDocenteNames();
          await fetchMateriaNames();
          setConflictsRefreshKey(k => k + 1);

        } catch (unexpectedErr) {
          logger.error("Error inesperado en inserción:", unexpectedErr);
          if (!timedOut) {
            const msg = humanizarErrorParser(unexpectedErr.message);
            showToast(msg, "error");
            setError(msg);
          }
        } finally {
          clearTimeout(timeoutId);
          if (!timedOut) setUploading(false);
        }
      });

    } catch (unexpectedErr) {
      logger.error("Error inesperado en handleFileUpload:", unexpectedErr);
      const msg = humanizarErrorParser(unexpectedErr.message);
      showToast(msg, "error");
      setError(msg);
      setUploading(false);
    }
  };

  return {
    uploading, setUploading, handleFileUpload,
    // Modal de vista previa
    previewData, cancelPreview, confirmPreview,
  };
}
