-- =============================================================================
-- Migración 0038 — P3: Activar limpieza automática de audit_logs
--
-- La función limpiar_audit_logs_antiguos() fue definida en 0024 pero quedó
-- sin programar. Esta migración activa el cron via pg_cron (disponible en
-- Supabase Pro y superiores).
--
-- Si pg_cron no está habilitado en el proyecto, el bloque DO captura el error
-- y deja un NOTICE con las instrucciones para activarlo manualmente,
-- sin hacer fallar la migración.
--
-- Retención: 180 días (configurable en la función, parámetro p_dias_retencion).
-- Ejecución: cada domingo a las 03:00 hora Venezuela (UTC-4 = 07:00 UTC).
-- =============================================================================

DO $outer$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Eliminar job previo si existe (idempotente)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpiar-audit-logs') THEN
      PERFORM cron.unschedule('limpiar-audit-logs');
    END IF;

    PERFORM cron.schedule(
      'limpiar-audit-logs',
      '0 7 * * 0',
      'SELECT public.limpiar_audit_logs_antiguos(180);'
    );

    RAISE NOTICE 'pg_cron: job "limpiar-audit-logs" programado (domingos 03:00 VE).';
  ELSE
    RAISE NOTICE
      'pg_cron no está habilitado. Para activar la limpieza automática de audit_logs, '
      'habilitar pg_cron desde Supabase Dashboard → Database → Extensions y '
      'volver a ejecutar esta migración. O llamar manualmente: '
      'SELECT public.limpiar_audit_logs_antiguos(180);';
  END IF;
END;
$outer$;
