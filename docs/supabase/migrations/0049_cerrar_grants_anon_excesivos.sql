-- ============================================================
-- Migración: 0049_cerrar_grants_anon_excesivos.sql
--
-- CONTEXTO
-- --------
-- Encontrado documentando el esquema completo contra la BD real (no
-- contra las migraciones) — Fix SEC-8, el hallazgo más serio de esa
-- sesión. Cuatro funciones que SÍ tenían `REVOKE ALL ... FROM PUBLIC`
-- explícito en su migración original aparecen ejecutables por `anon` en
-- la base de datos real:
--
--   · asegurar_particion_lapso      (0032: debía ser solo `authenticated`)
--   · docentes_con_cedula           (0023/0026: debía ser solo `authenticated`)
--   · limpiar_audit_logs_antiguos   (0024: debía ser SOLO `service_role`)
--   · limpiar_scan_rate_limit       (0040: debía ser SOLO `service_role`)
--
-- Las migraciones nunca otorgaron esto a `anon` — no hay ningún
-- `GRANT EXECUTE ... TO anon` para estas 4 funciones en todo el
-- historial. La explicación más probable: en algún momento se ejecutó
-- directo en el SQL Editor de Supabase algo como
-- `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon` (típico
-- intento rápido de resolver un error de "permission denied for
-- function"), que revirtió silenciosamente el endurecimiento de varias
-- funciones a la vez sin que quedara registrado en ninguna migración.
--
-- Impacto real, sin este fix:
--   · limpiar_audit_logs_antiguos(0) — CUALQUIERA, sin cuenta, podía
--     borrar el log de auditoría completo al instante. Anti-forense
--     directo: cualquier acción indebida podía borrarse a sí misma del
--     rastro de auditoría.
--   · limpiar_scan_rate_limit() — cualquiera podía resetear el rate
--     limiting de /scan a voluntad, anulando D-3 (0039/0040) por completo.
--   · asegurar_particion_lapso / docentes_con_cedula — impacto menor
--     (creación de particiones vacías arbitrarias; lectura de un listado
--     ya público de todos modos vía la tabla docentes), pero sin motivo
--     para dejarlas abiertas a anon.
--
-- Además: renovar_qr_token (0006) nunca tuvo NINGÚN chequeo de permiso
-- interno, a diferencia de crear_qr_session (0035). Mitigado en la
-- práctica porque el qr_session_id nunca se expone al docente anónimo
-- (verificado: la respuesta de registrar_asistencia no lo incluye), pero
-- se cierra aquí por el mismo principio de no depender de un solo nivel
-- de defensa.
-- ============================================================


-- 1. Revertir el acceso de anon a las 4 funciones — ninguna lo necesitó
--    nunca según su migración original.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.asegurar_particion_lapso(TEXT)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.docentes_con_cedula()               FROM anon;

-- Estas dos NUNCA debieron ser accesibles ni siquiera por authenticated
-- (diseñadas para pg_cron / service_role únicamente) — revocar de ambos.
REVOKE EXECUTE ON FUNCTION public.limpiar_audit_logs_antiguos(INTEGER) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.limpiar_scan_rate_limit()            FROM anon, authenticated;

-- Reafirmar explícitamente el estado correcto (defensa en profundidad:
-- no asumir que el estado previo a esta migración era el correcto).
GRANT EXECUTE ON FUNCTION public.asegurar_particion_lapso(TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.docentes_con_cedula()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.limpiar_audit_logs_antiguos(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.limpiar_scan_rate_limit()            TO service_role;


-- 2. Agregar el chequeo de permiso que renovar_qr_token nunca tuvo, y
--    aprovechar para fijar search_path (no lo tenía desde 0006 — mismo
--    tipo de endurecimiento que ya llevan las funciones más recientes).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.renovar_qr_token(
  p_session_id UUID,
  p_ttl_min    INTEGER DEFAULT 5
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuevo_token UUID := gen_random_uuid();
  v_expires_at  TIMESTAMPTZ := now() + (p_ttl_min || ' minutes')::INTERVAL;
  v_rows        INTEGER;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarQR') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar sesiones QR.';
  END IF;

  UPDATE qr_sessions
  SET    token      = v_nuevo_token,
         expires_at = v_expires_at
  WHERE  id     = p_session_id
    AND  activa = true;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SESION_NO_ENCONTRADA',
      'mensaje', 'La sesión no existe o ya fue cerrada.'
    );
  END IF;

  RETURN json_build_object(
    'ok',         true,
    'token',      v_nuevo_token,
    'expires_at', v_expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.renovar_qr_token IS
  'Rota el token de una sesión QR activa. Fix SEC-8 (auditoría julio '
  '2026): agrega el chequeo de puedeGestionarQR que nunca tuvo — antes '
  'bastaba conocer el UUID de la sesión, sin ninguna verificación de '
  'permiso. Mitigado en la práctica porque el UUID nunca se expone al '
  'docente anónimo, pero no debe depender solo de eso.';

-- Mismo GRANT que ya tenía — solo authenticated (nunca anon; el auto-
-- refresh lo dispara useQRSession.js siempre con sesión de admin activa).
REVOKE ALL    ON FUNCTION public.renovar_qr_token(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovar_qr_token(UUID, INTEGER) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- Pendiente para una próxima sesión (no se toca aquí, por alcance):
--   · get_auth_role, get_my_role, get_auth_programa, get_my_programa
--     también aparecen ejecutables por anon y nunca tuvieron REVOKE en
--     ninguna migración (creadas directo en el dashboard, igual que el
--     patrón de 0021/0031/0032/0044). Son de solo lectura y devuelven
--     null/vacío para un caller anónimo — impacto bajo, pero deberían
--     auditarse y documentarse igual que se hizo aquí.
--   · Revisar sistemáticamente qué otras funciones sin SET search_path
--     deberían tenerlo (renovar_qr_token era la más sensible; no es la
--     única función de 0006 sin este pin).
-- ────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────
-- SELECT p.proname,
--        (SELECT array_agg(DISTINCT grantee::text)
--           FROM information_schema.routine_privileges
--          WHERE routine_name = p.proname AND privilege_type = 'EXECUTE') AS ejecutable_por
-- FROM pg_proc p
-- WHERE p.pronamespace = 'public'::regnamespace
--   AND p.proname IN ('asegurar_particion_lapso','docentes_con_cedula',
--                      'limpiar_audit_logs_antiguos','limpiar_scan_rate_limit',
--                      'renovar_qr_token')
-- ORDER BY p.proname;
-- -- anon NO debe aparecer en ninguna de las 5 filas.
