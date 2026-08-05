-- ============================================================================
-- Migración: 0062_permiso_ver_todas_sedes_y_rpc_usuarios.sql
-- Fecha: 4 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Continúa 0061. Agrega el permiso dinámico `puedeVerTodasLasSedes`
-- (mismo patrón que puedeBorrarSesiones/puedeBorrarReportes en 0054: se
-- asigna por rol en el jsonb de `roles`, no hardcodeado por nombre de
-- rol) y actualiza `admin_upsert_user_profile` para que reciba/valide
-- `p_sede_id`, igual que ya hace con `p_programa`.
--
-- Se asigna el permiso a 'admin' (ya existe) y se dispara para el rol
-- 'coordinador' (ya existe en la BD como rol de sistema — ver
-- ESQUEMA_Y_MIGRACIONES.md §3 `roles`) bajo el entendido de que ese es el
-- "coordinador general" al que se refirió el usuario. Si en la práctica
-- el coordinador general es un rol distinto (ej. uno nuevo o
-- `coord_administrativo`), se reasigna el permiso desde el panel de
-- Usuarios y Roles sin tocar código — es exactamente para eso que existe
-- el RBAC dinámico.
-- ============================================================================


-- ── 1. Permiso nuevo, solo para admin + coordinador ──────────────────────────
UPDATE public.roles
SET permisos = permisos || jsonb_build_object('puedeVerTodasLasSedes', true)
WHERE nombre IN ('admin', 'coordinador');


-- ── 2. admin_upsert_user_profile — agrega p_sede_id ──────────────────────────
-- Regla de validación: p_sede_id es obligatorio salvo que el rol nuevo
-- tenga puedeVerTodasLasSedes = true (mismo patrón que restringe_programa
-- pero a la inversa: acá casi todos los roles REQUIEREN sede, solo un par
-- de excepciones no la requieren).
--
-- FIX (revisión previa a aplicar): la firma cambia de 5 a 6 parámetros
-- (se agrega p_sede_id). Postgres distingue funciones por firma completa,
-- así que un CREATE OR REPLACE con un parámetro nuevo NO reemplaza la
-- versión vieja — crea un segundo overload superpuesto. Sin este DROP,
-- la versión de 5 parámetros queda viva, con GRANT a `authenticated`
-- vigente, y sin ninguna validación ni exigencia de sede.
DROP FUNCTION IF EXISTS public.admin_upsert_user_profile(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_upsert_user_profile(
  p_user_id  uuid,
  p_email    text,
  p_nombre   text,
  p_rol      text,
  p_programa text DEFAULT NULL,
  p_sede_id  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_restringe        BOOLEAN;
  v_ve_todas_sedes    BOOLEAN;
  v_rol_actual        TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  SELECT rol INTO v_rol_actual FROM user_profiles WHERE id = p_user_id;

  IF (p_rol = 'admin' OR v_rol_actual = 'admin')
     AND NOT admin_caller_es_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo una cuenta con rol admin puede asignar o modificar el rol admin.';
  END IF;

  SELECT restringe_programa, COALESCE((permisos->>'puedeVerTodasLasSedes')::boolean, false)
    INTO v_restringe, v_ve_todas_sedes
  FROM roles WHERE nombre = p_rol;

  IF v_restringe IS NULL THEN
    RAISE EXCEPTION 'El rol "%" no existe.', p_rol;
  END IF;
  IF v_restringe AND (p_programa IS NULL OR btrim(p_programa) = '') THEN
    RAISE EXCEPTION 'Este rol requiere un programa asignado.';
  END IF;

  IF NOT v_ve_todas_sedes AND (p_sede_id IS NULL OR btrim(p_sede_id) = '') THEN
    RAISE EXCEPTION 'Este rol requiere una sede asignada.';
  END IF;
  IF p_sede_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
    RAISE EXCEPTION 'La sede "%" no existe.', p_sede_id;
  END IF;

  IF admin_quedaria_sin_gestion(p_user_id, p_rol, true) THEN
    RAISE EXCEPTION 'Este cambio dejaría el sistema sin ningún usuario activo con permiso para gestionar usuarios y roles.';
  END IF;

  INSERT INTO user_profiles (id, email, nombre, rol, programa, sede_id, creado_por)
  VALUES (
    p_user_id, p_email, p_nombre, p_rol, NULLIF(btrim(COALESCE(p_programa, '')), ''),
    NULLIF(btrim(COALESCE(p_sede_id, '')), ''),
    (SELECT nombre FROM user_profiles WHERE id = auth.uid())
  )
  ON CONFLICT (id) DO UPDATE
    SET email          = EXCLUDED.email,
        nombre         = EXCLUDED.nombre,
        rol            = EXCLUDED.rol,
        programa       = EXCLUDED.programa,
        sede_id        = EXCLUDED.sede_id,
        actualizado_en = now();
END;
$$;

-- La firma cambió (parámetro nuevo con DEFAULT al final, compatible hacia
-- atrás para cualquier caller que no mande p_sede_id todavía), pero se
-- deja el REVOKE/GRANT explícito igual que el resto de las RPCs admin_*
-- por si el motor requiere refrescar privilegios tras el CREATE OR REPLACE.
REVOKE ALL    ON FUNCTION public.admin_upsert_user_profile(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_user_profile(uuid, text, text, text, text, text) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT nombre, permisos->'puedeVerTodasLasSedes' FROM roles
--    WHERE nombre IN ('admin','coordinador');           -- ambos: true
-- 2. Cualquier otro rol: NULL (PERMISOS_BASE lo trata como false).
-- 3. admin_upsert_user_profile con un rol sin puedeVerTodasLasSedes y
--    p_sede_id NULL -> debe rechazar con "requiere una sede asignada".
-- 4. Mismo caso con p_sede_id = 'no_existe' -> debe rechazar con
--    "La sede ... no existe".
-- 5. Caso admin/coordinador con p_sede_id NULL -> debe aceptar.
-- ============================================================================
