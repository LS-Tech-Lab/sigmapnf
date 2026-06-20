-- =====================================================================
-- Migración 0006b: Acceso anónimo a registrar_asistencia
--
-- La RPC registrar_asistencia() usa SECURITY DEFINER, por lo que corre
-- con los privilegios del owner (postgres). Pero Supabase solo ejecuta
-- la función si el rol que llama (anon o authenticated) tiene EXECUTE.
--
-- Los docentes que escanean el QR NO tienen sesión de Supabase Auth:
-- se conectan como rol "anon". Necesitamos concederles EXECUTE sobre
-- registrar_asistencia. Las demás RPCs (crear, renovar, etc.) solo las
-- llaman usuarios autenticados (admin), así que no necesitan GRANT extra.
-- =====================================================================

-- Permitir que clientes anónimos ejecuten la RPC de registro
GRANT EXECUTE ON FUNCTION registrar_asistencia(UUID, TEXT, TEXT, TEXT)
  TO anon;

-- ── Nota sobre Row Level Security ─────────────────────────────────────────
-- Las tablas qr_sessions y asistencias_diarias tienen RLS activado.
-- registrar_asistencia corre como SECURITY DEFINER (owner = postgres),
-- por lo que no está sujeta a las políticas RLS de las tablas —
-- puede leer/insertar libremente. No se necesita política adicional
-- para el rol anon sobre las tablas.
