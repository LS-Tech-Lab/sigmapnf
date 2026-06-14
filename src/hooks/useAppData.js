import { DAYS, ALL_TRAYECTOS, DEFAULT_PROGRAMAS } from "../constants";
import { timeToMin } from "../utils/time";
import { getTurnoByCodigo, normalizeTurno } from "../utils/turno";
import { normalizarPrograma, parseClase } from "../utils/parsing";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import {
  guardarEnCache, cargarDeCache,
  CACHE_KEYS, limpiarCache, obtenerUltimaSincronizacion, validarVersionCache
} from "../utils/cache";

export default function useAppData(lapso) {
  // Invalida caché si el esquema cambió (ejecuta solo en mount)
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

  // Clave de caché incluye el lapso para evitar mezclar datos de distintos trimestres
  const cacheKey = lapso ? `${CACHE_KEYS.horarios}_${lapso}` : CACHE_KEYS.horarios;

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
      const PAGE_LIMIT = 1000;
      let query = supabase.from("horarios").select("*", { count: "exact" });
      // Filtrar por trimestre si hay uno activo
      if (lapso) query = query.eq("lapso", lapso);
      if (programa !== "todos") query = query.eq("programa", programa);
      const { data: horarios, error, count } = await query.order("id", { ascending: true }).limit(PAGE_LIMIT);
      if (error) {
        console.error(error);
        if (cachedHorarios?.length > 0) {
          setData(cachedHorarios);
          showToast("⚠️ Error de conexión. Usando caché.", "warning");
        } else setError(error.message);
      } else {
        const nuevosDatos = horarios || [];
        setData(nuevosDatos);
        guardarEnCache(cacheKey, nuevosDatos);
        localStorage.setItem(CACHE_KEYS.lastSync, Date.now().toString());
        setLastSync(obtenerUltimaSincronizacion());
        if (count !== null && count > PAGE_LIMIT) {
          showToast(`⚠️ Hay ${count} registros pero solo se muestran los primeros ${PAGE_LIMIT}. Contacte al administrador.`, "warning");
        }
      }
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

  const fetchDocenteNames = async () => {
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
  };

  const fetchMateriaNames = async () => {
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
  };

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

  const unifyName = async (tableName, rawName, newDisplayName) => {
    const { data: existing } = await supabase.from(tableName).select("nombre_raw, nombre_display").ilike("nombre_display", newDisplayName.trim()).neq("nombre_raw", rawName).limit(1);
    if (existing?.length > 0) {
      const { nombre_raw: targetRaw, nombre_display: canonicalDisplay } = existing[0];
      const { error: rpcError } = await supabase.rpc("replace_nombre_en_clases", { old_raw: rawName, new_raw: targetRaw });
      if (rpcError) throw new Error(`Error al unificar en horarios: ${rpcError.message}`);
      const { error: deleteError } = await supabase.from(tableName).delete().eq("nombre_raw", rawName);
      if (deleteError) {
        console.warn(`No se pudo eliminar el registro huérfano "${rawName}" de "${tableName}":`, deleteError.message);
      }
      return { targetRaw, canonicalDisplay };
    }
    return null;
  };

  const saveDocenteName = async (rawName, displayName) => {
    try {
      const unified = await unifyName("docentes", rawName, displayName);
      if (unified) { showToast("✅ Docente unificado.", "success"); await fetchDocenteNames(); await fetchHorarios(); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("docentes").upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      setDocenteNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("✅ Docente actualizado.", "success"); return { success: true };
    } catch (err) { showToast("❌ Error: " + err.message, "error"); return { success: false }; }
  };

  const saveMateriaName = async (rawName, displayName) => {
    try {
      const unified = await unifyName("materias", rawName, displayName);
      if (unified) { showToast("✅ Materia unificada.", "success"); await fetchMateriaNames(); await fetchHorarios(); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("materias").upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      setMateriaNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("✅ Materia actualizada.", "success"); return { success: true };
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
        let query = supabase.from("horarios").delete();
        if (lapso) query = query.eq("lapso", lapso);
        if (selectedPrograma !== "todos") query = query.eq("programa", selectedPrograma);
        else query = query.neq("id", 0);
        const { error } = await query;
        if (error) showToast("❌ Error al borrar.", "error");
        else { showToast("✅ Datos eliminados.", "success"); limpiarCache(); await fetchHorarios(); await fetchProgramas(lapso); }
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
          if (!backup.horarios || !backup.docentes || !backup.materias) throw new Error("El archivo no tiene el formato correcto de backup");
          // Borrar solo el lapso que corresponde
          let delQuery = supabase.from("horarios").delete();
          if (lapso) delQuery = delQuery.eq("lapso", lapso);
          else delQuery = delQuery.neq("id", 0);
          await delQuery;
          await supabase.from("docentes").delete().neq("id", 0);
          await supabase.from("materias").delete().neq("id", 0);
          // Asegurar que los horarios restaurados llevan el lapso correcto
          const horariosConLapso = backup.horarios.map(h => ({ ...h, lapso: lapso || h.lapso || null }));
          if (horariosConLapso.length > 0) await supabase.from("horarios").insert(horariosConLapso);
          if (backup.docentes.length > 0) await supabase.from("docentes").upsert(backup.docentes, { onConflict: "nombre_raw" });
          if (backup.materias.length > 0) await supabase.from("materias").upsert(backup.materias, { onConflict: "nombre_raw" });
          limpiarCache();
          showToast(`✅ Backup restaurado: ${backup.horarios.length} clases`, "success");
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
    const reader = new FileReader();
    reader.onload = async (e) => {
      const workbook = XLSX.read(e.target.result, { type: "binary" });
      const allRows = [];
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        let headerRowIdx = -1, horaColIdx = -1;
        let diaCols = { LUNES: -1, MARTES: -1, "MIÉRCOLES": -1, JUEVES: -1, VIERNES: -1 };
        for (let i = 0; i < json.length; i++) {
          const row = json[i]; if (!row) continue;
          const horaIdx = row.findIndex(cell => cell?.toString().trim().toUpperCase() === "HORA");
          if (horaIdx !== -1) {
            headerRowIdx = i; horaColIdx = horaIdx;
            for (let j = 0; j < row.length; j++) {
              const cell = row[j]?.toString().toUpperCase().trim();
              if (cell === "LUNES") diaCols.LUNES = j;
              else if (cell === "MARTES") diaCols.MARTES = j;
              else if (cell === "MIÉRCOLES") diaCols["MIÉRCOLES"] = j;
              else if (cell === "JUEVES") diaCols.JUEVES = j;
              else if (cell === "VIERNES") diaCols.VIERNES = j;
            }
            break;
          }
        }
        if (headerRowIdx === -1) continue;
        const merges = worksheet["!merges"] || [];
        const mergeMap = {};
        merges.forEach(merge => { for (let r = merge.s.r; r <= merge.e.r; r++) for (let c = merge.s.c; c <= merge.e.c; c++) mergeMap[`${r}-${c}`] = { sr: merge.s.r, er: merge.e.r, sc: merge.s.c, ec: merge.e.c }; });
        let programa = "", trayecto = "", seccion = "", turno = "", sede = "", aula = "";
        for (let i = 0; i < headerRowIdx; i++) {
          const row = json[i]; if (!row) continue;
          for (let j = 0; j < row.length; j++) {
            const cv = row[j]?.toString().trim(); if (!cv) continue;
            if (cv === "PROGRAMA" && !programa) programa = row[j + 1]?.toString().trim() || "";
            else if (cv === "TRAYECTO" && !trayecto) trayecto = row[j + 1]?.toString().trim() || "";
            else if (cv === "Sede:" && !sede) sede = row[j + 1]?.toString().trim() || "";
            else if (cv === "AULA" && !aula) aula = row[j + 1]?.toString().trim() || "";
            else if (cv === "Sección" && !seccion) seccion = row[j + 1]?.toString().trim() || row[j + 2]?.toString().trim() || "";
            else if (cv === "Turno" && !turno) turno = row[j + 1]?.toString().trim() || row[j + 2]?.toString().trim() || "";
          }
        }
        programa = selectedPrograma !== "todos" ? selectedPrograma : (programa ? normalizarPrograma(programa) || programa : "Sin programa");
        const turnoFromCodigo = getTurnoByCodigo(sheetName) || normalizeTurno(turno) || turno;
        turno = turnoFromCodigo;
        const processedMerges = new Set();
        for (let i = headerRowIdx + 1; i < json.length; i++) {
          const row = json[i]; if (!row) continue;
          for (const [dia, colIdx] of Object.entries(diaCols)) {
            if (colIdx === -1) continue;
            const clase = row[colIdx]?.toString().trim(); if (!clase) continue;
            const merge = mergeMap[`${i}-${colIdx}`];
            if (merge && processedMerges.has(`${merge.sr}-${merge.sc}`)) continue;
            let horaCompleta = "";
            if (merge) {
              processedMerges.add(`${merge.sr}-${merge.sc}`);
              const fr = json[merge.sr], lr = json[merge.er];
              const hi = fr[horaColIdx]?.toString().trim().split(/[-–]/)[0]?.trim();
              const hf = lr[horaColIdx]?.toString().trim().split(/[-–]/)[1]?.trim() || lr[horaColIdx]?.toString().trim().split(/[-–]/)[0]?.trim();
              horaCompleta = hf ? `${hi} - ${hf}` : hi;
            } else horaCompleta = row[horaColIdx]?.toString().trim() || "";
            if (!horaCompleta) continue;
            // ✅ Incluir el lapso actual en cada registro
            allRows.push({ sheet: sheetName, programa, trayecto, seccion, turno, sede, aula: aula || null, dia, hora: horaCompleta, clase, lapso: lapso || null });
          }
        }
      }
      if (!allRows.length) {
        setError("No se encontraron datos válidos.");
        showToast("⚠️ No se encontraron datos válidos en el archivo.", "warning");
        setUploading(false);
        return;
      }
      const sheetsEnArchivo = [...new Set(allRows.map(r => r.sheet))];
      const programasEnArchivo = [...new Set(allRows.map(r => r.programa))];
      let dupQuery = supabase.from("horarios").select("sheet, dia, hora, clase, programa").in("sheet", sheetsEnArchivo).in("programa", programasEnArchivo);
      if (lapso) dupQuery = dupQuery.eq("lapso", lapso);
      const { data: existingData } = await dupQuery;
      const existingKeys = new Set(existingData?.map(r => `${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`) || []);
      const newRows = allRows.filter(r => !existingKeys.has(`${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`));
      if (!newRows.length) { showToast("⚠️ Sin registros nuevos.", "warning"); setUploading(false); return; }
      const { error: insertError } = await supabase.from("horarios").insert(newRows);
      if (insertError) showToast("❌ Error al guardar.", "error");
      else {
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
      }
      setUploading(false);
    };
    reader.onerror = () => { setError("Error al leer el archivo."); setUploading(false); };
    reader.readAsBinaryString(file);
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

  const conflicts = useMemo(() => {
    const issues = [];
    const parseRango = (hora) => {
      if (!hora) return null;
      const parts = hora.trim().split(/[-–]/);
      const inicio = timeToMin(parts[0]?.trim());
      if (inicio === 0) return null;
      const fin = parts[1] ? timeToMin(parts[1]?.trim()) : inicio + 45;
      return { inicio, fin: fin > inicio ? fin : inicio + 45 };
    };
    const solapan = (a, b) => a.inicio < b.fin && b.inicio < a.fin;
    const tienenConflicto = (entA, entB) => {
      const ra = parseRango(entA.hora);
      const rb = parseRango(entB.hora);
      if (ra && rb) return solapan(ra, rb);
      return entA.hora?.trim() === entB.hora?.trim();
    };
    Object.entries(byDocente).forEach(([doc, entries]) => {
      DAYS.forEach(day => {
        const enDia = entries.filter(e => e.dia === day);
        if (enDia.length < 2) return;
        for (let i = 0; i < enDia.length; i++) {
          for (let j = i + 1; j < enDia.length; j++) {
            const a = enDia[i], b = enDia[j];
            if (!tienenConflicto(a, b)) continue;
            const grupoExistente = issues.find(c => c.docente === doc && c.dia === day && (c.entries.includes(a) || c.entries.includes(b)));
            if (grupoExistente) {
              if (!grupoExistente.entries.includes(a)) grupoExistente.entries.push(a);
              if (!grupoExistente.entries.includes(b)) grupoExistente.entries.push(b);
            } else {
              issues.push({ docente: doc, dia: day, hora: a.hora, entries: [a, b] });
            }
          }
        }
      });
    });
    return issues;
  }, [byDocente]);

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
    byDocente, byMateria, conflicts, stats, allTrayectos,
    isOffline, lastSync, toast, showToast, hideToast,
    confirmModal, openConfirm, closeConfirm,
    handleLogout, handleFileUpload, exportarDatos, importarDatos, clearAllData,
    saveDocenteName, saveMateriaName, getDocName, getMateriaName,
  };
}
