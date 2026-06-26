// Edición/unificación de nombres "display" de docentes y materias.
// Extraído de useAppData.js. No es un hook: es una fábrica de funciones que
// recibe las dependencias (fetchers, setters, showToast, logAudit) ya
// resueltas por useAppData/index.js.

import { supabase } from "../../lib/supabase";

async function unifyNameLegacy(tableName, rawName, newDisplayName) {
  const { data: existing } = await supabase.from(tableName).select("nombre_raw, nombre_display").ilike("nombre_display", newDisplayName.trim()).neq("nombre_raw", rawName).limit(1);
  if (existing?.length > 0) {
    const { nombre_raw: targetRaw, nombre_display: canonicalDisplay } = existing[0];
    const { error: rpcError } = await supabase.rpc("replace_nombre_en_clases", { old_raw: rawName, new_raw: targetRaw });
    if (rpcError) throw new Error(`Error al unificar en horarios: ${rpcError.message}`);
    const { error: deleteError } = await supabase.from(tableName).delete().eq("nombre_raw", rawName);
    if (deleteError) console.warn(`No se pudo eliminar el registro huérfano "${rawName}" de "${tableName}":`, deleteError.message);
    return { targetRaw, canonicalDisplay };
  }
  return null;
}

export function createNameEditingActions({
  logAudit, showToast, selectedPrograma, setDocenteNames, setMateriaNames,
  fetchDocenteNames, fetchMateriaNames, fetchHorarios, setConflictsRefreshKey,
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
          console.log("[renombrar_docente] p_id:", docenteRow.id, "p_nuevo_nombre:", displayName.trim(), "rpcData:", rpcData, "result:", result);
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
        console.warn("renombrar_docente no disponible, usando flujo legacy:", rpcError.message);
      }
      const unified = await unifyNameLegacy("docentes", rawName, displayName);
      // En unificación el rawName desaparece, no hace falta actualizar su entrada.
      if (unified) { showToast("Docente unificado.", "success"); logAudit?.({ accion: "UNIFICAR_DOCENTE", entidad: "docentes", resumen: `Docente unificado: "${rawName}" → "${displayName}"` }); await fetchDocenteNames(); await fetchHorarios(selectedPrograma); setConflictsRefreshKey(k => k + 1); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("docentes").upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      setDocenteNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("Docente actualizado.", "success");
      logAudit?.({ accion: "EDITAR_DOCENTE", entidad: "docentes", resumen: `Docente actualizado: "${rawName}" → "${displayName}"` });
      return { success: true };
    } catch (err) { showToast("Error: " + err.message, "error"); return { success: false }; }
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
          showToast("Error: " + updateError.message, "error");
        }
        return { success: false };
      }
      showToast(cedulaLimpia ? "Cédula vinculada." : "Cédula desvinculada.", "success");
      logAudit?.({ accion: "EDITAR_DOCENTE", entidad: "docentes", resumen: `Cédula de "${rawName}" actualizada a "${cedulaLimpia || "(vacío)"}"` });
      return { success: true, cedulaLimpia };
    } catch (err) { showToast("Error: " + err.message, "error"); return { success: false }; }
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
        console.warn("renombrar_materia no disponible, usando flujo legacy:", rpcError.message);
      }
      const unified = await unifyNameLegacy("materias", rawName, displayName);
      // En unificación el rawName desaparece, no hace falta actualizar su entrada.
      if (unified) { showToast("Materia unificada.", "success"); logAudit?.({ accion: "UNIFICAR_MATERIA", entidad: "materias", resumen: `Materia unificada: "${rawName}" → "${displayName}"` }); await fetchMateriaNames(); await fetchHorarios(selectedPrograma); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("materias").upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      setMateriaNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("Materia actualizada.", "success");
      logAudit?.({ accion: "EDITAR_MATERIA", entidad: "materias", resumen: `Materia actualizada: "${rawName}" → "${displayName}"` });
      return { success: true };
    } catch (err) { showToast("Error: " + err.message, "error"); return { success: false }; }
  };

  return { saveDocenteName, saveDocenteCedula, saveMateriaName };
}
