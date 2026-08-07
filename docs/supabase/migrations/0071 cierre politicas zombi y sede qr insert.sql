-- ============================================================================
-- Migración: 0071_cierre_politicas_zombi_y_sede_qr_insert.sql
-- Fecha: 7 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Auditoría completa de `pg_policies` (SEC-30/31/32) a pedido de LS,
-- disparada por encontrar dos políticas RLS huérfanas en producción que
-- nunca pasaron por una migración versionada. Esta migración cierra las
-- 3 partes:
--
-- SEC-30 (ya aplicado a mano en producción el 7 ago, se versiona acá
-- para que quede en el historial y sea reproducible): `qr_sessions` y
-- `asistencias_diarias` tenían cada una DOS políticas SELECT activas —
-- la correcta de `0064` (`lee_qr_sessions_por_permiso`/
-- `lee_asistencias_por_permiso`, con `usuario_puede_ver_sede()`) y una
-- vieja, creada a mano fuera de cualquier migración
-- (`permiso_lee_qr_sessions`/`permiso_lee_asistencias`, SIN chequeo de
-- sede). Por el OR de políticas permisivas, la vieja anulaba el filtro
-- de sede de la nueva: cualquiera con `puedeGestionarQR`/
-- `puedeVerReporteAsistencias` veía sesiones/asistencias de TODAS las
-- sedes en la base real, aunque el código ya filtrara bien.
--
-- SEC-31 (nuevo, no relacionado con sedes -- data desde antes de `0061`):
-- `session_logs` tiene DOS políticas INSERT activas — `sl_no_insert_directo`
-- (`0031`, WITH CHECK false, diseñada para forzar que todo INSERT pase
-- por el RPC `log_session_event()`) y una zombi `sl_insert`, que usa
-- `get_auth_role()` (el sistema de roles viejo, reemplazado por
-- `tiene_permiso()` desde `0016`/`0025` -- ver comentarios de esa época).
-- `sl_insert` nunca fue borrada por ninguna migración. Por el mismo OR
-- de políticas permisivas, sigue viva y anula la intención de
-- `sl_no_insert_directo`: cualquier usuario autenticado puede insertar
-- directo en `session_logs` una fila arbitraria con su propio user_id
-- (evento/detalles/user_agent sin validar), sin pasar por el RPC.
--
-- SEC-32 (nuevo, dureza adicional -- no explotado por la app real):
-- `solo_hoy_insert_qr_sessions` (INSERT de `qr_sessions`) nunca tuvo
-- `usuario_puede_ver_sede(sede_id)` en su WITH CHECK -- quedó fuera de
-- `0063`/`0064` porque esas migraciones solo tocaron el SELECT. El
-- frontend real SIEMPRE crea sesiones vía el RPC `crear_qr_session`
-- (SECURITY DEFINER, que sí resuelve/valida la sede), nunca con un
-- INSERT directo -- así que esto no es explotable por la UI de la app,
-- pero RLS es la única barrera real contra un INSERT directo por API,
-- y hoy no la tiene. Se cierra por el mismo principio de defensa en
-- profundidad que el resto de SEDE-N.
-- ============================================================================

-- ── SEC-30: formaliza el DROP ya aplicado a mano el 7 de agosto ─────────────
-- Idempotente -- si ya se borraron a mano (como en este caso), no hace nada.
DROP POLICY IF EXISTS "permiso_lee_qr_sessions" ON public.qr_sessions;
DROP POLICY IF EXISTS "permiso_lee_asistencias" ON public.asistencias_diarias;


-- ── SEC-31: cierra la política zombi de session_logs ─────────────────────────
DROP POLICY IF EXISTS "sl_insert" ON public.session_logs;

-- sl_no_insert_directo (0031, WITH CHECK false) queda como ÚNICA política
-- de INSERT -- session_logs solo se escribe vía log_session_event()
-- (SECURITY DEFINER, bypasea RLS, ver 0031).


-- ── SEC-32: agrega sede al INSERT directo de qr_sessions ─────────────────────
DROP POLICY IF EXISTS "solo_hoy_insert_qr_sessions" ON public.qr_sessions;

CREATE POLICY "solo_hoy_insert_qr_sessions" ON public.qr_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    fecha = fecha_hoy_ve()
    AND tiene_permiso(auth.uid(), 'puedeGestionarQR')
    AND usuario_puede_ver_sede(sede_id)
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND activo = true
    )
  );


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Confirmar que session_logs quedó con UNA sola política INSERT:
--    SELECT policyname, qual, with_check FROM pg_policies
--    WHERE tablename = 'session_logs' AND cmd = 'INSERT';
--    -- Esperado: solo sl_no_insert_directo, with_check = false.
-- 2. Confirmar que un INSERT directo a session_logs (sin pasar por
--    log_session_event()) falla para CUALQUIER usuario, incluido admin:
--    INSERT INTO session_logs (user_id, evento) VALUES (auth.uid(), 'login');
--    -- Esperado: denegado por RLS.
-- 3. Confirmar que log_session_event() sigue funcionando igual que
--    siempre (es SECURITY DEFINER, no depende de estas políticas):
--    login/logout normal desde la app debe seguir registrando en
--    session_logs sin cambios.
-- 4. Confirmar el WITH CHECK nuevo de qr_sessions:
--    SELECT with_check FROM pg_policies
--    WHERE tablename = 'qr_sessions' AND policyname = 'solo_hoy_insert_qr_sessions';
--    -- Debe incluir usuario_puede_ver_sede(sede_id).
-- 5. Confirmar que crear_qr_session (SECURITY DEFINER, RPC real que usa
--    la app) sigue funcionando sin cambios -- no depende de esta policy
--    porque bypasea RLS, pero conviene probar el flujo real igual.
-- 6. Re-correr la consulta completa de pg_policies para las 5 tablas de
--    SEC-30/31/32 y confirmar que no aparece ninguna política adicional
--    fuera de lo documentado en migraciones:
--    SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('qr_sessions', 'asistencias_diarias', 'session_logs')
--    ORDER BY tablename, cmd, policyname;
-- ============================================================================
