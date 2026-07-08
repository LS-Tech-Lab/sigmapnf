-- ============================================================
-- Migración: 0031_session_logs_y_login_attempts.sql
--
-- Documenta la estructura de session_logs, login_attempts,
-- log_session_event y log_login_fallido — tablas y funciones
-- que existían en Supabase pero no en ningún archivo de
-- migración del repositorio.
--
-- Fix C — Auditoría Técnica de Sesiones (Junio 2026)
-- Riesgo original: un reset de BD o despliegue en entorno nuevo
-- dejaba useAuth.js fallando silenciosamente (try/catch absorbe
-- los errores) y LogsView vacío sin indicar el motivo real.
--
-- Esta migración es IDEMPOTENTE: usa CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION y DROP POLICY IF EXISTS + CREATE POLICY.
-- Segura de re-ejecutar.
-- ============================================================

SET search_path TO public;


-- ════════════════════════════════════════════════════════════
-- TABLA: session_logs
-- Registra eventos de sesión: login, logout, token_renovado,
-- user_actualizado, etc.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.session_logs (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  evento     TEXT         NOT NULL,                   -- 'login' | 'logout' | 'token_renovado' | ...
  user_agent TEXT,
  detalles   JSONB        DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Índice principal (el duplicado idx_session_logs_user fue eliminado en 0025)
CREATE INDEX IF NOT EXISTS idx_session_logs_user_id
  ON public.session_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_session_logs_created_at
  ON public.session_logs (created_at DESC);

-- RLS
ALTER TABLE public.session_logs ENABLE ROW LEVEL SECURITY;

-- Lectura: requiere permiso puedeVerLogs (reemplaza sl_select eliminada en 0025)
DROP POLICY IF EXISTS "ver_logs_sesion" ON public.session_logs;
CREATE POLICY "ver_logs_sesion" ON public.session_logs
  FOR SELECT TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeVerLogs'));

-- Sin INSERT directo: solo vía log_session_event (SECURITY DEFINER)
DROP POLICY IF EXISTS "sl_no_insert_directo" ON public.session_logs;
CREATE POLICY "sl_no_insert_directo" ON public.session_logs
  FOR INSERT TO authenticated
  WITH CHECK (false);


-- ════════════════════════════════════════════════════════════
-- TABLA: login_attempts
-- Fuente única de verdad para intentos de login fallidos.
-- Fix B: log_session_event ya NO registra login_fallido —
-- solo LoginScreen.jsx → log_login_fallido → esta tabla.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id         BIGSERIAL    PRIMARY KEY,
  email      TEXT         NOT NULL,
  user_agent TEXT,
  motivo     TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- No se guarda user_id porque el login falló (el usuario puede no existir).
CREATE INDEX IF NOT EXISTS idx_login_attempts_email
  ON public.login_attempts (email);

CREATE INDEX IF NOT EXISTS idx_login_attempts_created_at
  ON public.login_attempts (created_at DESC);

-- RLS
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Lectura: requiere permiso puedeVerLogs (la_select_nuevo de 0025 se preserva)
DROP POLICY IF EXISTS "la_select_nuevo" ON public.login_attempts;
CREATE POLICY "la_select_nuevo" ON public.login_attempts
  FOR SELECT TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeVerLogs'));

-- Sin INSERT directo: solo vía log_login_fallido (SECURITY DEFINER)
DROP POLICY IF EXISTS "la_no_insert_directo" ON public.login_attempts;
CREATE POLICY "la_no_insert_directo" ON public.login_attempts
  FOR INSERT TO authenticated
  WITH CHECK (false);


-- ════════════════════════════════════════════════════════════
-- FUNCIÓN: log_session_event
-- Llamada desde useAuth.js (autenticado) para registrar
-- eventos de sesión en session_logs.
-- SECURITY DEFINER para poder insertar sin política de INSERT.
-- ════════════════════════════════════════════════════════════

-- Eliminar firma obsoleta de 4 parámetros (incluía p_ip).
-- Sin este DROP, CREATE OR REPLACE falla con "function name is not unique".
DROP FUNCTION IF EXISTS public.log_session_event(text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.log_session_event(
  p_evento     TEXT,
  p_user_agent TEXT    DEFAULT NULL,
  p_detalles   JSONB   DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.session_logs (user_id, evento, user_agent, detalles)
  VALUES (auth.uid(), p_evento, p_user_agent, COALESCE(p_detalles, '{}'::jsonb));
END;
$$;

REVOKE ALL    ON FUNCTION public.log_session_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_session_event TO authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCIÓN: log_login_fallido
-- Llamada desde LoginScreen.jsx (anon, antes de autenticar)
-- para registrar intentos fallidos en login_attempts.
-- SECURITY DEFINER + accesible por anon para funcionar sin sesión.
-- ════════════════════════════════════════════════════════════

-- Eliminar firma obsoleta de 4 parámetros (incluía p_ip).
DROP FUNCTION IF EXISTS public.log_login_fallido(text, text, text, text);

CREATE OR REPLACE FUNCTION public.log_login_fallido(
  p_email      TEXT,
  p_user_agent TEXT    DEFAULT NULL,
  p_motivo     TEXT    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.login_attempts (email, user_agent, motivo)
  VALUES (p_email, p_user_agent, p_motivo);
END;
$$;

-- anon necesita EXECUTE porque el login aún no autenticó al usuario
REVOKE ALL    ON FUNCTION public.log_login_fallido FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_login_fallido TO anon;
GRANT EXECUTE ON FUNCTION public.log_login_fallido TO authenticated;


-- ════════════════════════════════════════════════════════════
-- Verificación post-migración (ejecutar por separado)
-- ════════════════════════════════════════════════════════════
--
-- 1. Confirmar tablas y columnas:
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('session_logs', 'login_attempts')
-- ORDER BY table_name, ordinal_position;
--
-- 2. Confirmar funciones:
-- SELECT routine_name, security_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('log_session_event', 'log_login_fallido');
-- → security_type debe ser 'DEFINER' en ambas.
--
-- 3. Confirmar políticas activas:
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('session_logs', 'login_attempts');
--
-- 4. Smoke test desde la app:
--    a) Login exitoso → session_logs debe tener fila evento='login'
--    b) Logout → session_logs debe tener UNA sola fila evento='logout'
--       (Fix A: antes generaba dos)
--    c) Login fallido → login_attempts debe tener fila,
--       session_logs NO debe tener fila (Fix B: fuente única)
