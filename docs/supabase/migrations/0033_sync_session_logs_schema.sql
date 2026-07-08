-- ============================================================
-- Migración: 0033_sync_session_logs_schema.sql
--
-- Sincroniza el schema documentado en 0031 con la BD real.
--
-- PROBLEMA detectado en auditoría (Junio 2026):
--   0031 creó session_logs con columnas mínimas (user_id,
--   evento, user_agent, detalles). La BD real tiene además:
--   email, nombre, rol, programa, ip.
--   login_attempts en BD real tiene ip que 0031 no documentó.
--
-- CAMBIOS:
--   1. session_logs  — ADD COLUMN IF NOT EXISTS para las 5
--      columnas faltantes. Los 351 registros históricos con
--      email/nombre poblados se conservan intactos.
--   2. login_attempts — ADD COLUMN IF NOT EXISTS ip.
--   3. get_session_logs — actualizada para usar COALESCE:
--      · COALESCE(sl.email,   au.email)   — cubre histórico y nuevos
--      · COALESCE(sl.nombre,  up.nombre)  — cubre histórico y nuevos
--      · COALESCE(sl.rol,     up.rol)     — cubre histórico y nuevos
--      · COALESCE(sl.programa,up.programa)— cubre histórico y nuevos
--      · ip marcada como deprecada (0 registros poblados en BD)
--
-- NOTA: email, nombre, rol, programa en session_logs son
--   columnas legado — log_session_event NO las puebla en
--   registros nuevos (solo inserta user_id, evento,
--   user_agent, detalles). get_session_logs las resuelve
--   por JOIN en tiempo de consulta para ambos casos.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
--   DROP IF EXISTS. Segura de re-ejecutar.
-- ============================================================

SET search_path TO public;


-- ════════════════════════════════════════════════════════════
-- 1. session_logs — columnas faltantes en 0031
-- ════════════════════════════════════════════════════════════

-- email: presente en registros históricos (351/351 poblados).
-- Legado: log_session_event actual no la inserta.
ALTER TABLE public.session_logs
  ADD COLUMN IF NOT EXISTS email TEXT;

-- nombre: presente en registros históricos (325/351 poblados).
-- Legado: log_session_event actual no la inserta.
ALTER TABLE public.session_logs
  ADD COLUMN IF NOT EXISTS nombre TEXT;

-- rol: legado — log_session_event no la inserta.
ALTER TABLE public.session_logs
  ADD COLUMN IF NOT EXISTS rol TEXT;

-- programa: legado — log_session_event no la inserta.
ALTER TABLE public.session_logs
  ADD COLUMN IF NOT EXISTS programa TEXT;

-- ip: DEPRECADA — existe en BD pero 0/351 registros poblados.
-- No se puebla desde el cliente Supabase (requeriría edge function).
-- Se conserva por compatibilidad con registros históricos.
ALTER TABLE public.session_logs
  ADD COLUMN IF NOT EXISTS ip TEXT;


-- ════════════════════════════════════════════════════════════
-- 2. login_attempts — columna ip faltante en 0031
--    DEPRECADA: log_login_fallido no la inserta (0 registros).
--    Se conserva por compatibilidad.
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.login_attempts
  ADD COLUMN IF NOT EXISTS ip TEXT;


-- ════════════════════════════════════════════════════════════
-- 3. get_session_logs — COALESCE para cubrir histórico y nuevos
--
--    Registros históricos: email/nombre/rol/programa en la fila
--    Registros nuevos:     esos campos son NULL → JOIN resuelve
--
--    DROP necesario: RETURNS TABLE puede diferir por columnas.
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_session_logs(INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.get_session_logs(
  p_limit  INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_email  TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id         BIGINT,
  email      TEXT,
  nombre     TEXT,
  rol        TEXT,
  programa   TEXT,
  evento     TEXT,
  ip         TEXT,       -- deprecada, siempre NULL en registros nuevos
  detalles   JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeVerLogs') THEN
    RAISE EXCEPTION 'PERMISO_DENEGADO';
  END IF;

  RETURN QUERY
    -- Sesiones exitosas, logouts, renovaciones, etc.
    SELECT
      sl.id,
      COALESCE(sl.email,    au.email)       AS email,
      COALESCE(sl.nombre,   up.nombre)      AS nombre,
      COALESCE(sl.rol,      up.rol)         AS rol,
      COALESCE(sl.programa, up.programa)    AS programa,
      sl.evento,
      sl.ip,
      sl.detalles,
      sl.created_at
    FROM   public.session_logs sl
    LEFT JOIN auth.users           au ON au.id = sl.user_id
    LEFT JOIN public.user_profiles up ON up.id = sl.user_id
    WHERE (p_email IS NULL
      OR COALESCE(sl.email, au.email) ILIKE '%' || p_email || '%')

    UNION ALL

    -- Intentos fallidos
    SELECT
      (la.id * -1)::BIGINT,
      la.email,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      'login_fallido'::TEXT,
      la.ip,
      jsonb_build_object('motivo', la.motivo, 'user_agent', la.user_agent),
      la.created_at
    FROM public.login_attempts la
    WHERE (p_email IS NULL OR la.email ILIKE '%' || p_email || '%')

    ORDER BY created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_session_logs IS
  'Lectura paginada de session_logs + login_attempts para LogsView. '
  'Usa COALESCE para resolver email/nombre/rol/programa tanto en '
  'registros históricos (columnas pobladas) como en nuevos (JOIN). '
  'Corregida en 0032: get_auth_role() → tiene_permiso(). '
  'Actualizada en 0033: COALESCE + JOIN para compatibilidad total.';

REVOKE ALL    ON FUNCTION public.get_session_logs FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_logs TO authenticated;


-- ════════════════════════════════════════════════════════════
-- Verificación post-migración
-- ════════════════════════════════════════════════════════════
--
-- 1. Confirmar columnas nuevas en ambas tablas:
--    SELECT column_name, data_type
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name IN ('session_logs', 'login_attempts')
--    ORDER BY table_name, ordinal_position;
--    → session_logs debe tener 11 columnas
--    → login_attempts debe tener 6 columnas
--
-- 2. Confirmar que registros históricos siguen intactos:
--    SELECT COUNT(*), COUNT(email), COUNT(nombre)
--    FROM public.session_logs;
--    → total=351, con_email=351, con_nombre=325
--
-- 3. Smoke test get_session_logs (usuario con puedeVerLogs):
--    SELECT id, email, nombre, rol, evento, created_at
--    FROM get_session_logs(5, 0, NULL);
--    → registros históricos: email/nombre/rol del campo directo
--    → registros nuevos: email/nombre/rol del JOIN
-- ════════════════════════════════════════════════════════════
