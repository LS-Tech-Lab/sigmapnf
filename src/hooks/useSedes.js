/**
 * useSedes.js
 *
 * Carga el catálogo de sedes (tabla `sedes`, migración 0061) ordenado
 * por `orden`. Solo lectura — altas/bajas de sedes no son parte de
 * SEDE-1/SEDE-2, se gestionan directo en la BD por ahora.
 *
 * Mismo patrón que otros catálogos de solo-lectura del sistema: se
 * resuelve una vez al montar, sin necesidad de realtime (las sedes no
 * cambian en caliente durante una sesión).
 */

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function useSedes() {
  const [sedes, setSedes] = useState([]);
  const [loadingSedes, setLoadingSedes] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from("sedes")
        .select("id, nombre, activa, orden")
        .order("orden", { ascending: true });

      if (cancelado) return;
      if (error) {
        // No hay una vía de fallo distinta a "lista vacía" acá: si esto
        // falla, el selector de sede simplemente no tiene opciones para
        // mostrar. Se loguea para no tragarse el error en silencio.
        console.error("useSedes: error al cargar catálogo de sedes", error);
        setSedes([]);
      } else {
        setSedes((data || []).filter(s => s.activa));
      }
      setLoadingSedes(false);
    })();
    return () => { cancelado = true; };
  }, []);

  return { sedes, loadingSedes };
}
