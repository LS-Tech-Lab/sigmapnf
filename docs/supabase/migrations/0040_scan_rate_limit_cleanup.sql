-- =============================================================================
-- Migración 0040 — M-3: Limpieza automática de scan_rate_limit
--
-- La tabla scan_rate_limit (creada en 0039) acumula registros de
-- device_fingerprints de un solo uso que nunca se limpian con la
-- limpieza inline de registrar_asistencia(), ya que ésta solo borra
-- fingerprints que vuelven a intentar dentro de una ventana vencida.
--
-- Fix 1: función limpiar_scan_rate_limit() que borra entradas con
--        ventana_inicio > 1 hora (la ventana de rate limiting).
--
-- Fix 2: si pg_cron está disponible, programa la limpieza cada hora.
--        Si no, deja un NOTICE con instrucciones, sin fallar.
-- =============================================================================


-- ── 1. Función de limpieza ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.limpiar_scan_rate_limit()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_eliminadas INTEGER;
BEGIN
  DELETE FROM public.scan_rate_limit
  WHERE ventana_inicio < now() - INTERVAL '1 hour';

  GET DIAGNOSTICS v_eliminadas = ROW_COUNT;
  RETURN v_eliminadas;
END;
$$;

COMMENT ON FUNCTION public.limpiar_scan_rate_limit IS
  'Elimina entradas de scan_rate_limit con ventana_inicio mayor a 1 hora. '
  'Diseñada para ejecución periódica via pg_cron. '
  'Devuelve el número de filas eliminadas.';

REVOKE ALL    ON FUNCTION public.limpiar_scan_rate_limit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.limpiar_scan_rate_limit TO service_role;


-- ── 2. Programar con pg_cron si está disponible ───────────────────────────────

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpiar-scan-rate-limit') THEN
      PERFORM cron.unschedule('limpiar-scan-rate-limit');
    END IF;

    PERFORM cron.schedule(
      'limpiar-scan-rate-limit',
      '0 * * * *',   -- cada hora en punto
      'SELECT public.limpiar_scan_rate_limit();'
    );

    RAISE NOTICE 'pg_cron: job "limpiar-scan-rate-limit" programado (cada hora).';
  ELSE
    RAISE NOTICE
      'pg_cron no está habilitado. La tabla scan_rate_limit se limpia de forma '
      'inline en registrar_asistencia() para fingerprints recurrentes, pero los '
      'de un solo uso se acumularán. Para limpieza automática, habilitar pg_cron '
      'desde Supabase Dashboard → Database → Extensions y volver a ejecutar esta '
      'migración. O llamar manualmente: SELECT public.limpiar_scan_rate_limit();';
  END IF;
END;
$outer$;
