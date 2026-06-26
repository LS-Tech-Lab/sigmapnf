// =====================================================================
// useConflictos: detección de conflictos vía SQL (Prioridad 3)
//
// Antes: useAppData calculaba `conflicts` con un useMemo que recorría
// TODOS los pares de clases de TODOS los docentes en TODOS los días,
// en el cliente, en cada render donde cambiara `byDocente` (es decir,
// cada vez que cambiaban los datos). Complejidad O(n²) por docente.
//
// Ahora: se llama a la función SQL `conflictos_horario_detalle(lapso,
// programa)` (ver supabase/migrations/0004_conflictos_horario_sql.sql),
// que usa los índices (lapso, dia) y docente_id para resolver el mismo
// problema en la base de datos, ya filtrado por trimestre/programa.
//
// Fallback: si la RPC no existe todavía (entorno sin migrar) o falla,
// se recurre al cálculo local equivalente al que tenía useAppData, para
// no romper la app en despliegues que aún no aplicaron las migraciones
// de supabase/migrations/.
//
// Mejora 9: calcularConflictosLocal se extrajo a utils/conflictos.js
// como función pura, para poder testearla con Vitest sin montar el hook.
// =====================================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { parseClase } from "../utils/parsing";
import { calcularConflictosLocal } from "../utils/conflictos";

/**
 * Adapta el resultado de conflictos_horario_detalle (filas por par de
 * clases en conflicto) al shape que ya consumen los componentes:
 *   { docente, dia, hora, entries: [horario, ...] }
 * agrupando por docente+día igual que el cálculo local original.
 */
function adaptarFilasRpc(rows) {
  const issues = [];
  (rows || []).forEach((row) => {
    const a = row.horario_a;
    const b = row.horario_b;
    // M-6: priorizar docente_nombre que ya viene resuelto desde la RPC;
    // parseClase solo como último recurso para registros sin docente_id.
    const rawDocente = row.docente_nombre
      || parseClase(a?.clase || a?.clase_raw).docente
      || parseClase(b?.clase || b?.clase_raw).docente;

    let grupo = issues.find(
      (c) => c.docente === rawDocente && c.dia === row.dia
        && (c.entries.some(e => e.id === a.id) || c.entries.some(e => e.id === b.id))
    );
    if (!grupo) {
      grupo = { docente: rawDocente, docenteId: row.docente_id, dia: row.dia, hora: row.hora, entries: [] };
      issues.push(grupo);
    }
    if (!grupo.entries.some(e => e.id === a.id)) grupo.entries.push(a);
    if (!grupo.entries.some(e => e.id === b.id)) grupo.entries.push(b);
  });
  return issues;
}

/**
 * @param {Object} params
 * @param {string|null} params.lapso
 * @param {string} params.selectedPrograma - "todos" o nombre de programa
 * @param {Array} params.data - dataset ya cargado (usado solo como fallback)
 * @param {number} params.refreshKey - cambiar este valor fuerza un refetch
 */
export default function useConflictos({ lapso, selectedPrograma, data, refreshKey = 0 }) {
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  const fetchConflictos = useCallback(async () => {
    setLoading(true);
    try {
      const programaParam = selectedPrograma === "todos" ? null : selectedPrograma;
      const { data: rows, error } = await supabase.rpc("conflictos_horario_detalle", {
        p_lapso: lapso || null,
        p_programa: programaParam,
      });

      if (error) throw error;

      setConflicts(adaptarFilasRpc(rows));
      setUsingFallback(false);
    } catch (err) {
      console.warn("conflictos_horario_detalle no disponible, usando cálculo local:", err.message);
      setConflicts(calcularConflictosLocal(data));
      setUsingFallback(true);
    } finally {
      setLoading(false);
    }
  }, [lapso, selectedPrograma, data]);

  useEffect(() => {
    fetchConflictos();
  }, [fetchConflictos, refreshKey]);

  return { conflicts, loading, usingFallback, refetchConflictos: fetchConflictos };
}
