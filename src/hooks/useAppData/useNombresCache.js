// Caché en memoria de los nombres "display" de programas, docentes y
// materias, cruzados contra sus claves "raw" tal como aparecen en los
// horarios importados. Extraído de useAppData.js.

import { useState, useCallback } from "react";
import { DEFAULT_PROGRAMAS } from "../../constants";
import { normalizarPrograma } from "../../utils/parsing";
import { supabase } from "../../lib/supabase";
import { guardarEnCache, cargarDeCache, getCacheKey, CACHE_KEYS } from "../../utils/cache";

export default function useNombresCache(userId = null, showToast = null) {
  const [programasDisponibles, setProgramasDisponibles] = useState(["todos", ...DEFAULT_PROGRAMAS]);
  const [docenteNames, setDocenteNames] = useState({});
  const [docenteCedulas, setDocenteCedulas] = useState({});
  const [docenteCedulaFuentes, setDocenteCedulaFuentes] = useState({});
  const [materiaNames, setMateriaNames] = useState({});

  const fetchProgramas = useCallback(async (lapsoActual) => {
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
  }, []);

  const fetchDocenteNames = useCallback(async () => {
    const cachedDocentes = cargarDeCache(CACHE_KEYS.docentes, userId, { offlineMode: !navigator.onLine });
    if (cachedDocentes) setDocenteNames(cachedDocentes);
    const cachedCedulas = cargarDeCache(CACHE_KEYS.docenteCedulas, userId, { offlineMode: !navigator.onLine });
    if (cachedCedulas) setDocenteCedulas(cachedCedulas);
    try {
      // Usar docentes_con_cedula() que incluye cédulas vinculadas automáticamente
      // por asistencia QR, no solo las vinculadas manualmente.
      const { data: docentes, error: rpcError } = await supabase.rpc("docentes_con_cedula");
      if (rpcError) throw rpcError;
      if (docentes) {
        const m = {}, c = {}, f = {};
        docentes.forEach(d => {
          m[d.nombre_raw] = d.nombre_display;
          if (d.cedula) c[d.nombre_raw] = d.cedula;
          if (d.cedula_fuente) f[d.nombre_raw] = d.cedula_fuente;
        });
        setDocenteNames(m);
        setDocenteCedulas(c);
        setDocenteCedulaFuentes(f);
        guardarEnCache(CACHE_KEYS.docentes, m, userId);
        guardarEnCache(CACHE_KEYS.docenteCedulas, c, userId);
      }
    } catch (err) {
      // Fallback: consulta directa a la tabla si la RPC aún no existe
      console.warn("docentes_con_cedula() no disponible, usando fallback:", err);
      try {
        const { data: docentes } = await supabase.from("docentes").select("*");
        if (docentes) {
          const m = {}, c = {};
          docentes.forEach(d => { m[d.nombre_raw] = d.nombre_display; if (d.cedula) c[d.nombre_raw] = d.cedula; });
          setDocenteNames(m);
          setDocenteCedulas(c);
          setDocenteCedulaFuentes({});  // fallback no tiene fuente
          guardarEnCache(CACHE_KEYS.docentes, m, userId);
          guardarEnCache(CACHE_KEYS.docenteCedulas, c, userId);
        }
      } catch (fallbackErr) {
        // Fix #15: segundo intento tras 3 s antes de rendirse y avisar al usuario
        console.warn("Fallback de docentes también falló, reintentando en 3 s:", fallbackErr);
        setTimeout(async () => {
          try {
            const { data: docentesRetry } = await supabase.from("docentes").select("*");
            if (docentesRetry) {
              const m = {}, c = {};
              docentesRetry.forEach(d => { m[d.nombre_raw] = d.nombre_display; if (d.cedula) c[d.nombre_raw] = d.cedula; });
              setDocenteNames(m);
              setDocenteCedulas(c);
              setDocenteCedulaFuentes({});
              guardarEnCache(CACHE_KEYS.docentes, m, userId);
              guardarEnCache(CACHE_KEYS.docenteCedulas, c, userId);
            }
          } catch {
            // Reintento también falló: usar caché y avisar
            if (cachedDocentes) setDocenteNames(cachedDocentes);
            if (cachedCedulas) setDocenteCedulas(cachedCedulas);
            showToast?.("⚠️ No se pudieron actualizar los nombres de docentes. Podrían estar desactualizados.", "warning");
          }
        }, 3000);
        if (cachedDocentes) setDocenteNames(cachedDocentes);
        if (cachedCedulas) setDocenteCedulas(cachedCedulas);
      }
    }
  }, [userId]);

  const fetchMateriaNames = useCallback(async () => {
    const cachedMaterias = cargarDeCache(CACHE_KEYS.materias, userId, { offlineMode: !navigator.onLine });
    if (cachedMaterias) setMateriaNames(cachedMaterias);
    try {
      const { data: materias } = await supabase.from("materias").select("*");
      if (materias) {
        const m = {};
        materias.forEach(d => { m[d.nombre_raw] = d.nombre_display; });
        setMateriaNames(m);
        guardarEnCache(CACHE_KEYS.materias, m, userId);
      }
    } catch (err) {
      console.warn("Error fetching materias:", err);
      if (cachedMaterias) setMateriaNames(cachedMaterias);
    }
  }, [userId]);

  const getDocName = useCallback((raw) => docenteNames[raw] || raw, [docenteNames]);
  const getDocCedula = useCallback((raw) => docenteCedulas[raw] || "", [docenteCedulas]);
  const getDocCedulaFuente = useCallback((raw) => docenteCedulaFuentes[raw] || null, [docenteCedulaFuentes]);
  const getMateriaName = useCallback((raw) => materiaNames[raw] || raw, [materiaNames]);

  // Invalida el caché de cédulas para que el próximo fetchDocenteNames
  // vaya directo a la RPC sin leer datos viejos del localStorage.
  const invalidarCacheDocentes = useCallback(() => {
    try {
      const k1 = getCacheKey(CACHE_KEYS.docentes, userId);
      const k2 = getCacheKey(CACHE_KEYS.docenteCedulas, userId);
      localStorage.removeItem(k1);
      localStorage.removeItem(k2);
    } catch (_) {}
  }, [userId]);

  return {
    programasDisponibles, docenteNames, docenteCedulas, docenteCedulaFuentes, materiaNames,
    setDocenteNames, setDocenteCedulas, setMateriaNames,
    fetchProgramas, fetchDocenteNames, fetchMateriaNames, invalidarCacheDocentes,
    getDocName, getDocCedula, getDocCedulaFuente, getMateriaName,
  };
}
