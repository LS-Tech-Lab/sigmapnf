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

  // ── Paginación por cursor (Mejora 4) ─────────────────────────────────
  // Itera páginas de PAGE_SIZE filas usando cursor sobre "id" hasta
  // agotar todos los registros. Muestra datos parciales en la UI tras
  // cada página para que el usuario no espere con pantalla en blanco.
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
      let hayMas  = true;

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
