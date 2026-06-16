import { ALL_TRAYECTOS, DEFAULT_PROGRAMAS } from "../constants";
import { parseClase, normalizarPrograma } from "../utils/parsing";
import { parseExcelFile } from "../utils/excelParser";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { suscribirCambiosRemotos } from "../lib/realtime";
import useConflictos from "./useConflictos";
import {
  guardarEnCache, cargarDeCache,
  CACHE_KEYS, limpiarCache, obtenerUltimaSincronizacion, validarVersionCache
} from "../utils/cache";

export default function useAppData(lapso) {
  useEffect(() => { validarVersionCache(); }, []);

  const [user, setUser] = useState(undefined);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPrograma, setSelectedPrograma] = useState("todos");
  const [programasDisponibles, setProgramasDisponibles] = useState(["todos", ...DEFAULT_PROGRAMAS]);
  const [docenteNames, setDocenteNames] = useState({});
  const [materiaNames, setMateriaNames] = useState({});
  const [toast, setToast] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [lastSync, setLastSync] = useState(obtenerUltimaSincronizacion());
  const [confirmModal, setConfirmModal] = useState(null);

  const openConfirm = useCallback(({ title, message, confirmLabel, danger, onConfirm }) => {
    setConfirmModal({ title, message, confirmLabel, danger, onConfirm });
  }, []);

  const closeConfirm = useCallback(() => setConfirmModal(null), []);

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const showToast = useCallback((message, type = "success") => {
    if (!message) { setToast(null); return; }
    setToast(null);
    setTimeout(() => setToast({ message, type }), 50);
  }, []);

  const hideToast = useCallback(() => setToast(null), []);

  const fetchProgramas = async (lapsoActual) => {
    let query = supabase.from("horarios").select("programa").not("programa", "is", null);
    if (lapsoActual) query = query.eq("lapso", lapsoActual);
    const { data: programas } = await query;
    if (programas) {
      const canonicalSet = new Map();
      programas.forEach(p => { if (p.programa?.trim()) { const canon = normalizarPrograma(p.programa); if (canon) canonicalSet.set(canon, true); } });
      const unique = [...canonicalSet.keys()].sort();
      const defaults = DEFAULT_PROGRAMAS.filter(p => !unique.some(u => u.toLowerCase() === p.toLowerCase()));
      setProgramasDisponibles(["todos", ...unique, ...defaults]);
    }
  };

  const cacheKey = lapso ? `${CACHE_KEYS.horarios}_${lapso}` : CACHE_KEYS.horarios;

  const PAGE_SIZE = 500;

  const fetchHorarios = useCallback(async (programa = selectedPrograma) => {
    const cachedHorarios = cargarDeCache(cacheKey);
    if (cachedHorarios?.length > 0) {
      setData(cachedHorarios);
      setLoading(false);
      setIsSyncing(true);
    } else {
      setLoading(true);
    }

    try {
      const todasLasFilas = [];
      let cursor = 0;
      let hayMas = true;

      while (hayMas) {
        let query = supabase
          .from("horarios")
          .select("*")
          .gt("id", cursor)
          .order("id", { ascending: true })
          .limit(PAGE_SIZE);

        if (lapso)                query = query.eq("lapso",    lapso);
        if (programa !== "todos") query = query.eq("programa", programa);

        const { data: pagina, error } = await query;

        if (error) {
          console.error(error);
          if (cachedHorarios?.length > 0) {
            setData(cachedHorarios);
            showToast("⚠️ Error de conexión. Usando caché.", "warning");
          } else {
            setError(error.message);
          }
          setLoading(false);
          setIsSyncing(false);
          return;
        }

        const filas = pagina || [];
        todasLasFilas.push(...filas);

        if (filas.length < PAGE_SIZE) {
          hayMas = false;
        } else {
          cursor = filas[filas.length - 1].id;
          setData([...todasLasFilas]);
        }
      }

      setData(todasLasFilas);
      guardarEnCache(cacheKey, todasLasFilas);
      localStorage.setItem(CACHE_KEYS.lastSync, Date.now().toString());
      setLastSync(obtenerUltimaSincronizacion());
    } catch (err) {
      console.error(err);
      if (cachedHorarios?.length > 0) {
        setData(cachedHorarios);
        showToast("⚠️ Modo offline: usando caché.", "warning");
      }
    }

    setLoading(false);
    setIsSyncing(false);
  }, [selectedPrograma, lapso, cacheKey, showToast]);

  const fetchDocenteNames = useCallback(async () => {
    const cachedDocentes = cargarDeCache(CACHE_KEYS.docentes);
    if (cachedDocentes) setDocenteNames(cachedDocentes);
    try {
      const { data: docentes } = await supabase.from("docentes").select("*");
      if (docentes) {
        const m = {};
        docentes.forEach(d => { m[d.nombre_raw] = d.nombre_display; });
        setDocenteNames(m);
        guardarEnCache(CACHE_KEYS.docentes, m);
      }
    } catch (err) {
      console.warn("Error fetching docentes:", err);
      if (cachedDocentes) setDocenteNames(cachedDocentes);
    }
  }, []);

  const fetchMateriaNames = useCallback(async () => {
    const cachedMaterias = cargarDeCache(CACHE_KEYS.materias);
    if (cachedMaterias) setMateriaNames(cachedMaterias);
    try {
      const { data: materias } = await supabase.from("materias").select("*");
      if (materias) {
        const m = {};
        materias.forEach(d => { m[d.nombre_raw] = d.nombre_display; });
        setMateriaNames(m);
        guardarEnCache(CACHE_KEYS.materias, m);
      }
    } catch (err) {
      console.warn("Error fetching materias:", err);
      if (cachedMaterias) setMateriaNames(cachedMaterias);
    }
  }, []);

  useEffect(() => { fetchProgramas(lapso); fetchDocenteNames(); fetchMateriaNames(); }, [lapso]);
  useEffect(() => { fetchHorarios(selectedPrograma); }, [selectedPrograma, lapso, fetchHorarios]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); showToast("✅ Conexión restablecida.", "success"); fetchHorarios(selectedPrograma); fetchDocenteNames(); fetchMateriaNames(); };
    const handleOffline = () => { setIsOffline(true); showToast("⚠️ Sin conexión. Usando caché.", "warning"); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, [selectedPrograma, fetchHorarios, showToast]);

  const [conflictsRefreshKey, setConflictsRefreshKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    const cancelar = suscribirCambiosRemotos({
      lapso,
      onHorariosChange: () => {
        limpiarCache();
        fetchHorarios(selectedPrograma);
        setConflictsRefreshKey(k => k + 1);
        showToast("🔄 Horarios actualizados por otro usuario.", "info");
      },
      onDocentesChange: () => {
        fetchDocenteNames();
        setConflictsRefreshKey(k => k + 1);
      },
      onMateriasChange: () => { fetchMateriaNames(); },
    });
    return cancelar;
  }, [user, lapso, selectedPrograma, fetchHorarios, fetchDocenteNames, fetchMateriaNames, showToast]);

  const unifyNameLegacy = async (tableName, rawName, newDisplayName) => {
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
  };

  const saveDocenteName = async (rawName, displayName) => {
    try {
      const { data: docenteRow, error: findError } = await supabase
        .from("docentes").select("id").eq("nombre_raw", rawName).maybeSingle();
      if (!findError && docenteRow?.id) {
        const { data: rpcData, error: rpcError } = await supabase
          .rpc("renombrar_docente", { p_id: docenteRow.id, p_nuevo_nombre: displayName.trim() });
        if (!rpcError) {
          const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
          showToast(result?.unificado_con ? "✅ Docente unificado." : "✅ Docente actualizado.", "success");
          await fetchDocenteNames();
          await fetchHorarios();
          setConflictsRefreshKey(k => k + 1);
          return { success: true };
        }
        console.warn("renombrar_docente no disponible, usando flujo legacy:", rpcError.message);
      }
      const unified = await unifyNameLegacy("docentes", rawName, displayName);
      if (unified) { showToast("✅ Docente unificado.", "success"); await fetchDocenteNames(); await fetchHorarios(); setConflictsRefreshKey(k => k + 1); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("docentes").upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      setDocenteNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("✅ Docente actualizado.", "success");
      return { success: true };
    } catch (err) { showToast("❌ Error: " + err.message, "error"); return { success: false }; }
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
          showToast(result?.unificado_con ? "✅ Materia unificada." : "✅ Materia actualizada.", "success");
          await fetchMateriaNames();
          await fetchHorarios();
          return { success: true };
        }
        console.warn("renombrar_materia no disponible, usando flujo legacy:", rpcError.message);
      }
      const unified = await unifyNameLegacy("materias", rawName, displayName);
      if (unified) { showToast("✅ Materia unificada.", "success"); await fetchMateriaNames(); await fetchHorarios(); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("materias").upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      setMateriaNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("✅ Materia actualizada.", "success");
      return { success: true };
    } catch (err) { showToast("❌ Error: " + err.message, "error"); return { success: false }; }
  };

  const clearAllData = () => {
    const scope = selectedPrograma !== "todos" ? `el programa "${selectedPrograma}"` : "TODOS los programas";
    openConfirm({
      title: "Borrar datos",
      message: `Se eliminarán los horarios de ${scope} del trimestre ${lapso || "actual"}. Se recomienda hacer un backup antes. Esta acción no se puede deshacer.`,
      confirmLabel: "Sí, borrar",
      danger: true,
      onConfirm: async () => {
        closeConfirm();
        setLoading(true);

        const programaParam = selectedPrograma !== "todos" ? selectedPrograma : null;
        const { error: rpcError } = await supabase.rpc("borrar_horarios", {
          p_lapso:    lapso    || null,
          p_programa: programaParam,
        });

        if (rpcError) {
          const noExiste = rpcError.code === "PGRST202" || rpcError.message?.includes("Could not find");
          if (noExiste) {
            console.warn("borrar_horarios no disponible, usando DELETE directo:", rpcError.message);
            let query = supabase.from("horarios").delete();
            if (lapso) query = query.eq("lapso", lapso);
            if (selectedPrograma !== "todos") query = query.eq("programa", selectedPrograma);
            else query = query.neq("id", 0);
            const { error: delError } = await query;
            if (delError) { showToast("❌ Error al borrar.", "error"); setLoading(false); return; }
          } else {
            showToast("❌ Error al borrar.", "error");
            setLoading(false);
            return;
          }
        }

        showToast("✅ Datos eliminados.", "success");
        limpiarCache();
        await fetchHorarios();
        await fetchProgramas(lapso);
        setLoading(false);
      },
    });
  };

  const exportarDatos = async () => {
    try {
      showToast("📦 Preparando backup...", "info");
      const [horariosRes, docentesRes, materiasRes] = await Promise.all([
        lapso
          ? supabase.from("horarios").select("*").eq("lapso", lapso)
          : supabase.from("horarios").select("*"),
        supabase.from("docentes").select("*"),
        supabase.from("materias").select("*"),
      ]);
      const backup = {
        version: "2.0",
        fecha: new Date().toISOString(),
        lapso: lapso || "todos",
        programa: selectedPrograma,
        horarios: horariosRes.data || [],
        docentes: docentesRes.data || [],
        materias: materiasRes.data || [],
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-horarios-${lapso || "todos"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("✅ Backup descargado correctamente", "success");
    } catch (err) {
      console.error("Error al exportar:", err);
      showToast("❌ Error al crear backup: " + err.message, "error");
    }
  };

  const importarDatos = (file) => {
    openConfirm({
      title: "Restaurar backup",
      message: "Esto REEMPLAZARÁ todos los datos del trimestre actual con el contenido del archivo. ¿Continuar?",
      confirmLabel: "Sí, restaurar",
      danger: true,
      onConfirm: async () => {
        closeConfirm();
        setUploading(true);
        try {
          const text = await file.text();
          const backup = JSON.parse(text);
          if (!backup.horarios || !backup.docentes || !backup.materias)
            throw new Error("El archivo no tiene el formato correcto de backup");

          const horariosConLapso = backup.horarios.map(h => ({
            ...h, lapso: lapso || h.lapso || null,
          }));

          const { data: rpcData, error: rpcError } = await supabase.rpc("restaurar_backup", {
            p_lapso:    lapso || null,
            p_horarios: horariosConLapso,
            p_docentes: backup.docentes,
            p_materias: backup.materias,
          });

          if (rpcError) {
            const noExiste = rpcError.code === "PGRST202" || rpcError.message?.includes("Could not find");
            if (noExiste) {
              console.warn("restaurar_backup no disponible, usando flujo multi-llamada:", rpcError.message);
              let delQuery = supabase.from("horarios").delete();
              if (lapso) delQuery = delQuery.eq("lapso", lapso);
              else delQuery = delQuery.neq("id", 0);
              await delQuery;
              await supabase.from("docentes").delete().neq("id", 0);
              await supabase.from("materias").delete().neq("id", 0);
              if (horariosConLapso.length > 0) await supabase.from("horarios").insert(horariosConLapso);
              if (backup.docentes.length > 0) await supabase.from("docentes").upsert(backup.docentes, { onConflict: "nombre_raw" });
              if (backup.materias.length > 0) await supabase.from("materias").upsert(backup.materias, { onConflict: "nombre_raw" });
            } else {
              throw new Error(rpcError.message);
            }
          }

          const insertados = rpcData?.horarios_insertados ?? horariosConLapso.length;
          limpiarCache();
          showToast(`✅ Backup restaurado: ${insertados} clases`, "success");
          await fetchHorarios();
          await fetchProgramas(lapso);
          await fetchDocenteNames();
          await fetchMateriaNames();
        } catch (err) {
          console.error("Error al importar:", err);
          showToast("❌ Error al restaurar backup: " + err.message, "error");
        } finally {
          setUploading(false);
        }
      },
    });
  };

  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];

  const handleFileUpload = async (file) => {
    setError(null);
    if (!file) return;

    const nameLower = (file.name || "").toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => nameLower.endsWith(ext));
    if (!hasValidExtension) {
      setError("Formato de archivo no válido. Solo se aceptan archivos .xlsx o .xls.");
      showToast("❌ Formato de archivo no válido. Usa .xlsx o .xls.", "error");
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setError(`El archivo es demasiado grande (${sizeMB} MB). El tamaño máximo permitido es 10 MB.`);
      showToast(`❌ Archivo demasiado grande (${sizeMB} MB). Máximo permitido: 10 MB.`, "error");
      return;
    }

    setUploading(true);

    let allRows, advertencias;
    try {
      const resultado = await parseExcelFile(file, { lapso, selectedPrograma });
      allRows      = resultado.rows;
      advertencias = resultado.advertencias;
      if (advertencias.length > 0) {
        showToast(`⚠️ ${advertencias.join(" | ")}`, "warning");
      }
    } catch (err) {
      setError("Error al leer el archivo: " + err.message);
      showToast("❌ Error al leer el archivo: " + err.message, "error");
      setUploading(false);
      return;
    }

    if (!allRows.length) {
      setError("No se encontraron datos válidos.");
      showToast("⚠️ No se encontraron datos válidos en el archivo.", "warning");
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

    if (!newRows.length) { showToast("⚠️ Sin registros nuevos.", "warning"); setUploading(false); return; }

    const { error: insertError } = await supabase.from("horarios").insert(newRows);
    if (insertError) {
      showToast("❌ Error al guardar.", "error");
    } else {
      showToast(`✅ ${newRows.length} clases cargadas.`, "success");
      await fetchHorarios();
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
    }
    setUploading(false);
  };

  const byDocente = useMemo(() => {
    const m = {};
    if (!data) return m;
    data.forEach(d => { const { docente } = parseClase(d.clase); if (docente) { if (!m[docente]) m[docente] = []; m[docente].push(d); } });
    return m;
  }, [data]);

  const byMateria = useMemo(() => {
    const m = {};
    if (!data) return m;
    data.forEach(d => { const { materia } = parseClase(d.clase); if (materia) { if (!m[materia]) m[materia] = []; m[materia].push(d); } });
    return m;
  }, [data]);

  const { conflicts, usingFallback: usingFallbackConflicts, refetchConflictos } = useConflictos({
    lapso, selectedPrograma, data, refreshKey: conflictsRefreshKey,
  });

  const allTrayectos = useMemo(() => {
    if (!data || data.length === 0) return [];
    return [...new Set(data.map(d => d.trayecto))].sort((a, b) => ALL_TRAYECTOS.indexOf(a) - ALL_TRAYECTOS.indexOf(b));
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, secciones: 0, docentes: 0, materias: 0 };
    return {
      total: data.length,
      secciones: new Set(data.map(d => d.sheet?.trim())).size,
      docentes: Object.keys(byDocente).length,
      materias: Object.keys(byMateria).length,
    };
  }, [data, byDocente, byMateria]);

  const getDocName = useCallback((raw) => docenteNames[raw] || raw, [docenteNames]);
  const getMateriaName = useCallback((raw) => materiaNames[raw] || raw, [materiaNames]);

  return {
    user, loading, isSyncing, uploading, error, selectedPrograma, setSelectedPrograma,
    programasDisponibles, data, docenteNames, materiaNames,
    byDocente, byMateria, conflicts, usingFallbackConflicts, refetchConflictos, stats, allTrayectos,
    isOffline, lastSync, toast, showToast, hideToast,
    confirmModal, openConfirm, closeConfirm,
    handleLogout, handleFileUpload, exportarDatos, importarDatos, clearAllData,
    saveDocenteName, saveMateriaName, getDocName, getMateriaName,
  };
}
