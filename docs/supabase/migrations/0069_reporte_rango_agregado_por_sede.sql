-- ============================================================================
-- Migración: 0069_reporte_rango_agregado_por_sede.sql
-- Fecha: 6 de agosto de 2026
--
-- CONTEXTO
-- --------
-- SEDE-16. `reporte_asistencias_rango_agregado()` (0055, ARCH-27) es
-- SECURITY INVOKER: corre con los privilegios de quien la llama, así que
-- las políticas RLS de `asistencias_diarias` (0064) ya se aplican -- para
-- un rol con sede fija, el resultado queda naturalmente acotado a su
-- sede. El problema es el mismo patrón que el resto de `SEDE-16`: para un
-- rol con `puedeVerTodasLasSedes`, RLS deja pasar TODAS las sedes, y esta
-- función nunca tuvo forma de acotar el resultado a la sede activa
-- elegida en el selector -- el "Reporte por Rango" (vista semanal/rango
-- de Asistencias QR) mezclaba días/horas asistidas de todas las sedes en
-- un solo total por cédula.
--
-- FIX
-- ---
-- Se agrega `p_sede_id` (opcional, default NULL = sin filtro adicional,
-- mismo criterio que `admin_borrar_asistencias_rango`/0068): cuando el
-- cliente lo manda, se suma como condición AND sobre `a.sede_id` además
-- del filtro que ya aplica RLS. No reemplaza a RLS -- es un acotamiento
-- extra para cuando RLS por sí sola no basta (rol que ve todas las
-- sedes). El frontend (`ReporteRango.jsx`) ya manda `sedeActiva` como
-- `p_sede_id` desde SEDE-16.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reporte_asistencias_rango_agregado(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT,
  p_programa    TEXT DEFAULT NULL,
  p_sede_id     TEXT DEFAULT NULL
)
RETURNS TABLE (
  cedula_docente TEXT,
  nombre_docente TEXT,
  dias_asistidos BIGINT,
  programas      TEXT[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    a.cedula_docente,
    (array_agg(a.nombre_docente ORDER BY a.hora_registro DESC))[1] AS nombre_docente,
    count(DISTINCT a.fecha)                                        AS dias_asistidos,
    array_agg(DISTINCT a.programa) FILTER (WHERE a.programa IS NOT NULL) AS programas
  FROM public.asistencias_diarias a
  WHERE a.fecha BETWEEN p_fecha_desde AND p_fecha_hasta
    AND a.turno = p_turno
    AND (p_programa IS NULL OR a.programa = p_programa)
    AND (p_sede_id  IS NULL OR a.sede_id  = p_sede_id)
  GROUP BY a.cedula_docente
  ORDER BY dias_asistidos DESC;
$$;

COMMENT ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT, TEXT) IS
  'ARCH-27/SEDE-16: agregación server-side para el Reporte por Rango. '
  'SECURITY INVOKER: respeta las mismas políticas RLS que el SELECT directo '
  'que sustituye (SEC-11/SEDE-3). p_sede_id (opcional) acota además el '
  'resultado a una sede concreta -- necesario para roles con '
  'puedeVerTodasLasSedes, a quienes RLS por sí sola no les filtra nada.';

-- Firma vieja (4 argumentos) queda huérfana -- se suelta explícitamente en
-- vez de dejarla como overload muerto (mismo criterio que 0064/0066).
DROP FUNCTION IF EXISTS public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT);

REVOKE ALL ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n
--    ON n.oid = p.pronamespace WHERE n.nspname = 'public'
--    AND p.proname = 'reporte_asistencias_rango_agregado';
--    -- debe listar UNA sola firma, con 5 parámetros (la vieja de 4 ya no
--    -- debe aparecer).
-- 2. Con datos de prueba en dos sedes: llamar sin p_sede_id desde un rol
--    con sede fija -> solo ve su propia sede (RLS). Llamar con
--    puedeVerTodasLasSedes y p_sede_id='cabimas' -> solo Cabimas, aunque
--    existan registros de otra sede en el mismo rango/turno.
-- 3. Confirmar que ReporteRango.jsx (SEDE-16) manda sedeActiva como
--    p_sede_id -- sin eso, esta migración por sí sola no cierra el hallazgo,
--    porque la función seguiría recibiendo NULL desde un cliente viejo.
-- ============================================================================
