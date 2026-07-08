-- ============================================================
-- Migración: 0051_sec11_rate_limit_admin_users.sql
-- Fix SEC-11 (Auditoría QA 5/jul/2026) — api/admin-users.js no
--            tenía ningún límite de frecuencia propio: dependía
--            solo de que el token del caller fuera válido y
--            tuviera permiso. Si esa cuenta se compromete, nada
--            frena una ráfaga de creación de usuarios o reseteos
--            de contraseña.
--
-- Mismo patrón ya usado en scan_rate_limit (D-3, migración 0039):
-- tabla con contador + ventana deslizante, limpieza inline de
-- ventanas vencidas en cada llamada, sin infraestructura nueva
-- (no requiere pg_cron: a diferencia de scan_rate_limit, esta
-- tabla está acotada al número de cuentas con permiso de gestión
-- de usuarios, no a device_fingerprints de un solo uso, así que
-- no acumula filas sin límite).
--
-- Clave del límite: por USUARIO que llama (auth.uid()), no por IP
-- — Vercel no expone una IP de cliente confiable sin configuración
-- adicional, y varias cuentas detrás de la misma IP (NAT/oficina)
-- se bloquearían entre sí de usar IP. El caller ya está autenticado
-- en este punto del endpoint, así que su propio id es la clave
-- correcta y no se puede falsificar.
--
-- Límite: 10 acciones por minuto por cuenta que llama a
-- api/admin-users.js (create, reset_password, delete, delete_orphan).
-- ============================================================


-- ── 1. Tabla de rate limiting ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_actions_rate_limit (
  actor_id        UUID        NOT NULL,
  intentos        INTEGER     NOT NULL DEFAULT 1,
  ventana_inicio  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id)
);

COMMENT ON TABLE public.admin_actions_rate_limit IS
  'Rate limiting para las acciones de api/admin-users.js (SEC-11). '
  'Un registro por actor_id (auth.uid() del caller) con contador de '
  'intentos en la ventana activa. Análogo a scan_rate_limit (D-3, 0039) '
  'pero por cuenta autenticada en vez de device_fingerprint.';

ALTER TABLE public.admin_actions_rate_limit ENABLE ROW LEVEL SECURITY;
-- Sin políticas = todo denegado por RLS; el acceso es exclusivamente
-- a través de la RPC SECURITY DEFINER de abajo, igual que scan_rate_limit.


-- ── 2. RPC de verificación + conteo ──────────────────────────
-- Incrementa el contador del actor y devuelve si la acción debe
-- permitirse. Se llama UNA vez por request en api/admin-users.js,
-- antes de ejecutar cualquier acción (create/reset_password/
-- delete/delete_orphan) — el límite es por endpoint, no por acción.
CREATE OR REPLACE FUNCTION public.registrar_admin_action_rate_limit(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  MAX_INTENTOS     CONSTANT INTEGER := 10;
  VENTANA_SEG      CONSTANT INTEGER := 60; -- 1 minuto
  v_intentos_act   INTEGER;
  v_ventana_inicio TIMESTAMPTZ;
BEGIN
  -- Limpieza oportunista de ventanas vencidas (tabla pequeña y
  -- acotada al número de cuentas con permiso de gestión de
  -- usuarios: no requiere pg_cron, a diferencia de scan_rate_limit).
  DELETE FROM public.admin_actions_rate_limit
  WHERE ventana_inicio < now() - (VENTANA_SEG || ' seconds')::INTERVAL;

  INSERT INTO public.admin_actions_rate_limit (actor_id, intentos, ventana_inicio)
  VALUES (p_actor_id, 1, now())
  ON CONFLICT (actor_id) DO UPDATE
    SET intentos = CASE
          WHEN admin_actions_rate_limit.ventana_inicio < now() - (VENTANA_SEG || ' seconds')::INTERVAL
          THEN 1
          ELSE admin_actions_rate_limit.intentos + 1
        END,
        ventana_inicio = CASE
          WHEN admin_actions_rate_limit.ventana_inicio < now() - (VENTANA_SEG || ' seconds')::INTERVAL
          THEN now()
          ELSE admin_actions_rate_limit.ventana_inicio
        END
  RETURNING intentos, ventana_inicio INTO v_intentos_act, v_ventana_inicio;

  IF v_intentos_act > MAX_INTENTOS THEN
    RETURN jsonb_build_object(
      'permitido',        false,
      'intentos',         v_intentos_act,
      'reintentar_en_seg', GREATEST(0, VENTANA_SEG - EXTRACT(EPOCH FROM (now() - v_ventana_inicio))::INTEGER)
    );
  END IF;

  RETURN jsonb_build_object('permitido', true, 'intentos', v_intentos_act, 'reintentar_en_seg', 0);
END;
$$;

COMMENT ON FUNCTION public.registrar_admin_action_rate_limit IS
  'Rate limiting de api/admin-users.js (SEC-11): máx. 10 acciones por '
  'minuto por actor_id (auth.uid() del caller). Análogo a '
  'registrar_asistencia()/scan_rate_limit (D-3) pero por cuenta '
  'autenticada. Incrementa el contador en cada llamada — se invoca una '
  'sola vez por request, antes de ejecutar la acción solicitada.';

-- Solo el propio endpoint (con la Service Role Key) debe poder
-- incrementar este contador; nunca el cliente ni anon.
REVOKE ALL    ON FUNCTION public.registrar_admin_action_rate_limit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_admin_action_rate_limit(uuid) TO service_role;

-- ── Verificación post-migración ──────────────────────────────
-- 1. Smoke test — primeras 10 llamadas seguidas deben devolver
--    permitido:true, la 11ª dentro del mismo minuto debe devolver
--    permitido:false con reintentar_en_seg > 0:
--
--    SELECT registrar_admin_action_rate_limit('00000000-0000-0000-0000-000000000001');
--    -- repetir 11 veces con el mismo UUID
--
-- 2. Confirmar que actores distintos no se bloquean entre sí
--    (cada uno tiene su propia fila por actor_id).
--
-- 3. Limpiar datos de prueba:
--    DELETE FROM admin_actions_rate_limit
--    WHERE actor_id = '00000000-0000-0000-0000-000000000001';
