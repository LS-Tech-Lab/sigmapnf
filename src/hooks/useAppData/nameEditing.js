// Edición/unificación de nombres "display" de docentes y materias.
// Extraído de useAppData.js. No es un hook: es una fábrica de funciones que
// recibe las dependencias (fetchers, setters, showToast, logAudit) ya
// resueltas por useAppData/index.js.
//
// SEDE-5: `sedeActiva` se manda explícito en los upsert que pueden crear
// una fila nueva (docente/materia editado que todavía no existe en el
// catálogo). El `onConflict` pasa de "nombre_raw" a "sede_id,nombre_raw"
// porque desde 0061 la unicidad de nombre_raw es compuesta por sede, no
// global — sin este cambio el upsert falla en la BD apenas se aplique
// esa migración, independientemente de RLS. Los SELECT/UPDATE/DELETE de
// este archivo NO necesitaron tocarse: como ya filtran por nombre_raw
// (único por sede), RLS (0063) hace la exclusión de otras sedes sola.
//
// SEDE-11 (auditoría 6 ago): `replace_nombre_en_clases` (llamada por
// unifyNameLegacy, el fallback legacy cuando renombrar_docente/
// renombrar_materia no está disponible) es SECURITY DEFINER y hasta la
// migración 0068 no filtraba por sede -- ahora exige p_sede_id, así que
// se manda `sedeActiva` en esa llamada también.

import { supabase } from "../../lib/supabase";
import { logger } from "../../utils/logger";
import { mensajeAmigable } from "../../utils/errorMessages";

async function unifyNameLegacy(tableName, rawName, newDisplayName, sedeActiva) {
  const { data: existing } = await supabase.from(tableName).select("nombre_raw, nombre_display").ilike("nombre_display", newDisplayName.trim()).neq("nombre_raw", rawName).limit(1);
  if (existing?.length > 0) {
    const { nombre_raw: targetRaw, nombre_display: canonicalDisplay } = existing[0];
    // SEDE-11: replace_nombre_en_clases ahora exige p_sede_id (resuelve
    // la sede fija del perfil si no se manda; solo hace falta mandarla
    // explícita para roles con puedeVerTodasLasSedes, igual que el resto
    // de las RPCs de este mismo patrón).
    const { error: rpcError } = await supabase.rpc("replace_nombre_en_clases", { old_raw: rawName, new_raw: targetRaw, p_sede_id: sedeActiva || null });
    if (rpcError) throw new Error(`Error al unificar en horarios: ${rpcError.message}`);
    const { error: deleteError } = await supabase.from(tableName).delete().eq("nombre_raw", rawName);
    if (deleteError) logger.warn(`No se pudo eliminar el registro huérfano "${rawName}" de "${tableName}":`, deleteError.message);
    return { targetRaw, canonicalDisplay };
  }
  return null;
}

export function createNameEditingActions({
  logAudit, showToast, selectedPrograma, setDocenteNames, setMateriaNames,
  fetchDocenteNames, fetchMateriaNames, fetchHorarios, setConflictsRefreshKey,
  sedeActiva,
}) {
  const saveDocenteName = async (rawName, displayName) => {
    try {
      const { data: docenteRow, error: findError } = await supabase
        .from("docentes").select("id").eq("nombre_raw", rawName).maybeSingle();
      if (!findError && docenteRow?.id) {
        const { data: rpcData, error: rpcError } = await supabase
          .rpc("renombrar_docente", { p_id: docenteRow.id, p_nuevo_nombre: displayName.trim() });
        if (!rpcError) {
          const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
          logger.log("[renombrar_docente] p_id:", docenteRow.id, "p_nuevo_nombre:", displayName.trim(), "rpcData:", rpcData, "result:", result);
          const unificado = !!result?.unificado_con;
          // Actualización optimista: evita el flash del caché stale cuando
          // fetchDocenteNames() aplica el caché viejo antes del fetch async.
          if (!unificado) setDocenteNames(prev => ({ ...prev, [rawName]: displayName.trim() }));
          showToast(unificado ? "Docente unificado." : "Docente actualizado.", "success");
          logAudit?.({ accion: unificado ? "UNIFICAR_DOCENTE" : "EDITAR_DOCENTE", entidad: "docentes", resumen: unificado ? `Docente unificado: "${rawName}" → "${displayName}"` : `Docente renombrado: "${rawName}" → "${displayName}"` });
          await fetchDocenteNames();
          await fetchHorarios(selectedPrograma);
          setConflictsRefreshKey(k => k + 1);
          return { success: true };
        }
        logger.warn("renombrar_docente no disponible, usando flujo legacy:", rpcError.message);
      }
      const unified = await unifyNameLegacy("docentes", rawName, displayName, sedeActiva);
      // En unificación el rawName desaparece, no hace falta actualizar su entrada.
      if (unified) { showToast("Docente unificado.", "success"); logAudit?.({ accion: "UNIFICAR_DOCENTE", entidad: "docentes", resumen: `Docente unificado: "${rawName}" → "${displayName}"` }); await fetchDocenteNames(); await fetchHorarios(selectedPrograma); setConflictsRefreshKey(k => k + 1); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("docentes").upsert(
        { nombre_raw: rawName, nombre_display: displayName, ...(sedeActiva ? { sede_id: sedeActiva } : {}) },
        { onConflict: "sede_id,nombre_raw" }
      );
      setDocenteNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("Docente actualizado.", "success");
      logAudit?.({ accion: "EDITAR_DOCENTE", entidad: "docentes", resumen: `Docente actualizado: "${rawName}" → "${displayName}"` });
      return { success: true };
    } catch (err) { showToast("Error: " + mensajeAmigable(err), "error"); return { success: false }; }
  };

  // Vincula manualmente la cédula de un docente (nombre_raw -> cedula),
  // usada por el módulo de asistencias QR para cruzar el escaneo con el
  // horario real del docente (ver migración 0008, horario_docente_hoy).
  const saveDocenteCedula = async (rawName, cedula) => {
    const cedulaLimpia = cedula.trim().toUpperCase();
    try {
      // UPDATE en lugar de upsert: la cédula siempre se edita sobre un
      // docente que ya existe. El upsert intentaría INSERT si no existe,
      // fallando por la restricción NOT NULL de nombre_display.
      const { error: updateError } = await supabase
        .from("docentes")
        .update({ cedula: cedulaLimpia || null })
        .eq("nombre_raw", rawName);
      if (updateError) {
        if (updateError.code === "23505") {
          showToast("Esa cédula ya está vinculada a otro docente.", "error");
        } else {
          // Fix UX-55 (auditoría 16 ago): este else concatenaba
          // updateError.message crudo — bug propio encontrado al cerrar el
          // hallazgo original (el catch de abajo, ya reportado en el
          // índice), mismo patrón que SEC-38 ya cerró en otros 6 archivos.
          showToast("Error: " + mensajeAmigable(updateError), "error");
        }
        return { success: false };
      }
      showToast(cedulaLimpia ? "Cédula vinculada." : "Cédula desvinculada.", "success");
      logAudit?.({ accion: "EDITAR_DOCENTE", entidad: "docentes", resumen: `Cédula de "${rawName}" actualizada a "${cedulaLimpia || "(vacío)"}"` });
      return { success: true, cedulaLimpia };
    } catch (err) { showToast("Error: " + mensajeAmigable(err), "error"); return { success: false }; }
  };

  const saveMateriaName = async (rawName, displayName) => {
    try {
      const { data: materiaRow, error: findError } = await supabase
        .from("materias").select("id").eq("nombre_raw", rawName).maybeSingle();
      if (!findError && materiaRow?.id) {
        const { data: rpcData, error: rpcError } = await supabase
          .rpc("renombrar_materia", { p_id: materiaRow.id, p_nuevo_nombre: displayName.trim() });
        if (!rpcError) {
          const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
          const unificada = !!result?.unificado_con;
          // Actualización optimista: evita el flash del caché stale cuando
          // fetchMateriaNames() aplica el caché viejo antes del fetch async.
          if (!unificada) setMateriaNames(prev => ({ ...prev, [rawName]: displayName.trim() }));
          showToast(unificada ? "Materia unificada." : "Materia actualizada.", "success");
          logAudit?.({ accion: unificada ? "UNIFICAR_MATERIA" : "EDITAR_MATERIA", entidad: "materias", resumen: unificada ? `Materia unificada: "${rawName}" → "${displayName}"` : `Materia renombrada: "${rawName}" → "${displayName}"` });
          await fetchMateriaNames();
          await fetchHorarios(selectedPrograma);
          return { success: true };
        }
        logger.warn("renombrar_materia no disponible, usando flujo legacy:", rpcError.message);
      }
      const unified = await unifyNameLegacy("materias", rawName, displayName, sedeActiva);
      // En unificación el rawName desaparece, no hace falta actualizar su entrada.
      if (unified) { showToast("Materia unificada.", "success"); logAudit?.({ accion: "UNIFICAR_MATERIA", entidad: "materias", resumen: `Materia unificada: "${rawName}" → "${displayName}"` }); await fetchMateriaNames(); await fetchHorarios(selectedPrograma); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("materias").upsert(
        { nombre_raw: rawName, nombre_display: displayName, ...(sedeActiva ? { sede_id: sedeActiva } : {}) },
        { onConflict: "sede_id,nombre_raw" }
      );
      setMateriaNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("Materia actualizada.", "success");
      logAudit?.({ accion: "EDITAR_MATERIA", entidad: "materias", resumen: `Materia actualizada: "${rawName}" → "${displayName}"` });
      return { success: true };
    } catch (err) { showToast("Error: " + mensajeAmigable(err), "error"); return { success: false }; }
  };

  return { saveDocenteName, saveDocenteCedula, saveMateriaName };
}
