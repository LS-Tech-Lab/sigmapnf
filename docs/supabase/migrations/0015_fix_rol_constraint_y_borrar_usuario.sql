-- =====================================================================
-- Migración 0015: Corrección constraint rol + RPC eliminar usuario
--
-- Problema 1: user_profiles.rol tiene un CHECK que solo acepta los
--   roles hardcodeados de la migración 0007. Ahora que los roles son
--   dinámicos (tabla `roles`), ese constraint rechaza cualquier rol
--   personalizado creado desde la UI, causando que el INSERT falle
--   silenciosamente y el usuario quede en auth.users sin perfil.
--
-- Solución 1: Eliminar el CHECK estático y reemplazarlo con un
--   constraint de FK hacia la tabla `roles(nombre)`.
--
-- Problema 2: No existe RPC para eliminar un usuario completo
--   (auth.users + user_profiles) desde el panel de admin.
--
-- Solución 2: Crear RPC admin_delete_user que:
--   - Verifica permiso del caller
--   - Borra primero el perfil (user_profiles)
--   - Luego borra el usuario de auth.users via auth.users DELETE
--   - Registra en audit_log si la tabla existe
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Corregir el constraint de rol en user_profiles
-- ─────────────────────────────────────────────────────────────────────

-- Eliminar el CHECK estático de roles hardcodeados
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_rol_check,
  DROP CONSTRAINT IF EXISTS check_rol;

-- Agregar FK hacia la tabla roles (dinámica)
-- ON UPDATE CASCADE: si se renombra un rol, se actualiza en cascada
-- ON DELETE RESTRICT: no se puede borrar un rol mientras tenga usuarios
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_rol_fk
  FOREIGN KEY (rol) REFERENCES roles(nombre)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;


-- ─────────────────────────────────────────────────────────────────────
-- 2. RPC admin_delete_user
--    Solo puede ejecutarla un admin con puedeGestionarUsuarios.
--    Elimina el perfil y luego el usuario de auth.users.
--    Protege contra auto-eliminación.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_delete_user(p_target_user_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_target_email TEXT;
BEGIN
  -- Verificar permiso del caller
  IF NOT admin_caller_puede_gestionar_usuarios(v_caller_id) THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar usuarios.';
  END IF;

  -- Evitar auto-eliminación
  IF v_caller_id = p_target_user_id THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta.';
  END IF;

  -- Obtener email para el log (puede no tener perfil si estaba en estado inconsistente)
  SELECT email INTO v_target_email
  FROM user_profiles
  WHERE id = p_target_user_id;

  -- Borrar perfil (si existe)
  DELETE FROM user_profiles WHERE id = p_target_user_id;

  -- Borrar de auth.users (requiere SECURITY DEFINER con search_path = auth)
  DELETE FROM auth.users WHERE id = p_target_user_id;

  -- Registrar en audit_log si la tabla existe
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    INSERT INTO audit_log (user_id, accion, entidad, entidad_id, resumen)
    VALUES (
      v_caller_id,
      'ELIMINAR_USUARIO',
      'usuarios',
      p_target_user_id,
      format('Usuario eliminado permanentemente: %s', COALESCE(v_target_email, p_target_user_id::text))
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_user(UUID) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 3. RPC auxiliar: admin_get_orphan_auth_users
--    Devuelve usuarios que existen en auth.users pero NO en user_profiles.
--    Útil para diagnosticar y limpiar el estado inconsistente actual.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_get_orphan_auth_users()
RETURNS TABLE (id UUID, email TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para esta operación.';
  END IF;

  RETURN QUERY
  SELECT au.id, au.email, au.created_at
  FROM auth.users au
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_profiles up WHERE up.id = au.id
  )
  ORDER BY au.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_orphan_auth_users() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 4. RPC admin_delete_orphan_auth_user
--    Elimina un usuario que solo existe en auth.users (sin perfil).
--    Permite limpiar el estado inconsistente actual.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_delete_orphan_auth_user(p_target_user_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para esta operación.';
  END IF;

  IF auth.uid() = p_target_user_id THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta.';
  END IF;

  -- Solo borramos si realmente NO tiene perfil (doble verificación)
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Este usuario tiene perfil activo. Usa admin_delete_user en su lugar.';
  END IF;

  DELETE FROM auth.users WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_orphan_auth_user(UUID) TO authenticated;
