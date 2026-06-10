import { DAYS, ALL_TRAYECTOS, DEFAULT_PROGRAMAS } from "../constants";
import { getTurnoByCodigo, normalizeTurno } from "../utils/turno";
import { normalizarPrograma, parseClase } from "../utils/parsing";

import { useState, useEffect, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import {
  guardarEnCache, cargarDeCache,
  CACHE_KEYS, limpiarCache, obtenerUltimaSincronizacion
} from "../utils/cache";
import { normalizarPrograma, parseClase } from "../utils/parsing";
import { DEFAULT_PROGRAMAS } from "../constants";

export default function useAppData() {
  const [user, setUser] = useState(undefined);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPrograma, setSelectedPrograma] = useState("todos");
  const [programasDisponibles, setProgramasDisponibles] = useState(["todos", ...DEFAULT_PROGRAMAS]);
  const [docenteNames, setDocenteNames] = useState({});
  const [materiaNames, setMateriaNames] = useState({});
  const [toast, setToast] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [lastSync, setLastSync] = useState(obtenerUltimaSincronizacion());

  // Conexión
  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); showToast("✅ Conexión restablecida.", "success"); fetchHorarios(); fetchDocenteNames(); fetchMateriaNames(); };
    const handleOffline = () => { setIsOffline(true); showToast("⚠️ Sin conexión. Usando caché.", "warning"); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, []);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const showToast = useCallback((message, type = "success") => {
    setToast(null);
    setTimeout(() => setToast({ message, type }), 50);
  }, []);

  const fetchProgramas = async () => {
    const { data: programas } = await supabase.from("horarios").select("programa").not("programa", "is", null);
    if (programas) {
      const canonicalSet = new Map();
      programas.forEach(p => { if (p.programa?.trim()) { const canon = normalizarPrograma(p.programa); if (canon) canonicalSet.set(canon, true); } });
      const unique = [...canonicalSet.keys()].sort();
      const defaults = DEFAULT_PROGRAMAS.filter(p => !unique.some(u => u.toLowerCase() === p.toLowerCase()));
      setProgramasDisponibles(["todos", ...unique, ...defaults]);
    }
  };

  const fetchHorarios = async () => {
    setLoading(true);
    const cachedHorarios = cargarDeCache(CACHE_KEYS.horarios);
    if (cachedHorarios?.length > 0) {
      setData(cachedHorarios);
      setLoading(false);
    }
    try {
      let query = supabase.from("horarios").select("*");
      if (selectedPrograma !== "todos") query = query.eq("programa", selectedPrograma);
      const { data: horarios, error } = await query.order("id", { ascending: true });
      if (error) {
        console.error(error);
        if (cachedHorarios?.length > 0) {
          setData(cachedHorarios);
          showToast("⚠️ Error de conexión. Usando caché.", "warning");
        } else setError(error.message);
      } else {
        const nuevosDatos = horarios || [];
        setData(nuevosDatos);
        guardarEnCache(CACHE_KEYS.horarios, nuevosDatos);
        localStorage.setItem(CACHE_KEYS.lastSync, Date.now().toString());
        setLastSync(obtenerUltimaSincronizacion());
      }
    } catch (err) {
      console.error(err);
      if (cachedHorarios?.length > 0) {
        setData(cachedHorarios);
        showToast("⚠️ Modo offline: usando caché.", "warning");
      }
    }
    setLoading(false);
  };

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

  useEffect(() => { fetchProgramas(); fetchDocenteNames(); fetchMateriaNames(); }, []);
  useEffect(() => { fetchHorarios(); }, [selectedPrograma]);

  const unifyName = async (tableName, rawName, newDisplayName) => {
    const { data: existing } = await supabase.from(tableName).select("nombre_raw, nombre_display").ilike("nombre_display", newDisplayName.trim()).neq("nombre_raw", rawName).limit(1);
    if (existing?.length > 0) {
      const { nombre_raw: targetRaw, nombre_display: canonicalDisplay } = existing[0];
      const { data: horarios } = await supabase.from("horarios").select("id, clase");
      if (horarios) for (const row of horarios) { if (!row.clase?.includes(rawName)) continue; const nc = row.clase.split(rawName).join(targetRaw); if (nc !== row.clase) await supabase.from("horarios").update({ clase: nc }).eq("id", row.id); }
      await supabase.from(tableName).delete().eq("nombre_raw", rawName);
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

  const clearAllData = async () => {
    if (!window.confirm("⚠️ ¿Eliminar TODOS los horarios? Se recomienda hacer un backup primero.")) return;
    setLoading(true);
    let query = supabase.from("horarios").delete();
    if (selectedPrograma !== "todos") query = query.eq("programa", selectedPrograma); else query = query.neq("id", 0);
    const { error } = await query;
    if (error) showToast("❌ Error al borrar.", "error");
    else { showToast("✅ Datos eliminados.", "success"); limpiarCache(); await fetchHorarios(); await fetchProgramas(); }
    setLoading(false);
  };

  const exportarDatos = async () => {
    try {
      showToast("📦 Preparando backup...", "info");
      const [horariosRes, docentesRes, materiasRes] = await Promise.all([
        supabase.from("horarios").select("*"),
        supabase.from("docentes").select("*"),
        supabase.from("materias").select("*"),
      ]);
      const backup = {
        version: "1.0",
        fecha: new Date().toISOString(),
        programa: selectedPrograma,
        horarios: horariosRes.data || [],
        docentes: docentesRes.data || [],
        materias: materiasRes.data || [],
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-horarios-${new Date().toISOString().slice(0, 10)}.json`;
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

  const importarDatos = async (file) => {
    if (!window.confirm("⚠️ ¿Estás seguro? Esto REEMPLAZARÁ todos los datos actuales.")) return;
    setUploading(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.horarios || !backup.docentes || !backup.materias) throw new Error("El archivo no tiene el formato correcto de backup");
      await supabase.from("horarios").delete().neq("id", 0);
      await supabase.from("docentes").delete().neq("id", 0);
      await supabase.from("materias").delete().neq("id", 0);
      if (backup.horarios.length > 0) await supabase.from("horarios").insert(backup.horarios);
      if (backup.docentes.length > 0) await supabase.from("docentes").upsert(backup.docentes, { onConflict: "nombre_raw" });
      if (backup.materias.length > 0) await supabase.from("materias").upsert(backup.materias, { onConflict: "nombre_raw" });
      limpiarCache();
      showToast(`✅ Backup restaurado: ${backup.horarios.length} clases`, "success");
      await fetchHorarios();
      await fetchProgramas();
      await fetchDocenteNames();
      await fetchMateriaNames();
    } catch (err) {
      console.error("Error al importar:", err);
      showToast("❌ Error al restaurar backup: " + err.message, "error");
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (file) => {
    setUploading(true); setError(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const workbook = XLSX.read(e.target.result, { type: "binary" });
      const allRows = [];
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        let headerRowIdx = -1, horaColIdx = -1;
        let diaCols = { LUNES: -1, MARTES: -1, MIÉRCOLES: -1, JUEVES: -1, VIERNES: -1 };
        for (let i = 0; i < json.length; i++) {
          const row = json[i]; if (!row) continue;
          const horaIdx = row.findIndex(cell => cell?.toString().trim().toUpperCase() === "HORA");
          if (horaIdx !== -1) {
            headerRowIdx = i; horaColIdx = horaIdx;
            for (let j = 0; j < row.length; j++) {
              const cell = row[j]?.toString().toUpperCase().trim();
              if (cell === "LUNES") diaCols.LUNES = j;
              else if (cell === "MARTES") diaCols.MARTES = j;
              else if (cell === "MIÉRCOLES") diaCols.MIÉRCOLES = j;
              else if (cell === "JUEVES") diaCols.JUEVES = j;
              else if (cell === "VIERNES") diaCols.VIERNES = j;
            }
            break;
          }
        }
        if (headerRowIdx === -1) continue;
        const merges = worksheet['!merges'] || [];
        const mergeMap = {};
        merges.forEach(merge => { for (let r = merge.s.r; r <= merge.e.r; r++) for (let c = merge.s.c; c <= merge.e.c; c++) mergeMap[`${r}-${c}`] = { sr: merge.s.r, er: merge.e.r, sc: merge.s.c, ec: merge.e.c }; });
        let programa = "", trayecto = "", seccion = "", turno = "", sede = "", aula = "";
        for (let i = 0; i < headerRowIdx; i++) {
          const row = json[i]; if (!row) continue;
          for (let j = 0; j < row.length; j++) {
            const cv = row[j]?.toString().trim(); if (!cv) continue;
            if (cv === "PROGRAMA" && !programa) programa = row[j+1]?.toString().trim() || "";
            else if (cv === "TRAYECTO" && !trayecto) trayecto = row[j+1]?.toString().trim() || "";
            else if (cv === "Sede:" && !sede) sede = row[j+1]?.toString().trim() || "";
            else if (cv === "AULA" && !aula) aula = row[j+1]?.toString().trim() || "";
            else if (cv === "Sección" && !seccion) seccion = row[j+1]?.toString().trim() || row[j+2]?.toString().trim() || "";
            else if (cv === "Turno" && !turno) turno = row[j+1]?.toString().trim() || row[j+2]?.toString().trim() || "";
          }
        }
        programa = selectedPrograma !== "todos" ? selectedPrograma : (programa ? normalizarPrograma(programa) || programa : "Sin programa");
        const { getTurnoByCodigo } = ("../utils/turno");
        const { normalizeTurno } = ("../utils/turno");
        turno = getTurnoByCodigo(sheetName) || normalizeTurno(turno) || turno;
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
            allRows.push({ sheet: sheetName, programa, trayecto, seccion, turno, sede, aula: aula || null, dia, hora: horaCompleta, clase });
          }
        }
      }
      if (!allRows.length) { setError("No se encontraron datos válidos."); setUploading(false); return; }
      const { data: existingData } = await supabase.from("horarios").select("sheet, dia, hora, clase, programa");
      const existingKeys = new Set(existingData?.map(r => `${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`) || []);
      const newRows = allRows.filter(r => !existingKeys.has(`${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`));
      if (!newRows.length) { showToast("⚠️ Sin registros nuevos.", "warning"); setUploading(false); return; }
      const { error: insertError } = await supabase.from("horarios").insert(newRows);
      if (insertError) showToast("❌ Error al guardar.", "error");
      else {
        showToast(`✅ ${newRows.length} clases cargadas.`, "success");
        await fetchHorarios();
        await fetchProgramas();
        const docs = new Set(), mats = new Set();
        newRows.forEach(r => { const { docente, materia } = parseClase(r.clase); if (docente) docs.add(docente); if (materia) mats.add(materia); });
        for (const d of docs) await supabase.from("docentes").upsert({ nombre_raw: d, nombre_display: d }, { onConflict: "nombre_raw" });
        for (const m of mats) await supabase.from("materias").upsert({ nombre_raw: m, nombre_display: m }, { onConflict: "nombre_raw" });
        await fetchDocenteNames();
        await fetchMateriaNames();
      }
      setUploading(false);
    };
    reader.onerror = () => { setError("Error al leer el archivo."); setUploading(false); };
    reader.readAsBinaryString(file);
  };

  // Computed values
  const byDocente = useMemo(() => {
    const m = {};
    data.forEach(d => { const { docente } = parseClase(d.clase); if (docente) { if (!m[docente]) m[docente] = []; m[docente].push(d); } });
    return m;
  }, [data]);

  const byMateria = useMemo(() => {
    const m = {};
    data.forEach(d => { const { materia } = parseClase(d.clase); if (materia) { if (!m[materia]) m[materia] = []; m[materia].push(d); } });
    return m;
  }, [data]);

  const conflicts = useMemo(() => {
    const issues = [];
    Object.entries(byDocente).forEach(([doc, entries]) => {
      const { DAYS } = ("../constants");
      DAYS.forEach(day => {
        [...new Set(entries.map(e => e.hora?.trim()))].filter(Boolean).forEach(hora => {
          const matches = entries.filter(e => e.dia === day && e.hora?.trim() === hora);
          if (matches.length > 1) issues.push({ docente: doc, dia: day, hora, entries: matches });
        });
      });
    });
    return issues;
  }, [byDocente]);

  const allTrayectos = useMemo(() => [...new Set(data.map(d => d.trayecto))].sort((a, b) => {
    const { ALL_TRAYECTOS } = ("../constants");
    return ALL_TRAYECTOS.indexOf(a) - ALL_TRAYECTOS.indexOf(b);
  }), [data]);

  const stats = useMemo(() => ({
    total: data.length,
    secciones: new Set(data.map(d => d.sheet.trim())).size,
    docentes: Object.keys(byDocente).length,
    materias: Object.keys(byMateria).length,
  }), [data, byDocente, byMateria]);

  const getDocName = useCallback((raw) => docenteNames[raw] || raw, [docenteNames]);
  const getMateriaName = useCallback((raw) => materiaNames[raw] || raw, [materiaNames]);

  return {
    user, loading, uploading, error, selectedPrograma, setSelectedPrograma,
    programasDisponibles, data, docenteNames, materiaNames,
    byDocente, byMateria, conflicts, stats, allTrayectos,
    isOffline, lastSync, toast, showToast,
    handleLogout, handleFileUpload, exportarDatos, importarDatos, clearAllData,
    saveDocenteName, saveMateriaName, getDocName, getMateriaName,
  };
}
