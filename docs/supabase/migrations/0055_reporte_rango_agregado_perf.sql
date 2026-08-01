-- =============================================================================
-- Migración 0055 — ARCH-27: agregación server-side para "Reporte por Rango"
--
-- NOTA IMPORTANTE ANTES DE APLICAR: el índice de auditoría (SEC-21) referencia
-- una migración "0055" (limpieza de sesiones vía pg_cron) que no existe como
-- archivo en este repo — parece haberse aplicado directo desde el dashboard
-- de Supabase sin commit (mismo patrón ya documentado para otras funciones en
-- SEC-9/SEC-17). Verificar contra la BD real (pg_cron.job) si el número 0055
-- ya fue usado en producción antes de aplicar esta migración; si es así,
-- renumerar este archivo a 0056 antes de correrlo.
--
-- CONTEXTO
-- --------
-- ReporteRango.jsx paginaba en bloques de 1000 filas CRUDAS de
-- asistencias_diarias (hasta 20.000, con aviso de truncado) y hacía todo el
-- agrupamiento por docente (días asistidos, programas) en el cliente. Para
-- rangos largos esto significa varias idas y vueltas a Supabase transfiriendo
-- miles de filas individuales solo para terminar en un puñado de totales por
-- docente — y, como efecto secundario, el usuario no tenía ningún feedback
-- de progreso mientras se paginaba.
--
-- FIX: función SQL que agrupa por cedula_docente directamente en Postgres y
-- devuelve solo los agregados (una fila por docente, no por evento de
-- asistencia). Elimina la paginación completa del lado cliente y el límite
-- de 20.000 filas (la agregación ya no transfiere filas individuales).
--
-- SECURITY INVOKER (no DEFINER): la función corre con los privilegios de
-- quien la llama, así que las políticas RLS ya existentes sobre
-- asistencias_diarias (SEC-11, migración 0036 — requiere
-- puedeGestionarQR o puedeVerReporteAsistencias) se siguen aplicando
-- exactamente igual que en el SELECT directo que reemplaza. Ningún cambio
-- de superficie de seguridad.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reporte_asistencias_rango_agregado(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT,
  p_programa    TEXT DEFAULT NULL
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
  -- nombre_docente: se toma el de la fila con hora_registro más reciente,
  -- mismo criterio que usaba el forEach original en el cliente (que
  -- sobrescribía d.nombre en cada fila, procesadas en orden ascendente por
  -- hora_registro — el resultado final era el nombre de la fila más nueva).
  SELECT
    a.cedula_docente,
    (array_agg(a.nombre_docente ORDER BY a.hora_registro DESC))[1] AS nombre_docente,
    count(DISTINCT a.fecha)                                        AS dias_asistidos,
    array_agg(DISTINCT a.programa) FILTER (WHERE a.programa IS NOT NULL) AS programas
  FROM public.asistencias_diarias a
  WHERE a.fecha BETWEEN p_fecha_desde AND p_fecha_hasta
    AND a.turno = p_turno
    AND (p_programa IS NULL OR a.programa = p_programa)
  GROUP BY a.cedula_docente
  ORDER BY dias_asistidos DESC;
$$;

COMMENT ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT) IS
  'ARCH-27: agregación server-side para el Reporte por Rango — reemplaza la '
  'paginación de filas crudas + agrupamiento en cliente. SECURITY INVOKER: '
  'respeta las mismas políticas RLS que el SELECT directo que sustituye '
  '(SEC-11).';

-- Mismo criterio que SEC-9/SEC-17: no depender de la ausencia de motivo para
-- que anon la ejecute — cerrar explícitamente y confirmar authenticated.
REVOKE ALL ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────
-- 1. Confirmar que la firma y los grants quedaron correctos:
--
-- SELECT p.oid::regprocedure AS firma_real,
--        (SELECT array_agg(DISTINCT grantee::text)
--           FROM information_schema.routine_privileges
--          WHERE routine_name = 'reporte_asistencias_rango_agregado'
--            AND privilege_type = 'EXECUTE') AS ejecutable_por
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'reporte_asistencias_rango_agregado';
-- -- Esperado: solo 'authenticated' en ejecutable_por, anon NO debe aparecer.
--
-- 2. Comparar contra el cálculo anterior (agrupamiento en cliente) con un
--    rango/turno real conocido, confirmando que días asistidos y programas
--    coinciden fila por fila antes de dar esto por cerrado en producción.
