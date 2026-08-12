/**
 * useProgramasActivosPorSede.js
 *
 * PROG-4 (12 ago 2026). Carga la relación `sedes_programas` (migración
 * 0090) y arma un mapa { sede_id: Set<nombrePrograma> } con los
 * programas activos (activo=true en la relación Y programas.activa=true
 * en el catálogo) de cada sede. Es el punto de consumo compartido para
 * cualquier selector de programa que deba respetar "no todos los
 * programas están activos en todas las sedes" (ModalUsuario, AdminQRPanel,
 * useNombresCache) -- todos preguntan a este mismo mapa en vez de repetir
 * el join cada uno por su cuenta.
 *
 * Devuelve también `catalogoNombres` (todos los programas activos del
 * catálogo, sin filtrar por sede) para los casos donde no hay una sede
 * puntual que filtrar (rol que ve todas las sedes, o ningún sede_id
 * elegido todavía) -- mismo criterio que useSedes/useProgramas: mostrar
 * todo el catálogo activo cuando no hay una sede específica en juego.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";

export default function useProgramasActivosPorSede(userId) {
  const [filas, setFilas] = useState([]); // [{sede_id, programa_id, activo, programas: {nombre, activa}}]
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    if (!userId) {
      setFilas([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("sedes_programas")
      .select("sede_id, programa_id, activo, programas(nombre, activa)");

    if (error) {
      console.error("useProgramasActivosPorSede: error al cargar sedes_programas", error);
      setFilas([]);
    } else {
      setFilas(data || []);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const mapaPorSede = useMemo(() => {
    const mapa = {};
    for (const fila of filas) {
      if (!fila.activo || !fila.programas?.activa) continue;
      if (!mapa[fila.sede_id]) mapa[fila.sede_id] = new Set();
      mapa[fila.sede_id].add(fila.programas.nombre);
    }
    return mapa;
  }, [filas]);

  const catalogoNombres = useMemo(() => {
    const nombres = new Set();
    for (const fila of filas) {
      if (fila.programas?.activa) nombres.add(fila.programas.nombre);
    }
    return [...nombres].sort();
  }, [filas]);

  /** Programas activos (nombres) de una sede puntual, o el catálogo
   *  completo si no se pasa sedeId (ver nota de diseño arriba). */
  const programasActivosDe = useCallback((sedeId) => {
    if (!sedeId) return catalogoNombres;
    const set = mapaPorSede[sedeId];
    return set ? [...set].sort() : [];
  }, [mapaPorSede, catalogoNombres]);

  return { mapaPorSede, catalogoNombres, programasActivosDe, loading, refetch: cargar };
}
