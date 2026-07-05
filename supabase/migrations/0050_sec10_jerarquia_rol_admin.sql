-- ============================================================
-- Migración: 0050_sec10_jerarquia_rol_admin.sql
-- Fix SEC-10 (Auditoría QA 5/jul/2026) — Escalada de privilegios
--            en gestión de usuarios.
--
-- Problema: admin_caller_puede_gestionar_usuarios() solo valida
-- el permiso booleano `puedeGestionarUsuarios`. Como los roles
-- son dinámicos (tabla `roles`, ver 0021/MATRIZ_PERMISOS.md),
-- cualquier rol con ese permiso activado podía crear, editar,
-- reactivar/desactivar, resetear la contraseña o eliminar una
-- cuenta con rol `admin`, sin serlo.
--
-- Solución elegida (la alternativa "simple" que propone la
-- propia auditoría, no la de `nivel` numérico en `roles`):
-- una regla fija, sin depender de la tabla dinámica — solo una
-- cuenta con rol = 'admin' puede asignar el rol 'admin' o
-- modificar/eliminar una cuenta que ya lo tiene. `admin` es el
-- rol raíz del sistema (es_sistema = true desde el diseño
-- original, ver docs/SECURITY.md) y no se puede borrar (0019),
-- así que hardcodear su nombre aquí es seguro y no ata la regla
-- a ningún otro rol dinámico que un administrador cree después.
--
-- Alcance: se agrega el guard en las 4 RPCs que de verdad tocan
-- el rol/estado de una cuenta objetivo:
--   · admin_create_auth_user      (asigna un rol al crear)
--   · admin_upsert_user_profile   (puede cambiar el rol; usada
--                                  por ModalUsuario.jsx al editar)
--   · admin_toggle_user_activo    (usada por PestanaUsuarios.jsx)
--   · admin_delete_user
-- `admin_reset_user_password` y `admin_delete_orphan_auth_user`
-- también se corrigen aquí por consistencia (son parte del mismo
-- catálogo de 0021 y son invocables directamente vía RPC aunque
-- el frontend actual pase por api/admin-users.js para el primer
-- caso). `admin_delete_orphan_auth_user` no tiene rol objetivo
-- (opera sobre huérfanos sin fila en user_profiles) — no aplica.
--
-- IMPORTANTE: api/admin-users.js NO llama a admin_create_auth_user
-- ni a admin_reset_user_password ni a admin_delete_user — reimplementa
-- la misma operación directamente contra Auth Admin API + REST con
-- la Service Role Key. El mismo guard se agrega ahí por separado
-- en este mismo commit (ver diff de api/admin-users.js); esta
-- migración sola NO cierra el hallazgo para esa vía.
-- ============================================================


-- ── Helper: ¿el caller tiene rol admin? ─────────────────────
-- Centraliza la regla fija en un solo lugar, igual que
-- admin_caller_puede_gestionar_usuarios centraliza el permiso
-- booleano (0021).
CREATE OR REPLACE FUNCTION public.admin_caller_es_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    WHERE up.id = p_user_id
      AND up.activo = true
      AND up.rol = 'admin'
  );
$$;


-- ── admin_create_auth_user ──────────────────────────────────
-- Agrega: si el rol a asignar es 'admin', el caller debe serlo.
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

  IF p_rol = 'admin' AND NOT admin_caller_es_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo una cuenta con rol admin puede asignar el rol admin.';
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


-- ── admin_upsert_user_profile ───────────────────────────────
-- Agrega: si el rol nuevo es 'admin', o si el usuario objetivo
-- YA tiene rol 'admin' (se esté cambiando su rol o no), el
-- caller debe serlo. Cubre tanto la escalada ("me asigno/asigno
-- a otro el rol admin") como la degradación no autorizada de un
-- admin existente por alguien sin ese rol.
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
  v_rol_actual TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  SELECT rol INTO v_rol_actual FROM user_profiles WHERE id = p_user_id;

  IF (p_rol = 'admin' OR v_rol_actual = 'admin')
     AND NOT admin_caller_es_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo una cuenta con rol admin puede asignar o modificar el rol admin.';
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


-- ── admin_toggle_user_activo ────────────────────────────────
-- Agrega: activar/desactivar una cuenta con rol 'admin' requiere
-- que el caller también lo sea.
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

  IF v_rol = 'admin' AND NOT admin_caller_es_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo una cuenta con rol admin puede activar o desactivar otra cuenta admin.';
  END IF;

  IF NOT p_activo AND admin_quedaria_sin_gestion(p_user_id, v_rol, false) THEN
    RAISE EXCEPTION 'No puedes desactivar al último usuario con permiso para gestionar usuarios y roles.';
  END IF;

  UPDATE user_profiles SET activo = p_activo, actualizado_en = now() WHERE id = p_user_id;
END;
$$;


-- ── admin_delete_user ───────────────────────────────────────
-- Agrega: eliminar una cuenta con rol 'admin' requiere que el
-- caller también lo sea.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_target_email TEXT;
  v_target_rol TEXT;
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(v_caller_id) THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar usuarios.';
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta.';
  END IF;

  SELECT email, rol INTO v_target_email, v_target_rol
  FROM user_profiles
  WHERE id = p_target_user_id;

  IF v_target_rol = 'admin' AND NOT admin_caller_es_admin(v_caller_id) THEN
    RAISE EXCEPTION 'Solo una cuenta con rol admin puede eliminar otra cuenta admin.';
  END IF;

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


-- ── admin_reset_user_password ───────────────────────────────
-- Agrega: resetear la contraseña de una cuenta con rol 'admin'
-- requiere que el caller también lo sea. (No es la vía que usa
-- hoy el frontend — ver api/admin-users.js — pero es invocable
-- directamente vía RPC y forma parte del mismo catálogo de 0021.)
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  p_user_id  uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 8 caracteres.';
  END IF;

  SELECT rol INTO v_rol FROM user_profiles WHERE id = p_user_id;
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado.';
  END IF;

  IF v_rol = 'admin' AND NOT admin_caller_es_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo una cuenta con rol admin puede resetear la contraseña de otra cuenta admin.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = now()
  WHERE id = p_user_id;
END;
$$;

-- ── Verificación post-migración ──────────────────────────────
-- 1. Smoke test con una cuenta no-admin con puedeGestionarUsuarios:
--    debe fallar con el mensaje de "Solo una cuenta con rol admin..."
--    al intentar crear/editar/desactivar/eliminar/resetear una
--    cuenta admin, y debe seguir funcionando igual que antes para
--    cualquier otro rol objetivo.
-- 2. Confirmar que la cuenta admin real puede seguir gestionando
--    otras cuentas admin sin cambios de comportamiento.
-- 3. Correr la suite completa (npx vitest run) — estas RPCs no
--    tienen mocks de Supabase en los tests actuales, así que no
--    se espera ningún test roto por este cambio.
