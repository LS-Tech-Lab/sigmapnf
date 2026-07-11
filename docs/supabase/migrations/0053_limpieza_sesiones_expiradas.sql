-- ============================================================
-- Migración: 0053_limpieza_sesiones_expiradas.sql
--
-- CONTEXTO
-- --------
-- Detectado (10-jul-2026): una sesión iniciada en SIGMA nunca se
-- cerraba sola aunque pasaran días. Causa: el cliente Supabase usa
-- persistSession + autoRefreshToken por defecto (localStorage), sin
-- ningún límite de sesión configurado. El timeout de inactividad de
-- useAuth.js (30/60 min, "Mejora 1 — auditoría Junio 2026") solo
-- corre mientras la pestaña sigue montada: cerrar el navegador y
-- reabrirlo días después reinicia ese temporizador en el cliente sin
-- ningún control real del tiempo transcurrido.
--
-- El límite de sesión configurable ("Time-boxed sessions" /
-- "Inactivity timeout") es una feature de Supabase Pro y superiores
-- — no disponible en el plan free de este proyecto. Esta migración
-- replica ambos controles directamente sobre `auth.sessions` (tabla
-- propia del proyecto, sin RLS para el rol postgres) vía pg_cron,
-- que sí viene habilitado en el plan free.
--
-- Dos capas:
--   1) Time-box absoluto: cierra cualquier sesión con más de
--      TIME_BOX_HORAS desde el login, sin importar actividad.
--   2) Inactividad (capa de respaldo del lado servidor): cierra
--      sesiones sin renovación de token en los últimos
--      INACTIVIDAD_HORAS. El control principal de inactividad sigue
--      siendo el client-side (useAuth.js, más ajustado: 30/60 min);
--      esta capa cubre el caso de un cliente comprometido o con JS
--      deshabilitado que ignore ese temporizador.
--
-- Al borrar la fila de auth.sessions, el próximo refresh de ese
-- token falla y el cliente recibe SIGNED_OUT. Importante: el access
-- token (JWT) ya emitido sigue siendo válido hasta su propio
-- vencimiento (JWT expiry limit, Auth → Settings, por defecto 1h)
-- porque su validación es stateless. La ventana real de exposición
-- tras cruzar el umbral es, en el peor caso, ~intervalo del cron +
-- tiempo restante del access token. Bajar el "JWT expiry limit" en
-- el dashboard (ej. a 15-20 min) reduce esa ventana; no se puede
-- hacer desde una migración SQL.
--
-- Umbrales (decisión LS, 10-jul-2026): jornada laboral completa de
-- SIGMA es de 10 horas → time-box = 10h. Inactividad server-side
-- fijada más holgada que el client-side para no pisarle el paso en
-- uso normal, pero igual de conservadora en seguridad → 2h.
--
-- Auditoría: cada cierre forzado queda registrado en session_logs
-- como evento 'logout_forzado_servidor' con el motivo, para que sea
-- visible en LogsView igual que cualquier otro evento de sesión.
--
-- Idempotente: CREATE OR REPLACE FUNCTION + unschedule/schedule.
-- ============================================================

CREATE OR REPLACE FUNCTION public.limpiar_sesiones_expiradas()
RETURNS TABLE(cerradas_timebox INT, cerradas_inactividad INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_col_actividad TEXT;
  v_time_box      INTERVAL := interval '10 hours';
  v_inactividad   INTERVAL := interval '2 hours';
  v_n_timebox     INT;
  v_n_inactiv     INT;
BEGIN
  -- 'refreshed_at' (renovación real de token) es más precisa que
  -- 'updated_at' como "última actividad", pero no existe en todas
  -- las versiones del esquema de gotrue. Resolver contra el esquema
  -- real en vez de asumir (mismo criterio que 0052).
  SELECT column_name INTO v_col_actividad
  FROM information_schema.columns
  WHERE table_schema = 'auth' AND table_name = 'sessions'
    AND column_name = 'refreshed_at';

  IF v_col_actividad IS NULL THEN
    v_col_actividad := 'updated_at';
  END IF;

  -- 1) Time-box absoluto ---------------------------------------------
  INSERT INTO public.session_logs (user_id, evento, detalles)
  SELECT user_id, 'logout_forzado_servidor',
         jsonb_build_object(
           'motivo', 'timeout_absoluto',
           'limite_horas', extract(epoch FROM v_time_box) / 3600
         )
  FROM auth.sessions
  WHERE created_at < now() - v_time_box;

  DELETE FROM auth.sessions WHERE created_at < now() - v_time_box;
  GET DIAGNOSTICS v_n_timebox = ROW_COUNT;

  -- 2) Inactividad (respaldo server-side) ------------------------------
  -- Nota: las sesiones que ya cumplían el time-box fueron borradas
  -- arriba, así que no hay doble conteo/doble log posible aquí.
  EXECUTE format($f$
    INSERT INTO public.session_logs (user_id, evento, detalles)
    SELECT user_id, 'logout_forzado_servidor',
           jsonb_build_object(
             'motivo', 'timeout_inactividad',
             'limite_horas', extract(epoch FROM $1) / 3600
           )
    FROM auth.sessions
    WHERE %I < now() - $1
  $f$, v_col_actividad) USING v_inactividad;

  EXECUTE format(
    'DELETE FROM auth.sessions WHERE %I < now() - $1',
    v_col_actividad
  ) USING v_inactividad;
  GET DIAGNOSTICS v_n_inactiv = ROW_COUNT;

  RETURN QUERY SELECT v_n_timebox, v_n_inactiv;
END;
$$;

-- Sin GRANT a authenticated/anon: de uso exclusivo del cron
-- (ejecutado internamente por el rol que corre el job, típicamente
-- postgres). No expuesta como RPC de la aplicación.
REVOKE ALL ON FUNCTION public.limpiar_sesiones_expiradas() FROM PUBLIC;


-- ────────────────────────────────────────────────────────────────────────
-- Programación vía pg_cron (cada 15 min)
-- ────────────────────────────────────────────────────────────────────────
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpiar-sesiones-expiradas') THEN
      PERFORM cron.unschedule('limpiar-sesiones-expiradas');
    END IF;

    PERFORM cron.schedule(
      'limpiar-sesiones-expiradas',
      '*/15 * * * *',
      'SELECT public.limpiar_sesiones_expiradas();'
    );

    RAISE NOTICE 'pg_cron: job "limpiar-sesiones-expiradas" programado (cada 15 min). Time-box 10h, inactividad 2h.';
  ELSE
    RAISE NOTICE
      'pg_cron no está habilitado. Habilitar desde Supabase Dashboard → '
      'Database → Extensions y volver a ejecutar esta migración. O llamar '
      'manualmente: SELECT public.limpiar_sesiones_expiradas();';
  END IF;
END;
$outer$;


-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────
-- SELECT * FROM cron.job WHERE jobname = 'limpiar-sesiones-expiradas';
--
-- -- Prueba manual (no espera al cron):
-- SELECT public.limpiar_sesiones_expiradas();
--
-- -- Ver cierres forzados registrados:
-- SELECT * FROM public.session_logs
--  WHERE evento = 'logout_forzado_servidor'
--  ORDER BY created_at DESC LIMIT 20;
