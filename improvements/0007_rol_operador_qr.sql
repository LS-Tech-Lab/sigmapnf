-- =====================================================================
-- Migración 0007: Rol operador_qr
--
-- Agrega el rol "operador_qr" al sistema. Un usuario con este rol:
--   • Solo puede iniciar sesión y acceder al módulo de asistencias QR
--   • No tiene acceso al módulo de horarios ni a ninguna vista de gestión
--   • Puede crear/renovar/cerrar sesiones QR (RPCs crear_qr_session,
--     renovar_qr_token) y leer asistencias del día (para el reporte)
--   • NO puede ver logs, usuarios, ni datos de otros módulos
--
-- Pasos:
--   1. Ampliar el CHECK constraint del campo rol en user_profiles
--      (si existe — Supabase por defecto no lo tiene en el schema público,
--       pero lo agregamos de forma segura con DROP/ADD)
--   2. Actualizar las políticas RLS de qr_sessions y asistencias_diarias
--      para incluir operador_qr
--   3. GRANT EXECUTE de las RPCs de sesión al rol authenticated
--      (ya lo tiene por defecto en Supabase, pero lo dejamos explícito)
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Ampliar CHECK constraint en user_profiles.rol (si existe)
-- ─────────────────────────────────────────────────────────────────────

-- Eliminar constraint anterior si existe (nombre estándar que usa Supabase
-- cuando se crea via tabla o migración anterior)
DO $$
BEGIN
  -- Intenta eliminar el constraint si existe con cualquiera de estos nombres comunes
  BEGIN
    ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_rol_check;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS check_rol;
  EXCEPTION WHEN others THEN NULL;
  END;
END
$$;

-- Agregar constraint actualizado incluyendo operador_qr
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_rol_check
  CHECK (rol IN ('admin', 'coordinador', 'secretario', 'administrativo', 'operador_qr'));


-- ─────────────────────────────────────────────────────────────────────
-- 2. Actualizar políticas RLS para incluir operador_qr
-- ─────────────────────────────────────────────────────────────────────

-- qr_sessions: admin Y operador_qr pueden leer
DROP POLICY IF EXISTS "admin_lee_qr_sessions" ON qr_sessions;
CREATE POLICY "admin_operador_lee_qr_sessions"
  ON qr_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE  up.id     = auth.uid()
        AND  up.rol    IN ('admin', 'operador_qr')
        AND  up.activo = true
    )
  );

-- asistencias_diarias: admin Y operador_qr pueden leer el reporte
DROP POLICY IF EXISTS "admin_lee_asistencias" ON asistencias_diarias;
CREATE POLICY "admin_operador_lee_asistencias"
  ON asistencias_diarias FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE  up.id     = auth.uid()
        AND  up.rol    IN ('admin', 'operador_qr')
        AND  up.activo = true
    )
  );


-- ─────────────────────────────────────────────────────────────────────
-- 3. Actualizar políticas RLS de crear_qr_session para operador_qr
--    (la función usa SECURITY DEFINER, por lo que el GRANT EXECUTE al
--     rol authenticated ya cubre a operador_qr al ser usuario autenticado)
-- ─────────────────────────────────────────────────────────────────────

-- Las RPCs crear_qr_session y renovar_qr_token son SECURITY DEFINER
-- y están disponibles para cualquier usuario autenticado (rol authenticated).
-- Supabase ya concede EXECUTE a authenticated por defecto en funciones públicas.
-- Lo dejamos explícito para claridad:

GRANT EXECUTE ON FUNCTION crear_qr_session(TEXT, TEXT, DATE, INTEGER)
  TO authenticated;

GRANT EXECUTE ON FUNCTION renovar_qr_token(UUID, INTEGER)
  TO authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 4. Comentario de uso
-- ─────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN user_profiles.rol IS
  'Roles disponibles:
   - admin:          Acceso total a horarios y asistencias
   - coordinador:    Gestión de horarios del programa
   - secretario:     Carga y consulta de horarios de su programa
   - administrativo: Solo consulta
   - operador_qr:    Solo módulo de asistencias QR (activar/ver reporte)';
