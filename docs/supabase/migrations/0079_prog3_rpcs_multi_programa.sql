-- ============================================================================
-- Migración: 0079_prog3_rpcs_multi_programa.sql
-- Fecha: 8 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Fase 1 de PROG-3 (ver AUDITORIA_INDICE.md): `PROG-2` (0078) creó
-- `user_profiles_programas` (relación N:N) pero dejó dicho que no tenía
-- utilidad real hasta que `ModalUsuario.jsx` pudiera asignar más de un
-- programa a un coordinador -- hoy ese modal es de-uno-solo, escribiendo
-- solo la columna escalar `user_profiles.programa`.
--
-- Esta migración agrega el backend que esa UI necesita. No toca RLS de
-- horarios/docentes/materias/asistencias_diarias todavía (eso sigue
-- siendo la fase 2 de PROG-3, después de migrar los 6 puntos de lectura
-- mapeados en PROG-1).
--
-- DOS RPCs NUEVAS
-- ----------------
-- 1. `admin_get_user_profiles_programas()` -- lista (user_id, programas[])
--    para que `PestanaUsuarios.jsx` pueda precargar el multi-select al
--    editar, sin tener que redefinir el tipo de retorno de
--    `admin_get_users()` (que es `SETOF user_profiles`, columna por
--    columna del esquema real -- más frágil de tocar que agregar una
--    consulta aparte). Mismo alcance/scoping por sede que
--    `admin_get_users()` (SEDE-12): solo usuarios visibles para el actor.
--
-- 2. `admin_set_user_programas(p_user_id, p_programas)` -- reemplaza el
--    conjunto completo de programas de un usuario. Sincroniza de paso la
--    columna escalar `user_profiles.programa` (primer elemento del
--    array, o NULL) para que el resto de la app -- que hoy sigue leyendo
--    ese campo como "programa principal/legado", según quedó documentado
--    en 0078 -- no quede desactualizada mientras PROG-1 no termine de
--    migrar sus 6 puntos de lectura a la tabla nueva.
--
-- `admin_upsert_user_profile` (0062) NO se toca en esta migración: sigue
-- siendo la única responsable de crear/actualizar la fila base de
-- user_profiles (email, rol, sede, y programa "principal" por
-- compatibilidad). El frontend llama a las dos RPCs en secuencia --
-- mismo patrón que ya usa para password (llamada aparte tras el upsert
-- del perfil).
-- ============================================================================


-- ── 1. admin_get_user_profiles_programas ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_user_profiles_programas()
RETURNS TABLE (user_id uuid, programas text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    RAISE EXCEPTION 'No tienes permiso para ver usuarios.';
  END IF;

  RETURN QUERY
    SELECT upp.user_id, array_agg(upp.programa ORDER BY upp.programa)
    FROM user_profiles_programas upp
    JOIN user_profiles up ON up.id = upp.user_id
    WHERE usuario_puede_ver_sede(up.sede_id)
    GROUP BY upp.user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_get_user_profiles_programas() IS
  'PROG-3 (fase 1). Devuelve (user_id, programas[]) para que ModalUsuario '
  'pueda precargar el multi-select al editar. Mismo scoping por sede que '
  'admin_get_users() (SEDE-12). Usuarios sin ninguna fila en '
  'user_profiles_programas simplemente no aparecen -- el frontend cae de '
  'vuelta a user_profiles.programa (columna escalar) en ese caso.';

REVOKE ALL    ON FUNCTION public.admin_get_user_profiles_programas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_profiles_programas() TO authenticated;


-- ── 2. admin_set_user_programas ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_programas(
  p_user_id   uuid,
  p_programas text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rol        TEXT;
  v_restringe  BOOLEAN;
  v_limpios    TEXT[];
  v_principal  TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  SELECT rol INTO v_rol FROM user_profiles WHERE id = p_user_id;
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'El usuario no existe.';
  END IF;

  SELECT restringe_programa INTO v_restringe FROM roles WHERE nombre = v_rol;

  -- Limpia: quita blancos/duplicados. Si el rol NO restringe programa, se
  -- ignora lo que se haya mandado -- ese usuario ve todo, no tiene sentido
  -- guardarle una lista (mismo criterio que admin_upsert_user_profile ya
  -- aplica a la columna escalar: programa = NULL cuando no restringe).
  IF NOT v_restringe THEN
    v_limpios := ARRAY[]::TEXT[];
  ELSE
    SELECT array_agg(DISTINCT btrim(x)) INTO v_limpios
    FROM unnest(COALESCE(p_programas, ARRAY[]::TEXT[])) AS x
    WHERE btrim(x) <> '';

    IF v_limpios IS NULL OR array_length(v_limpios, 1) IS NULL THEN
      RAISE EXCEPTION 'Este rol requiere al menos un programa asignado.';
    END IF;
  END IF;

  DELETE FROM user_profiles_programas WHERE user_id = p_user_id;

  IF array_length(v_limpios, 1) IS NOT NULL THEN
    INSERT INTO user_profiles_programas (user_id, programa)
    SELECT p_user_id, p FROM unnest(v_limpios) AS p;
  END IF;

  -- Sincroniza la columna escalar "principal" -- ver contexto arriba.
  v_principal := v_limpios[1];
  UPDATE user_profiles
    SET programa = v_principal, actualizado_en = now()
    WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_set_user_programas IS
  'PROG-3 (fase 1). Reemplaza el conjunto completo de programas de un '
  'usuario en user_profiles_programas. Si el rol del usuario no tiene '
  'restringe_programa, se ignora p_programas y se deja la lista vacía -- '
  'ese usuario ve todo. Si lo tiene, exige al menos un programa no vacío. '
  'Sincroniza user_profiles.programa (primer elemento del array) para no '
  'romper el resto de la app mientras dependa de esa columna escalar.';

REVOKE ALL    ON FUNCTION public.admin_set_user_programas(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_programas(uuid, text[]) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT admin_set_user_programas('<uuid de un coordinador>',
--      ARRAY['PNF Informática', 'PNF Contaduría Pública']);
--    SELECT * FROM user_profiles_programas WHERE user_id = '<ese uuid>';
--    -- 2 filas. SELECT programa FROM user_profiles WHERE id = '<ese uuid>';
--    -- 'PNF Informática' (el primero del array)
-- 2. SELECT * FROM admin_get_user_profiles_programas();
--    -- debe incluir la fila de arriba con programas = {PNF Contaduría
--    -- Pública, PNF Informática} (array_agg ordena alfabético)
-- 3. admin_set_user_programas(<uuid de un rol sin restringe_programa>,
--      ARRAY['cualquier cosa']) -- debe limpiar (0 filas), programa = NULL
-- 4. admin_set_user_programas(<uuid de un rol que restringe>, ARRAY[]::text[])
--    -- debe rechazar: "Este rol requiere al menos un programa asignado."
-- ============================================================================
