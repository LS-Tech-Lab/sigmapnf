-- ============================================================
-- Migración: 0047_bloqueo_login_fuerza_bruta.sql
--
-- CONTEXTO
-- --------
-- El único pendiente que quedaba de la auditoría de sesiones (Junio 2026):
-- protección de fuerza bruta a nivel de servidor. Lo que existe hoy:
--
--   1. SEC-5 (LoginScreen.jsx) — bloqueo del lado del CLIENTE en IndexedDB,
--      5 intentos / 60s por email. Es fricción real, pero se salta
--      borrando el IDB, usando otro navegador/dispositivo, o llamando
--      supabase.auth.signInWithPassword() directo sin pasar por la UI.
--   2. login_attempts (0031) — solo REGISTRA intentos fallidos vía
--      log_login_fallido(). No hay ningún conteo que bloquee nada.
--   3. Rate limiting por IP de Supabase Auth (GoTrue) — existe a nivel de
--      plataforma, pero es por IP (no por cuenta) y no es verificable ni
--      configurable desde este repo.
--
-- Esta migración cierra el hueco entre (1) y (3): un bloqueo POR CUENTA
-- que sobrevive a borrar el IDB o cambiar de navegador, reutilizando los
-- datos que login_attempts ya recolecta — sin tabla nueva.
--
-- Política: 5 intentos fallidos en los últimos 15 minutos → bloqueado
-- hasta 15 minutos después del intento fallido más reciente (ventana
-- deslizante: seguir intentando mientras está bloqueado extiende el
-- bloqueo, igual que el patrón ya establecido en SEC-5 y O-8).
--
-- Importante — esto NO reemplaza a (1) ni a (3):
--   · Sigue siendo necesario que Supabase Auth tenga su propio rate
--     limiting por IP activo (Project Settings > Auth en el dashboard de
--     Supabase) — esta función no puede interceptar la llamada a
--     signInWithPassword() en sí, solo lo que el cliente decida hacer
--     ANTES de llamarla.
--   · Alguien que llame a supabase.auth.signInWithPassword() directo
--     (sin pasar por LoginScreen.jsx) sigue sin pasar por esta función.
--     Es un límite real de usar Supabase Auth hospedado: el enforcement
--     fuerte vive en GoTrue, no en nuestras RPCs. Esta función sube el
--     costo de un ataque que además respeta la UI normal.
-- ============================================================


-- ────────────────────────────────────────────────────────────────────────
-- FUNCIÓN: verificar_bloqueo_login
-- Llamada desde LoginScreen.jsx (anon, ANTES de intentar signInWithPassword)
-- para decidir si debe dejar pasar el intento o mostrar el bloqueo.
-- No inserta nada — solo lee login_attempts. SECURITY DEFINER porque
-- login_attempts exige permiso puedeVerLogs para SELECT normal (0031),
-- y aquí necesitamos contar intentos de un usuario que aún no inició
-- sesión (podría no tener ningún permiso, o no existir la cuenta).
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verificar_bloqueo_login(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intentos       INTEGER;
  v_ultimo_fallido TIMESTAMPTZ;
  v_desbloquea_en  TIMESTAMPTZ;
BEGIN
  SELECT COUNT(*), MAX(created_at)
    INTO v_intentos, v_ultimo_fallido
    FROM public.login_attempts
   WHERE email = lower(trim(p_email))
     AND created_at > now() - INTERVAL '15 minutes';

  IF v_intentos >= 5 THEN
    v_desbloquea_en := v_ultimo_fallido + INTERVAL '15 minutes';

    -- La ventana ya venció mientras evaluábamos (carrera improbable pero
    -- posible): no está bloqueado, solo tiene historial reciente.
    IF v_desbloquea_en <= now() THEN
      RETURN jsonb_build_object('bloqueado', false, 'intentos', v_intentos, 'desbloquea_en', null);
    END IF;

    RETURN jsonb_build_object(
      'bloqueado', true,
      'intentos', v_intentos,
      'desbloquea_en', v_desbloquea_en
    );
  END IF;

  RETURN jsonb_build_object('bloqueado', false, 'intentos', v_intentos, 'desbloquea_en', null);
END;
$$;

COMMENT ON FUNCTION public.verificar_bloqueo_login IS
  'Bloqueo de fuerza bruta por cuenta (servidor): 5 intentos fallidos en '
  '15 min bloquean hasta 15 min después del último intento. Complementa, '
  'no reemplaza, el bloqueo de cliente (SEC-5, IDB) y el rate limiting por '
  'IP de Supabase Auth (plataforma).';

-- anon necesita EXECUTE: se llama ANTES de que exista una sesión.
REVOKE ALL    ON FUNCTION public.verificar_bloqueo_login FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verificar_bloqueo_login TO anon;
GRANT EXECUTE ON FUNCTION public.verificar_bloqueo_login TO authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración (ejecutar por separado)
-- ────────────────────────────────────────────────────────────────────────
-- 1. Smoke test — debe devolver bloqueado:false con una cuenta sin
--    historial reciente:
--
--    SELECT verificar_bloqueo_login('cuenta-sin-intentos@example.com');
--
-- 2. Simular bloqueo (ejecutar 5 veces, luego probar):
--
--    SELECT log_login_fallido('test-bruteforce@example.com', 'test', 'test');
--    -- repetir 5 veces, luego:
--    SELECT verificar_bloqueo_login('test-bruteforce@example.com');
--    -- debe devolver bloqueado:true con desbloquea_en ~15 min en el futuro
--
-- 3. Limpiar los datos de prueba del paso 2:
--
--    DELETE FROM login_attempts WHERE email = 'test-bruteforce@example.com';
