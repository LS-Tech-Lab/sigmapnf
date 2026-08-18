/**
 * usePlantillasImpresion.js — Fase 1 del editor de plantillas de
 * planillas/reportes imprimibles (migración 0090).
 *
 * Dos consumidores distintos, mismo hook:
 *   1. PlanillaImprimibleBase.jsx (y futuros documentos imprimibles):
 *      solo necesita `plantillaActiva` — la plantilla que le corresponde
 *      a `sedeId` para `tipoReporte`, resuelta con fallback a la default
 *      del tipo si esa sede no tiene una asignación propia en
 *      `sede_plantillas`. Modelo "global configurable por sede" (decisión
 *      de LS, 12 ago): no hay una tabla de plantillas por sede, hay una
 *      sola tabla y una tabla puente de asignación.
 *   2. PestanaPlantillas.jsx (panel admin): además necesita `plantillas`
 *      (todas las del tipo_reporte elegido) y `asignaciones` (qué sede
 *      usa cuál), más las mutaciones (crear/actualizar plantilla, asignar
 *      a una sede, marcar default).
 *
 * `sedeId` es opcional — si no se pasa (o es null), `plantillaActiva`
 * resuelve directo a la default del tipo, sin consultar sede_plantillas.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";
// Fix UX-59 (auditoría 16 ago, cierre del alcance dejado pendiente por
// UX-55): catch de abajo relanza el error original de sus 2 selects
// (`throw plantillasRes.error`/`throw asignacionesRes.error`, conservan
// `.code`) sin traducir.
import { mensajeAmigable } from "../utils/errorMessages";

export default function usePlantillasImpresion(tipoReporte, sedeId = null) {
  const [plantillas, setPlantillas]   = useState([]);
  const [asignaciones, setAsignaciones] = useState([]); // filas de sede_plantillas para este tipo
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  const cargar = useCallback(async () => {
    if (!tipoReporte) {
      setPlantillas([]);
      setAsignaciones([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [plantillasRes, asignacionesRes] = await Promise.all([
        supabase
          .from("plantillas_impresion")
          .select("id, tipo_reporte, nombre, agrupacion, orientacion, tamano_pagina, columnas, es_default, updated_at")
          .eq("tipo_reporte", tipoReporte)
          .order("es_default", { ascending: false })
          .order("nombre", { ascending: true }),
        supabase
          .from("sede_plantillas")
          .select("sede_id, tipo_reporte, plantilla_id")
          .eq("tipo_reporte", tipoReporte),
      ]);

      if (plantillasRes.error) throw plantillasRes.error;
      if (asignacionesRes.error) throw asignacionesRes.error;

      setPlantillas(plantillasRes.data || []);
      setAsignaciones(asignacionesRes.data || []);
    } catch (e) {
      setError(mensajeAmigable(e) || "No se pudieron cargar las plantillas de impresión.");
    }
    setLoading(false);
  }, [tipoReporte]);

  useEffect(() => { cargar(); }, [cargar]);

  // Plantilla que le corresponde a sedeId: su asignación propia si existe,
  // si no la es_default del tipo. Si tampoco hay default (no debería
  // pasar — la migración 0090 siembra una — pero por si se borra a mano),
  // null: el caller decide su propio fallback duro (columnas fijas).
  const plantillaActiva = useMemo(() => {
    if (sedeId) {
      const asignada = asignaciones.find(a => a.sede_id === sedeId);
      if (asignada) {
        const p = plantillas.find(p => p.id === asignada.plantilla_id);
        if (p) return p;
      }
    }
    return plantillas.find(p => p.es_default) || null;
  }, [plantillas, asignaciones, sedeId]);

  /** Crea una plantilla nueva (no default por defecto). */
  const crearPlantilla = useCallback(async ({ nombre, agrupacion, columnas, orientacion, tamanoPagina }) => {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("plantillas_impresion")
      .insert({
        tipo_reporte: tipoReporte,
        nombre,
        agrupacion: agrupacion || "bloque",
        columnas,
        orientacion: orientacion || "horizontal",
        tamano_pagina: tamanoPagina || "carta",
        created_by: userData?.user?.id || null,
        updated_by: userData?.user?.id || null,
      })
      .select()
      .single();
    if (err) throw err;
    await cargar();
    return data;
  }, [tipoReporte, cargar]);

  /** Actualiza nombre/columnas/orientación/tamaño de una plantilla existente. */
  const actualizarPlantilla = useCallback(async (plantillaId, cambios) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await supabase
      .from("plantillas_impresion")
      .update({ ...cambios, updated_at: new Date().toISOString(), updated_by: userData?.user?.id || null })
      .eq("id", plantillaId);
    if (err) throw err;
    await cargar();
  }, [cargar]);

  /** Marca una plantilla como default de su tipo_reporte (RPC atómico, migración 0090). */
  const marcarDefault = useCallback(async (plantillaId) => {
    const { error: err } = await supabase.rpc("marcar_plantilla_default", { p_plantilla_id: plantillaId });
    if (err) throw err;
    await cargar();
  }, [cargar]);

  /** Asigna (o reasigna) qué plantilla usa una sede para este tipo_reporte. */
  const asignarASede = useCallback(async (sedeIdDestino, plantillaId) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await supabase
      .from("sede_plantillas")
      .upsert({
        sede_id: sedeIdDestino,
        tipo_reporte: tipoReporte,
        plantilla_id: plantillaId,
        updated_at: new Date().toISOString(),
        updated_by: userData?.user?.id || null,
      }, { onConflict: "sede_id,tipo_reporte" });
    if (err) throw err;
    await cargar();
  }, [tipoReporte, cargar]);

  /** Quita la asignación propia de una sede -- vuelve a usar la default del tipo. */
  const quitarAsignacion = useCallback(async (sedeIdDestino) => {
    const { error: err } = await supabase
      .from("sede_plantillas")
      .delete()
      .eq("sede_id", sedeIdDestino)
      .eq("tipo_reporte", tipoReporte);
    if (err) throw err;
    await cargar();
  }, [tipoReporte, cargar]);

  return {
    plantillas,
    asignaciones,
    plantillaActiva,
    loading,
    error,
    refetch: cargar,
    crearPlantilla,
    actualizarPlantilla,
    marcarDefault,
    asignarASede,
    quitarAsignacion,
  };
}
