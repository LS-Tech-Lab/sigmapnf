// Caché en memoria de los nombres "display" de programas, docentes y
// materias, cruzados contra sus claves "raw" tal como aparecen en los
// horarios importados. Extraído de useAppData.js.

import { useState, useCallback } from "react";
import { DEFAULT_PROGRAMAS } from "../../constants";
import { normalizarPrograma } from "../../utils/parsing";
import { supabase } from "../../lib/supabase";
import { guardarEnCache, cargarDeCache, getCacheKey, CACHE_KEYS } from "../../utils/cache";
import { logger } from "../../utils/logger";

export default function useNombresCache(userId = null, showToast = null, sedeActiva = null) {
  const [programasDisponibles, setProgramasDisponibles] = useState(["todos", ...DEFAULT_PROGRAMAS]);
  const [docenteNames, setDocenteNames] = useState({});
  const [docenteCedulas, setDocenteCedulas] = useState({});
  const [docenteCedulaFuentes, setDocenteCedulaFuentes] = useState({});
  const [materiaNames, setMateriaNames] = useState({});

  // SEDE-6: clave de caché por sede -- sin esto, cambiar de sede activa
  // podía mostrar por un instante nombres cacheados de la sede anterior.
  const cacheKeySede = useCallback((base) => (sedeActiva ? `${base}_s_${sedeActiva}` : base), [sedeActiva]);

  const fetchProgramas = useCallback(async (lapsoActual) => {
    let query = supabase.from("horarios").select("programa").not("programa", "is", null);
    if (lapsoActual) query = query.eq("lapso", lapsoActual);
    // SEDE-6: mismo filtro que useDataSync -- sin esto, un admin con
    // puedeVerTodasLasSedes veía en el dropdown programas de sedes que
    // no eran la elegida.
    if (sedeActiva) query = query.eq("sede_id", sedeActiva);
    const { data: programas } = await query;

    // PROG-4 (12 ago 2026): el "relleno" del dropdown (programas del
    // catálogo que todavía no aparecen en ningún horario real de esta
    // sede/lapso) se filtra a los activos en `sedeActiva` -- sin sede
    // puntual (admin viendo todas las sedes) se mantiene el catálogo
    // completo, mismo criterio que useProgramasActivosPorSede.js. Los
    // programas que SÍ vienen de datos reales (`unique`, abajo) nunca se
    // ocultan por esto -- un horario ya importado no desaparece del
    // dropdown solo porque alguien desactivó el programa después.
    let defaultsPermitidos = DEFAULT_PROGRAMAS;
    if (sedeActiva) {
      const { data: activos } = await supabase
        .from("sedes_programas")
        .select("activo, programas(nombre, activa)")
        .eq("sede_id", sedeActiva);
      if (activos) {
        const nombresActivos = new Set(
          activos.filter(a => a.activo && a.programas?.activa).map(a => a.programas.nombre)
        );
        if (nombresActivos.size > 0) {
          defaultsPermitidos = DEFAULT_PROGRAMAS.filter(p => nombresActivos.has(p));
        }
      }
    }

    if (programas) {
      const canonicalSet = new Map();
      programas.forEach(p => { if (p.programa?.trim()) { const canon = normalizarPrograma(p.programa); if (canon) canonicalSet.set(canon, true); } });
      const unique = [...canonicalSet.keys()].sort();
      const defaults = defaultsPermitidos.filter(p => !unique.some(u => u.toLowerCase() === p.toLowerCase()));
      setProgramasDisponibles(["todos", ...unique, ...defaults]);
    }
  }, [sedeActiva]);

  const fetchDocenteNames = useCallback(async () => {
    const cachedDocentes = cargarDeCache(cacheKeySede(CACHE_KEYS.docentes), userId, { offlineMode: !navigator.onLine });
    if (cachedDocentes) setDocenteNames(cachedDocentes);
    const cachedCedulas = cargarDeCache(cacheKeySede(CACHE_KEYS.docenteCedulas), userId, { offlineMode: !navigator.onLine });
    if (cachedCedulas) setDocenteCedulas(cachedCedulas);
    try {
      // Usar docentes_con_cedula() que incluye cédulas vinculadas automáticamente
      // por asistencia QR, no solo las vinculadas manualmente.
      // SEDE-6: docentes_con_cedula() es SECURITY DEFINER (bypassa RLS) y
      // hasta 0066 no tenía NINGÚN filtro de sede -- devolvía docentes de
      // todas las sedes a cualquier usuario. Ahora exige p_sede_id (o
      // resuelve la sede fija del perfil si no se manda ninguno).
      const { data: docentes, error: rpcError } = await supabase.rpc(
        "docentes_con_cedula",
        sedeActiva ? { p_sede_id: sedeActiva } : {}
      );
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
        guardarEnCache(cacheKeySede(CACHE_KEYS.docentes), m, userId);
        guardarEnCache(cacheKeySede(CACHE_KEYS.docenteCedulas), c, userId);
      }
    } catch (err) {
      // Fallback: consulta directa a la tabla si la RPC aún no existe
      logger.warn("docentes_con_cedula() no disponible, usando fallback:", err);
      try {
        let query = supabase.from("docentes").select("*");
        if (sedeActiva) query = query.eq("sede_id", sedeActiva);
        const { data: docentes } = await query;
        if (docentes) {
          const m = {}, c = {};
          docentes.forEach(d => { m[d.nombre_raw] = d.nombre_display; if (d.cedula) c[d.nombre_raw] = d.cedula; });
          setDocenteNames(m);
          setDocenteCedulas(c);
          setDocenteCedulaFuentes({});  // fallback no tiene fuente
          guardarEnCache(cacheKeySede(CACHE_KEYS.docentes), m, userId);
          guardarEnCache(cacheKeySede(CACHE_KEYS.docenteCedulas), c, userId);
        }
      } catch (fallbackErr) {
        // Fix #15: segundo intento tras 3 s antes de rendirse y avisar al usuario
        logger.warn("Fallback de docentes también falló, reintentando en 3 s:", fallbackErr);
        setTimeout(async () => {
          try {
            let queryRetry = supabase.from("docentes").select("*");
            if (sedeActiva) queryRetry = queryRetry.eq("sede_id", sedeActiva);
            const { data: docentesRetry } = await queryRetry;
            if (docentesRetry) {
              const m = {}, c = {};
              docentesRetry.forEach(d => { m[d.nombre_raw] = d.nombre_display; if (d.cedula) c[d.nombre_raw] = d.cedula; });
              setDocenteNames(m);
              setDocenteCedulas(c);
              setDocenteCedulaFuentes({});
              guardarEnCache(cacheKeySede(CACHE_KEYS.docentes), m, userId);
              guardarEnCache(cacheKeySede(CACHE_KEYS.docenteCedulas), c, userId);
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
  }, [userId, showToast, sedeActiva, cacheKeySede]);

  const fetchMateriaNames = useCallback(async () => {
    const cachedMaterias = cargarDeCache(cacheKeySede(CACHE_KEYS.materias), userId, { offlineMode: !navigator.onLine });
    if (cachedMaterias) setMateriaNames(cachedMaterias);
    try {
      // SEDE-6: sin este filtro, RLS deja pasar todas las sedes para
      // roles con puedeVerTodasLasSedes -- ver mismo fix en useDataSync.
      let query = supabase.from("materias").select("*");
      if (sedeActiva) query = query.eq("sede_id", sedeActiva);
      const { data: materias } = await query;
      if (materias) {
        const m = {};
        materias.forEach(d => { m[d.nombre_raw] = d.nombre_display; });
        setMateriaNames(m);
        guardarEnCache(cacheKeySede(CACHE_KEYS.materias), m, userId);
      }
    } catch (err) {
      logger.warn("Error fetching materias:", err);
      if (cachedMaterias) setMateriaNames(cachedMaterias);
    }
  }, [userId, sedeActiva, cacheKeySede]);

  const getDocName = useCallback((raw) => docenteNames[raw] || raw, [docenteNames]);
  const getDocCedula = useCallback((raw) => docenteCedulas[raw] || "", [docenteCedulas]);
  const getDocCedulaFuente = useCallback((raw) => docenteCedulaFuentes[raw] || null, [docenteCedulaFuentes]);
  const getMateriaName = useCallback((raw) => materiaNames[raw] || raw, [materiaNames]);

  // Invalida el caché de cédulas para que el próximo fetchDocenteNames
  // vaya directo a la RPC sin leer datos viejos del localStorage.
  const invalidarCacheDocentes = useCallback(() => {
    try {
      const k1 = getCacheKey(cacheKeySede(CACHE_KEYS.docentes), userId);
      const k2 = getCacheKey(cacheKeySede(CACHE_KEYS.docenteCedulas), userId);
      localStorage.removeItem(k1);
      localStorage.removeItem(k2);
    } catch (_) {}
  }, [userId, cacheKeySede]);

  return {
    programasDisponibles, docenteNames, docenteCedulas, docenteCedulaFuentes, materiaNames,
    setDocenteNames, setDocenteCedulas, setMateriaNames,
    fetchProgramas, fetchDocenteNames, fetchMateriaNames, invalidarCacheDocentes,
    getDocName, getDocCedula, getDocCedulaFuente, getMateriaName,
  };
}
