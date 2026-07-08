-- ============================================================
-- Migración: 0021_rpcs_gestion_usuarios.sql
-- Fix #17 — Documentar en migraciones las RPCs de gestión de
--            usuarios que fueron creadas directamente en Supabase
--            y no existían en ningún archivo de migración.
--            Sin este archivo, un reset de BD o migración a otro
--            proyecto las perdería silenciosamente.
--
-- RPCs incluidas:
--   · admin_caller_puede_gestionar_usuarios
--   · admin_create_auth_user
--   · admin_delete_orphan_auth_user
--   · admin_delete_role
--   · admin_delete_user
--   · admin_get_orphan_auth_users
--   · admin_get_roles
--   · admin_get_users
--   · admin_quedaria_sin_gestion
--   · admin_reset_user_password
--   · admin_toggle_user_activo
--   · admin_upsert_role
--   · admin_upsert_user_profile
-- ============================================================


-- ── admin_caller_puede_gestionar_usuarios ───────────────────
CREATE OR REPLACE FUNCTION public.admin_caller_puede_gestionar_usuarios(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.nombre = up.rol
    WHERE up.id = p_user_id
      AND up.activo = true
      AND (r.permisos ->> 'puedeGestionarUsuarios') = 'true'
  );
$$;


-- ── admin_create_auth_user ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_auth_user(
  p_email    text,
  p_password text,
  p_nombre   text,
  p_rol      text,
  p_programa text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  v_user_id UUID;
  v_restringe BOOLEAN;
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  SELECT restringe_programa INTO v_restringe FROM roles WHERE nombre = p_rol;
  IF v_restringe IS NULL THEN
    RAISE EXCEPTION 'El rol "%" no existe.', p_rol;
  END IF;
  IF v_restringe AND (p_programa IS NULL OR btrim(p_programa) = '') THEN
    RAISE EXCEPTION 'Este rol requiere un programa asignado.';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
  IF v_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese email.';
  END IF;

  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    role, aud
  ) VALUES (
    gen_random_uuid(),
    p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('nombre', p_nombre),
    now(), now(),
    'authenticated', 'authenticated'
  ) RETURNING id INTO v_user_id;

  INSERT INTO user_profiles (id, email, nombre, rol, programa, activo, creado_por)
  VALUES (
    v_user_id, p_email, p_nombre, p_rol,
    NULLIF(btrim(COALESCE(p_programa, '')), ''),
    true,
    (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

  RETURN v_user_id;
END;
$$;


-- ── admin_delete_orphan_auth_user ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_orphan_auth_user(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para esta operación.';
  END IF;

  IF auth.uid() = p_target_user_id THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Este usuario tiene perfil activo. Usa admin_delete_user en su lugar.';
  END IF;

  DELETE FROM auth.users WHERE id = p_target_user_id;
END;
$$;


-- ── admin_delete_role ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_role(p_nombre text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_es_sistema BOOLEAN;
  v_en_uso INTEGER;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarRoles') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar roles.';
  END IF;

  SELECT es_sistema INTO v_es_sistema FROM roles WHERE nombre = p_nombre;
  IF v_es_sistema IS NULL THEN
    RAISE EXCEPTION 'El rol "%" no existe.', p_nombre;
  END IF;
  IF v_es_sistema THEN
    RAISE EXCEPTION 'No se pueden eliminar los roles predefinidos del sistema (solo editar sus permisos).';
  END IF;

  SELECT count(*) INTO v_en_uso FROM user_profiles WHERE rol = p_nombre;
  IF v_en_uso > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: % usuario(s) tienen este rol asignado.', v_en_uso;
  END IF;

  DELETE FROM roles WHERE nombre = p_nombre;
END;
$$;


-- ── admin_delete_user ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_target_email TEXT;
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(v_caller_id) THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar usuarios.';
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta.';
  END IF;

  SELECT email INTO v_target_email
  FROM user_profiles
  WHERE id = p_target_user_id;

  DELETE FROM user_profiles WHERE id = p_target_user_id;
  DELETE FROM auth.users WHERE id = p_target_user_id;

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


-- ── admin_get_orphan_auth_users ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_orphan_auth_users()
RETURNS TABLE(id uuid, email text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
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


-- ── admin_get_roles ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_roles()
RETURNS TABLE(
  nombre text, label text, emoji text, color text,
  restringe_programa boolean, permisos jsonb, es_sistema boolean,
  usuarios_count bigint, creado_en timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') OR tiene_permiso(auth.uid(), 'puedeGestionarRoles')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los roles.';
  END IF;

  RETURN QUERY
  SELECT r.nombre, r.label, r.emoji, r.color, r.restringe_programa, r.permisos, r.es_sistema,
         COALESCE(u.cnt, 0), r.creado_en
  FROM roles r
  LEFT JOIN (SELECT up.rol, count(*) AS cnt FROM user_profiles up GROUP BY up.rol) u ON u.rol = r.nombre
  ORDER BY r.es_sistema DESC, r.creado_en ASC;
END;
$$;


-- ── admin_get_users ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_users()
RETURNS SETOF user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    RAISE EXCEPTION 'No tienes permiso para ver usuarios.';
  END IF;
  RETURN QUERY SELECT * FROM user_profiles ORDER BY creado_en DESC;
END;
$$;


-- ── admin_quedaria_sin_gestion ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_quedaria_sin_gestion(
  p_user_id    uuid,
  p_nuevo_rol  text,
  p_nuevo_activo boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_permisos_nuevo_rol JSONB;
  v_alguien_queda BOOLEAN;
BEGIN
  SELECT permisos INTO v_permisos_nuevo_rol FROM roles WHERE nombre = p_nuevo_rol;

  SELECT EXISTS (
    SELECT 1 WHERE p_nuevo_activo
      AND (v_permisos_nuevo_rol ->> 'puedeGestionarUsuarios') = 'true'
      AND (v_permisos_nuevo_rol ->> 'puedeGestionarRoles') = 'true'
    UNION ALL
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.nombre = up.rol
    WHERE up.id <> p_user_id
      AND up.activo = true
      AND (r.permisos ->> 'puedeGestionarUsuarios') = 'true'
      AND (r.permisos ->> 'puedeGestionarRoles') = 'true'
  ) INTO v_alguien_queda;

  RETURN NOT v_alguien_queda;
END;
$$;


-- ── admin_reset_user_password ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  p_user_id  uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
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
  SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = now()
  WHERE id = p_user_id;
END;
$$;


-- ── admin_toggle_user_activo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_toggle_user_activo(
  p_user_id uuid,
  p_activo  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  SELECT rol INTO v_rol FROM user_profiles WHERE id = p_user_id;
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado.';
  END IF;

  IF NOT p_activo AND admin_quedaria_sin_gestion(p_user_id, v_rol, false) THEN
    RAISE EXCEPTION 'No puedes desactivar al último usuario con permiso para gestionar usuarios y roles.';
  END IF;

  UPDATE user_profiles SET activo = p_activo, actualizado_en = now() WHERE id = p_user_id;
END;
$$;


-- ── admin_upsert_role ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_upsert_role(
  p_nombre             text,
  p_label              text,
  p_emoji              text,
  p_color              text,
  p_restringe_programa boolean,
  p_permisos           jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_es_sistema BOOLEAN;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarRoles') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar roles.';
  END IF;

  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El rol necesita un identificador.';
  END IF;
  IF p_nombre !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'El identificador del rol solo puede tener minúsculas, números y guion bajo.';
  END IF;

  SELECT es_sistema INTO v_es_sistema FROM roles WHERE nombre = p_nombre;

  IF NOT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.nombre = up.rol
    WHERE up.activo = true
      AND (CASE WHEN up.rol = p_nombre THEN p_permisos ELSE r.permisos END ->> 'puedeGestionarUsuarios') = 'true'
      AND (CASE WHEN up.rol = p_nombre THEN p_permisos ELSE r.permisos END ->> 'puedeGestionarRoles') = 'true'
  ) THEN
    RAISE EXCEPTION 'Este cambio dejaría el sistema sin ningún usuario activo con permiso para gestionar usuarios y roles.';
  END IF;

  INSERT INTO roles (nombre, label, emoji, color, restringe_programa, permisos, es_sistema)
  VALUES (p_nombre, p_label, COALESCE(p_emoji, '👤'), COALESCE(p_color, '#374151'),
          COALESCE(p_restringe_programa, false), COALESCE(p_permisos, '{}'::jsonb), false)
  ON CONFLICT (nombre) DO UPDATE
    SET label              = EXCLUDED.label,
        emoji              = EXCLUDED.emoji,
        color              = EXCLUDED.color,
        restringe_programa = EXCLUDED.restringe_programa,
        permisos           = EXCLUDED.permisos,
        actualizado_en     = now();
END;
$$;


-- ── admin_upsert_user_profile ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_upsert_user_profile(
  p_user_id  uuid,
  p_email    text,
  p_nombre   text,
  p_rol      text,
  p_programa text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_restringe BOOLEAN;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  SELECT restringe_programa INTO v_restringe FROM roles WHERE nombre = p_rol;
  IF v_restringe IS NULL THEN
    RAISE EXCEPTION 'El rol "%" no existe.', p_rol;
  END IF;
  IF v_restringe AND (p_programa IS NULL OR btrim(p_programa) = '') THEN
    RAISE EXCEPTION 'Este rol requiere un programa asignado.';
  END IF;

  IF admin_quedaria_sin_gestion(p_user_id, p_rol, true) THEN
    RAISE EXCEPTION 'Este cambio dejaría el sistema sin ningún usuario activo con permiso para gestionar usuarios y roles.';
  END IF;

  INSERT INTO user_profiles (id, email, nombre, rol, programa, creado_por)
  VALUES (
    p_user_id, p_email, p_nombre, p_rol, NULLIF(btrim(COALESCE(p_programa, '')), ''),
    (SELECT nombre FROM user_profiles WHERE id = auth.uid())
  )
  ON CONFLICT (id) DO UPDATE
    SET email          = EXCLUDED.email,
        nombre         = EXCLUDED.nombre,
        rol            = EXCLUDED.rol,
        programa       = EXCLUDED.programa,
        actualizado_en = now();
END;
$$;
