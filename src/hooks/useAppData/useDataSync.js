// Carga y sincronización de horarios: fetch paginado contra Supabase con
// caché local, estado de conexión (online/offline), suscripción realtime,
// y los datos derivados (agrupación por docente/materia, trayectos, stats).
// Extraído de useAppData.js.

import { useState, useEffect, useMemo, useCallback } from "react";
import { ALL_TRAYECTOS } from "../../constants";
import { parseClase } from "../../utils/parsing";
import { supabase } from "../../lib/supabase";
import { suscribirCambiosRemotos } from "../../lib/realtime";
import {
  guardarEnCache, cargarDeCache,
  CACHE_KEYS, limpiarCache, obtenerUltimaSincronizacion, getCacheKey,
} from "../../utils/cache";

// Invalida solo las claves de nombres (docentes/materias) para un usuario dado,
// sin afectar el caché de horarios. Usado por los listeners realtime de #7.
function limpiarCacheNombres(userId) {
  const keys = [CACHE_KEYS.docentes, CACHE_KEYS.docenteCedulas, CACHE_KEYS.materias];
  keys.forEach(k => localStorage.removeItem(getCacheKey(k, userId)));
}

const PAGE_SIZE = 500;

export default function useDataSync({
  lapso, selectedPrograma, showToast,
  fetchDocenteNames, fetchMateriaNames, fetchProgramas,
  setConflictsRefreshKey,
  userId,
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [lastSync, setLastSync] = useState(obtenerUltimaSincronizacion());

  // Fix #12: usar siempre una clave explícita para evitar colisiones entre
  // "sin lapso" y futuros lapsos: `horarios_nolap` vs `horarios_2025-1`.
  const cacheKey = lapso ? `${CACHE_KEYS.horarios}_${lapso}` : `${CACHE_KEYS.horarios}_nolap`;

  const fetchHorarios = useCallback(async (programa) => {
    const cachedHorarios = cargarDeCache(cacheKey, userId);
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
          .select("*, docentes(nombre_raw), materias(nombre_raw)")
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
      guardarEnCache(cacheKey, todasLasFilas, userId);
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
  }, [lapso, cacheKey, showToast, userId]);

  useEffect(() => { fetchProgramas(lapso); fetchDocenteNames(); fetchMateriaNames(); }, [lapso, fetchProgramas, fetchDocenteNames, fetchMateriaNames]);
  useEffect(() => { fetchHorarios(selectedPrograma); }, [selectedPrograma, lapso, fetchHorarios]);

  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); showToast("✅ Conexión restablecida.", "success"); fetchHorarios(selectedPrograma); fetchDocenteNames(); fetchMateriaNames(); };
    const handleOffline = () => { setIsOffline(true); showToast("⚠️ Sin conexión. Usando caché.", "warning"); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, [selectedPrograma, fetchHorarios, showToast]);

  // Suscripción realtime: verificar sesión activa con getSession() en lugar de
  // mantener un useState(user) propio que duplicaba el listener de useAuth.
  useEffect(() => {
    let cancelar = () => {};
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      cancelar = suscribirCambiosRemotos({
        lapso,
        onHorariosChange: () => {
          limpiarCache(userId);
          fetchHorarios(selectedPrograma);
          setConflictsRefreshKey(k => k + 1);
          showToast("🔄 Horarios actualizados por otro usuario.", "info");
        },
        onDocentesChange: () => {
          // Fix #7: invalidar caché de docentes antes de re-fetch para que
          // el listener remoto no aplique el caché stale antes del resultado fresco.
          limpiarCacheNombres(userId);
          fetchDocenteNames();
          setConflictsRefreshKey(k => k + 1);
        },
        onMateriasChange: () => {
          limpiarCacheNombres(userId);
          fetchMateriaNames();
        },
      });
    });
    return () => cancelar();
  }, [lapso, selectedPrograma, fetchHorarios, fetchDocenteNames, fetchMateriaNames, showToast]);

  const byDocente = useMemo(() => {
    const m = {};
    if (!data) return m;
    data.forEach(d => {
      // Prioridad: join docentes(nombre_raw) > parseClase(clase) como fallback
      // para registros legacy sin docente_id vinculado.
      const key = d.docentes?.nombre_raw || parseClase(d.clase).docente || null;
      if (key) { if (!m[key]) m[key] = []; m[key].push(d); }
    });
    return m;
  }, [data]);

  const byMateria = useMemo(() => {
    const m = {};
    if (!data) return m;
    data.forEach(d => {
      // Prioridad: join materias(nombre_raw) > columna materia (si existe) >
      // parseClase(clase) como último recurso para registros legacy.
      const key = d.materias?.nombre_raw || d.materia || parseClase(d.clase).materia || null;
      if (key) { if (!m[key]) m[key] = []; m[key].push(d); }
    });
    return m;
  }, [data]);

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

  return {
    data, setData, loading, setLoading, isSyncing, error, setError,
    isOffline, lastSync, fetchHorarios,
    byDocente, byMateria, allTrayectos, stats,
  };
}
