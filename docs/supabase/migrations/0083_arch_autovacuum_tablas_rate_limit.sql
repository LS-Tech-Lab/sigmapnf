-- ============================================================================
-- Migración: 0083_arch_autovacuum_tablas_rate_limit.sql
-- Fecha: 9 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Encontrado en la auditoría completa de BD (Sección 6, bloat/autovacuum):
-- scan_rate_limit, admin_actions_rate_limit y csp_report_rate_limit son
-- tablas de upsert por clave (device_fingerprint/actor_id/ip) -- la misma
-- fila se actualiza una y otra vez en vez de insertarse una fila nueva por
-- evento. autovacuum dispara con umbral + 20% x filas_vivas; con pocas
-- filas vivas (1-2 en producción hoy) ese 20% casi nunca se alcanza sin
-- importar cuántos UPDATE se acumulen -- confirmado con
-- pg_stat_user_tables: autovacuum_count=0, autoanalyze_count=0 en las 3,
-- pese a filas muertas de hasta 92% (scan_rate_limit: 1 viva / 11 muertas).
-- No es un problema hoy por el volumen bajo actual, pero es el patrón
-- clásico de bloat invisible en tablas de rate-limiting que degrada sin que
-- el conteo de filas lo delate. Se corrige bajando el scale_factor para
-- estas 3 tablas específicamente (no es un cambio global de postgresql.conf).
-- ============================================================================

ALTER TABLE public.scan_rate_limit
  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 25);

ALTER TABLE public.admin_actions_rate_limit
  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 25);

ALTER TABLE public.csp_report_rate_limit
  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 25);


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Confirmar los parámetros aplicados:
--    SELECT relname, reloptions FROM pg_class
--    WHERE relname IN ('scan_rate_limit', 'admin_actions_rate_limit', 'csp_report_rate_limit');
-- 2. No hay forma de "forzar" un autovacuum inmediato solo cambiando el
--    parámetro -- si se quiere limpiar el bloat acumulado ya existente de
--    una vez, correr manualmente:
--    VACUUM (ANALYZE) public.scan_rate_limit;
--    VACUUM (ANALYZE) public.admin_actions_rate_limit;
--    VACUUM (ANALYZE) public.csp_report_rate_limit;
-- ============================================================================
