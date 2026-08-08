-- ============================================================================
-- Migración: 0073_sec33_cerrar_grants_publicos_rpcs_admin.sql
-- Fecha: 7 de agosto de 2026
--
-- NOTA DE NUMERACIÓN: esta migración se escribió originalmente como
-- "0072", pero en paralelo se aplicó y commiteó "0072_ux33_docentes_
-- esperados_hoy.sql" (UX-33, sin relación con esta) antes de que esta
-- llegara al repo. Se renombra a 0073 para no colisionar -- sin cambios
-- de contenido; UX-33 no toca ninguna de las funciones de la lista de
-- abajo ni las políticas de 0071, así que no hay conflicto real, solo
-- de número de archivo.
--
-- CONTEXTO
-- --------
-- Fix SEC-33. Auditoría completa de `EXECUTE` en TODAS las funciones
-- `SECURITY DEFINER` (pedida por LS tras `SEC-30`/`31`/`32`, mismo día),
-- disparada por la sospecha de que si `0062` nunca se corrió y `sl_insert`
-- (session_logs) nunca se borró, podía haber más cosas sueltas del mismo
-- estilo. Se confirmó: ~24 funciones administrativas -- capaces de crear/
-- borrar cuentas, resetear contraseñas, borrar reportes, restaurar
-- backups -- aparecen ejecutables por `anon` y/o `PUBLIC` sin que ninguna
-- migración se lo haya otorgado. Mismo patrón exacto que `SEC-8` (`0049`)
-- y `SEC-9` (`0052`): funciones creadas/tocadas directo en el SQL Editor
-- de Supabase en algún momento, cuyo endurecimiento de grants nunca se
-- aplicó o se perdió.
--
-- RIESGO REAL: no confirmado como explotado, probablemente BAJO en la
-- práctica -- se revisó `admin_delete_user` como muestra representativa
-- y lo primero que hace es `IF NOT admin_caller_puede_gestionar_usuarios
-- (auth.uid()) THEN RAISE EXCEPTION`; para un caller anónimo `auth.uid()`
-- es NULL, así que debería fallar de inmediato. El patrón se repite en
-- el resto de las `admin_*`. Se cierra de todos modos por el mismo
-- principio ya establecido en `0052`: no depender de que `anon` "no
-- tenga motivo" para llamarlas.
--
-- QUÉ SE EXCLUYE A PROPÓSITO (siguen siendo anon/PUBLIC):
--   - buscar_docente_scan, registrar_asistencia -- flujo real de
--     auto-escaneo QR sin sesión (DocenteScan/index.jsx los llama
--     directo, confirmado contra el código real).
--   - verificar_bloqueo_login, log_login_fallido -- se llaman ANTES de
--     que exista sesión, durante el intento de login
--     (LoginScreen.jsx/useAuth.js).
--   - tiene_permiso, usuario_puede_ver_sede -- funciones auxiliares que
--     usan las políticas RLS de casi todas las tablas; necesitan ser
--     ampliamente invocables porque Postgres evalúa las políticas con
--     los privilegios del rol que hace la consulta (authenticated O
--     anon, según la tabla).
--   - _autocompletar_sede_id, proteger_columnas_sensibles_user_profiles,
--     proteger_roles_sistema -- funciones de trigger (retornan `trigger`,
--     tipo pseudo-especial): Postgres las rechaza si se intentan llamar
--     fuera de un trigger sin importar el grant, así que no son
--     explotables por RPC directo aunque aparezcan como PUBLIC. Se dejan
--     como están para no tocar más superficie de la necesaria.
--   - horario_docente_hoy -- SÍ se tightenea acá (no está en la lista de
--     exclusión): no la llama ningún componente sin sesión (se invoca
--     internamente desde `buscar_docente_scan`, que al ser `SECURITY
--     DEFINER` corre como su dueño, no como `anon` -- no necesita el
--     grant directo).
-- ============================================================================

DO $$
DECLARE
  v_fn REGPROCEDURE;
  v_nombres TEXT[] := ARRAY[
    -- Gestión de usuarios y roles (las más sensibles de la lista)
    'admin_create_auth_user', 'admin_delete_user', 'admin_delete_orphan_auth_user',
    'admin_get_orphan_auth_users', 'admin_reset_user_password', 'admin_toggle_user_activo',
    'admin_upsert_user_profile', 'admin_get_users', 'admin_upsert_role', 'admin_delete_role',
    'admin_get_roles', 'admin_caller_es_admin', 'admin_caller_puede_gestionar_usuarios',
    'admin_quedaria_sin_gestion',
    -- Borrado/restauración de datos
    'admin_borrar_asistencias_rango', 'admin_borrar_qr_sesiones', 'admin_borrar_session_logs',
    'borrar_horarios', 'restaurar_backup', 'replace_nombre_en_clases',
    -- Auditoría y logs (lectura administrativa)
    'get_audit_logs', 'get_session_logs', 'log_audit_event', 'log_session_event',
    -- Reportes y catálogos con sede
    'conflictos_horario', 'conflictos_horario_detalle', 'docentes_con_cedula',
    -- QR (creación de sesión -- la hace el staff logueado, no el docente anónimo)
    'crear_qr_session', 'renovar_qr_token',
    -- Mantenimiento / rate limiting internos
    'limpiar_sesiones_expiradas', 'registrar_admin_action_rate_limit',
    'registrar_csp_report_rate_limit',
    -- No llamada sin sesión por ningún componente real (ver nota arriba)
    'horario_docente_hoy'
  ];
  v_nombre TEXT;
BEGIN
  FOREACH v_nombre IN ARRAY v_nombres LOOP
    FOR v_fn IN
      SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_nombre
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
      RAISE NOTICE 'SEC-33: revocado PUBLIC/anon, confirmado authenticated en %', v_fn;
    END LOOP;
  END LOOP;
END $$;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Re-correr la consulta completa de grants y confirmar que NINGUNA de
--    las 32 funciones de la lista de arriba muestra "anon" ni "PUBLIC"
--    en ejecutable_por -- solo "authenticated","postgres","service_role":
--    SELECT p.proname, p.oid::regprocedure AS firma_real,
--           (SELECT array_agg(DISTINCT grantee::text)
--              FROM information_schema.routine_privileges
--             WHERE routine_name = p.proname AND privilege_type = 'EXECUTE') AS ejecutable_por
--    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[
--      'admin_create_auth_user','admin_delete_user','admin_delete_orphan_auth_user',
--      'admin_get_orphan_auth_users','admin_reset_user_password','admin_toggle_user_activo',
--      'admin_upsert_user_profile','admin_get_users','admin_upsert_role','admin_delete_role',
--      'admin_get_roles','admin_caller_es_admin','admin_caller_puede_gestionar_usuarios',
--      'admin_quedaria_sin_gestion','admin_borrar_asistencias_rango','admin_borrar_qr_sesiones',
--      'admin_borrar_session_logs','borrar_horarios','restaurar_backup','replace_nombre_en_clases',
--      'get_audit_logs','get_session_logs','log_audit_event','log_session_event',
--      'conflictos_horario','conflictos_horario_detalle','docentes_con_cedula',
--      'crear_qr_session','renovar_qr_token','limpiar_sesiones_expiradas',
--      'registrar_admin_action_rate_limit','registrar_csp_report_rate_limit','horario_docente_hoy'
--    ])
--    ORDER BY p.proname;
-- 2. Confirmar que el flujo de auto-escaneo QR (DocenteScan, sin sesión)
--    sigue funcionando: buscar_docente_scan y registrar_asistencia deben
--    seguir mostrando "anon" -- esta migración NO los toca.
-- 3. Confirmar que el login (con bloqueo por intentos fallidos) sigue
--    funcionando: verificar_bloqueo_login y log_login_fallido deben
--    seguir mostrando "anon" -- tampoco se tocan.
-- 4. Probar en la app, ya autenticado como admin: crear/editar/borrar un
--    usuario, generar/renovar un QR, ver auditoría -- todo debe seguir
--    funcionando igual (el GRANT a authenticated se mantiene intacto).
-- ============================================================================
