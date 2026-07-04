-- ============================================================
-- Migración: 0048_cerrar_insert_directo_login_attempts.sql
--
-- CONTEXTO
-- --------
-- Encontrado documentando el esquema completo contra la BD real (no
-- contra las migraciones): login_attempts tenía una política
-- "la_insert_anon" (INSERT, rol public, WITH CHECK (true)) que permite a
-- CUALQUIERA, sin autenticarse, insertar una fila con cualquier email —
-- directo vía la API REST de Supabase con solo la anon key (pública por
-- diseño en el frontend, VITE_SUPABASE_ANON_KEY).
--
-- Fix SEC-7: esto es grave específicamente combinado con SEC-6 (0047):
-- alguien puede insertar 5 filas falsas con el email de un admin real y
-- forzar el bloqueo de esa cuenta por 15 minutos, repetible sin límite —
-- una denegación de servicio dirigida contra una cuenta específica,
-- montada sobre el propio mecanismo que se agregó para dar más seguridad.
--
-- Por qué existía la política: probablemente necesaria antes de que
-- existiera log_login_fallido() (0031) — la app nunca la usa (verificado:
-- no hay ningún `.from("login_attempts")` en src/, todo pasa por la RPC).
-- Al ser SECURITY DEFINER, log_login_fallido() no necesita que quien la
-- llama tenga permisos directos sobre la tabla — corre con los privilegios
-- de su propietario. Por eso se puede revocar todo el acceso directo sin
-- romper nada del flujo real de la app.
-- ============================================================

-- 1. Eliminar la política que permitía INSERT directo sin restricción.
DROP POLICY IF EXISTS la_insert_anon ON public.login_attempts;

-- 2. Revocar los GRANTs de tabla que no tienen ningún uso legítimo — el
--    acceso real ocurre exclusivamente vía RPCs SECURITY DEFINER
--    (log_login_fallido, verificar_bloqueo_login), que no dependen de
--    estos GRANTs para funcionar.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.login_attempts FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.login_attempts FROM authenticated;

-- Se deja SELECT para authenticated (ya protegido por la política
-- la_select_nuevo, que exige puedeVerLogs) por si una futura UI de logs
-- lo necesita — hoy ninguna pantalla lo usa, pero no hay motivo para
-- revocarlo: ya está correctamente gateado por permiso.

COMMENT ON TABLE public.login_attempts IS
  'Registro de intentos de login fallidos. Escritura EXCLUSIVA vía '
  'log_login_fallido() y verificar_bloqueo_login() (SECURITY DEFINER) — '
  'no hay INSERT directo permitido para ningún rol desde 0048 (SEC-7). '
  'Ver docs/AUDITORIA_INDICE.md.';

-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────
-- 1. Confirmar que ya no hay política de INSERT abierta:
--
--    SELECT policyname, cmd, roles, with_check FROM pg_policies
--    WHERE tablename = 'login_attempts';
--    -- no debe aparecer ninguna fila con roles={public} y with_check=true
--
-- 2. Confirmar que anon ya no tiene GRANTs de escritura:
--
--    SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'login_attempts' AND grantee = 'anon';
--    -- no debe quedar INSERT/UPDATE/DELETE/TRUNCATE, solo lo que Postgres
--    -- no permite revocar de forma granular si aplica
--
-- 3. Confirmar que el login normal sigue funcionando igual (probar un
--    login fallido real y ver que aparece en login_attempts, y que tras
--    5 intentos el siguiente login se bloquea vía verificar_bloqueo_login).
