-- =====================================================================
-- Migración 0014: RPC admin_reset_user_password
--
-- Permite cambiar la contraseña de un usuario desde el panel de
-- Gestión de Usuarios sin necesidad de la Edge Function admin-users.
-- Solo puede ejecutarla un usuario activo con puedeGestionarUsuarios.
-- =====================================================================

CREATE OR REPLACE FUNCTION admin_reset_user_password(
  p_user_id  UUID,
  p_password TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 8 caracteres.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuario no encontrado.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at         = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_user_password(UUID, TEXT) TO authenticated;
