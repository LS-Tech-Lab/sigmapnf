-- ============================================================================
-- Migración: 0068_auditoria_sede_gestion_usuarios_borrado.sql
-- Fecha: 6 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Auditoría completa de SEDE-1..10 (todas las funciones SECURITY DEFINER
-- que tocan tablas con sede_id, no solo las ya migradas). 4 hallazgos:
--
--   SEDE-11 (CRÍTICO): replace_nombre_en_clases(old_raw, new_raw) —
--     0032 (junio 2026, nunca tocada desde entonces). SECURITY DEFINER
--     SIN ningún chequeo de permiso y SIN filtro de sede: reescribe
--     `horarios.clase` por coincidencia LIKE en TODAS las sedes. Llamada
--     por nameEditing.js (unifyNameLegacy) cuando renombrar un
--     docente/materia colisiona con un nombre_display ya existente.
--
--   SEDE-12 (ALTO): admin_get_users/admin_toggle_user_activo/
--     admin_delete_user/admin_reset_user_password — sin filtro de sede.
--     Hoy no explotable (solo admin/coordinador tienen
--     puedeGestionarUsuarios, ambos con puedeVerTodasLasSedes), pero el
--     RBAC es dinámico (PestanaUsuarios ya permite activar
--     puedeGestionarUsuarios en cualquier rol nuevo) -- en cuanto exista
--     un rol "coordinador de sede" con gestión de usuarios pero sin ver
--     todas las sedes, vería/gestionaría usuarios de otras sedes.
--
--   SEDE-13 (ALTO): admin_borrar_qr_sesiones/admin_borrar_asistencias_
--     rango — mismo problema que borrar_horarios/restaurar_backup (0065),
--     pero esas dos quedaron fuera de esa migración. Con
--     puedeBorrarSesiones/puedeBorrarReportes (hoy solo admin) en un rol
--     futuro sin puedeVerTodasLasSedes, se podría borrar QR/asistencias
--     de OTRA sede completa.
--
--   SEDE-14 (MEDIO): renovar_qr_token — solo valida puedeGestionarQR, no
--     que la sesión sea de la sede del actor. Mismo principio de defensa
--     en profundidad que ya se aplicó (SEC-8) a esta función.
--
-- Ningún hallazgo requiere cambiar el frontend salvo dos casos concretos
-- (nameEditing.js y ReporteRango.jsx, ver el próximo mensaje del
-- asistente) — el resto resuelve la sede desde auth.uid() (identidad del
-- caller) o desde filas que el cliente ya solo puede ver de su propia
-- sede vía RLS, sin necesitar ningún parámetro nuevo.
-- ============================================================================


-- ── SEDE-11. replace_nombre_en_clases — agrega permiso + filtro de sede ─────
-- FIX (mismo patrón que crear_qr_session/horario_docente_hoy en 0064): la
-- firma cambia (se agrega p_sede_id) -- se sueltan los overloads
-- existentes antes de recrearla.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'replace_nombre_en_clases'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.replace_nombre_en_clases(
  old_raw   TEXT,
  new_raw   TEXT,
  p_sede_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sede_efectiva TEXT;
BEGIN
  -- Nunca tuvo chequeo de permiso -- cualquier autenticado podía
  -- reescribir horarios.clase de cualquier sede con solo conocer el
  -- nombre de la función. Se exige el mismo permiso que ya protege el
  -- UPDATE directo de docentes/materias (esta función existe justo para
  -- unificar uno de los dos), sea cual sea el flujo (docente o materia)
  -- que la disparó.
  IF NOT (
    tiene_permiso(auth.uid(), 'puedeEditarDocentes')
    OR tiene_permiso(auth.uid(), 'puedeEditarMaterias')
  ) THEN
    RAISE EXCEPTION 'No tienes permiso para editar horarios.';
  END IF;

  -- Mismo patrón de resolución de sede que conflictos_horario (0067).
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();
  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de unificar nombres.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  UPDATE public.horarios
  SET    clase = REPLACE(clase, old_raw, new_raw)
  WHERE  clase LIKE '%' || old_raw || '%'
    AND  sede_id = v_sede_efectiva;
END;
$$;

COMMENT ON FUNCTION public.replace_nombre_en_clases(text, text, text) IS
  'SEDE-11: agrega el chequeo de permiso que nunca tuvo (puedeEditarDocentes '
  'o puedeEditarMaterias) y filtra el UPDATE por sede_id. Antes cualquier '
  'autenticado podía reescribir horarios.clase de CUALQUIER sede solo '
  'conociendo el nombre de la función -- ni RLS la protegía (SECURITY '
  'DEFINER) ni tenía chequeo propio.';

REVOKE ALL    ON FUNCTION public.replace_nombre_en_clases(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_nombre_en_clases(text, text, text) TO authenticated;


-- ── SEDE-12. Gestión de usuarios — filtrar por sede visible del caller ──────
-- Ninguna cambia de firma: la sede del CALLER se resuelve de auth.uid()
-- (admin_get_users) y la sede del TARGET se resuelve de user_profiles
-- (las otras tres) -- no hace falta ningún parámetro nuevo ni tocar el
-- frontend.

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
  -- SEDE-12: antes devolvía TODOS los perfiles sin importar la sede.
  -- usuario_puede_ver_sede() ya cubre el caso puedeVerTodasLasSedes (ve
  -- todo) y el de una fila con sede_id NULL (otro usuario "ve todas las
  -- sedes") -- solo es visible para quien también tiene ese permiso.
  RETURN QUERY
    SELECT * FROM user_profiles up
    WHERE usuario_puede_ver_sede(up.sede_id)
    ORDER BY creado_en DESC;
END;
$$;

COMMENT ON FUNCTION public.admin_get_users() IS
  'SEDE-12: agrega usuario_puede_ver_sede(up.sede_id) -- antes listaba '
  'usuarios de todas las sedes sin importar el alcance del caller. Hoy no '
  'explotable en la práctica (solo admin/coordinador tienen '
  'puedeGestionarUsuarios, ambos con puedeVerTodasLasSedes), pero el RBAC '
  'es dinámico y un rol futuro sin ese permiso quedaría expuesto.';


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
  v_sede_target TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  SELECT rol, sede_id INTO v_rol, v_sede_target FROM user_profiles WHERE id = p_user_id;
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado.';
  END IF;

  -- SEDE-12: el target debe estar en una sede que el caller puede ver.
  IF NOT usuario_puede_ver_sede(v_sede_target) THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios de esa sede.';
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

COMMENT ON FUNCTION public.admin_toggle_user_activo(uuid, boolean) IS
  'SEDE-12: agrega usuario_puede_ver_sede(v_sede_target) -- antes se podía '
  'activar/desactivar cualquier usuario de cualquier sede con solo tener '
  'puedeGestionarUsuarios. Resto del comportamiento (jerarquía admin, '
  'SEC-10) sin cambios.';


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
  v_sede_target TEXT;
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(v_caller_id) THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar usuarios.';
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta.';
  END IF;

  SELECT email, rol, sede_id INTO v_target_email, v_target_rol, v_sede_target
  FROM user_profiles
  WHERE id = p_target_user_id;

  -- SEDE-12: mismo criterio que admin_toggle_user_activo. Se valida
  -- ANTES del chequeo de jerarquía admin (mismo orden que ya tenía el
  -- chequeo de rol admin) para no filtrar por error si el target no es
  -- visible para el caller en absoluto.
  IF NOT usuario_puede_ver_sede(v_sede_target) THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar usuarios de esa sede.';
  END IF;

  IF v_target_rol = 'admin' AND NOT admin_caller_es_admin(v_caller_id) THEN
    RAISE EXCEPTION 'Solo una cuenta con rol admin puede eliminar otra cuenta admin.';
  END IF;

  IF admin_quedaria_sin_gestion(p_target_user_id, v_target_rol, false) THEN
    RAISE EXCEPTION 'No puedes eliminar al último usuario con permiso para gestionar usuarios y roles.';
  END IF;

  DELETE FROM user_profiles WHERE id = p_target_user_id;
  DELETE FROM auth.users WHERE id = p_target_user_id;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    PERFORM log_audit_event(
      p_accion        := 'eliminar_usuario',
      p_entidad       := 'user_profiles',
      p_resumen       := format('Usuario eliminado: %s', v_target_email),
      p_datos_despues := jsonb_build_object('email', v_target_email, 'rol', v_target_rol)
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_user(uuid) IS
  'SEDE-12: agrega usuario_puede_ver_sede(v_sede_target) -- antes se podía '
  'eliminar cualquier usuario de cualquier sede con solo tener el permiso '
  'de gestión. Resto del comportamiento (jerarquía admin, SEC-10; '
  '"quedaría sin gestión") sin cambios.';


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
  v_sede_target TEXT;
BEGIN
  IF NOT admin_caller_puede_gestionar_usuarios(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios.';
  END IF;

  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 8 caracteres.';
  END IF;

  SELECT sede_id INTO v_sede_target FROM user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado.';
  END IF;

  -- SEDE-12: mismo criterio. Antes cualquiera con permiso de gestión
  -- podía resetear la contraseña de un usuario de OTRA sede.
  IF NOT usuario_puede_ver_sede(v_sede_target) THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar usuarios de esa sede.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = now()
  WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_reset_user_password(uuid, text) IS
  'SEDE-12: agrega usuario_puede_ver_sede(v_sede_target) -- antes se podía '
  'resetear la contraseña de cualquier usuario de cualquier sede con solo '
  'tener el permiso de gestión.';


-- ── SEDE-13. Borrado administrativo — filtrar por sede ──────────────────────

-- admin_borrar_qr_sesiones: sin cambio de firma. Filtra el DELETE por
-- sede visible y rechaza explícitamente si algún id pedido no lo es (en
-- vez de borrar en silencio solo los visibles, que confundiría "pedí 3,
-- borró 1" sin decir por qué).
CREATE OR REPLACE FUNCTION public.admin_borrar_qr_sesiones(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count   INTEGER;
  v_activas INTEGER;
  v_no_visibles INTEGER;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeBorrarSesiones') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar sesiones QR.';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Debes indicar al menos un id de sesión.';
  END IF;

  -- SEDE-13: en la práctica HistorialSesiones.jsx solo lista sesiones de
  -- la sede visible del caller (RLS, 0064), así que esto no debería
  -- dispararse desde la UI normal -- es defensa en profundidad contra un
  -- id de otra sede pasado directo a la RPC.
  SELECT count(*) INTO v_no_visibles
  FROM public.qr_sessions
  WHERE id = ANY(p_ids) AND NOT usuario_puede_ver_sede(sede_id);

  IF v_no_visibles > 0 THEN
    RAISE EXCEPTION 'No tienes permiso para borrar % de las sesiones indicadas.', v_no_visibles;
  END IF;

  SELECT count(*) INTO v_activas
  FROM public.qr_sessions
  WHERE id = ANY(p_ids) AND activa = true;

  IF v_activas > 0 THEN
    RAISE EXCEPTION 'Hay % sesión(es) todavía activa(s): ciérrala(s) antes de borrar.', v_activas;
  END IF;

  DELETE FROM public.qr_sessions
  WHERE id = ANY(p_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_audit_event(
    p_accion        := 'borrar_qr_sesiones',
    p_entidad       := 'qr_sessions',
    p_resumen       := format('Se borraron %s sesión(es) QR. Las asistencias asociadas se conservan.', v_count),
    p_datos_despues := jsonb_build_object('cantidad', v_count, 'ids', p_ids)
  );

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.admin_borrar_qr_sesiones(uuid[]) IS
  'SEDE-13: rechaza explícitamente si algún id pedido no es de una sede '
  'visible para el caller. Defensa en profundidad -- HistorialSesiones.jsx '
  'ya solo lista/pasa ids de la sede visible vía RLS (0064).';


-- admin_borrar_asistencias_rango: agrega p_sede_id (mismo patrón que
-- conflictos_horario/crear_qr_session) -- cambia de firma, requiere
-- soltar el overload viejo.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_borrar_asistencias_rango'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_borrar_asistencias_rango(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT DEFAULT NULL,
  p_programa    TEXT DEFAULT NULL,
  p_sede_id     TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER;
  v_sede_efectiva TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeBorrarReportes') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar reportes de asistencia.';
  END IF;

  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
    RAISE EXCEPTION 'Debes indicar fecha_desde y fecha_hasta.';
  END IF;

  IF p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'fecha_desde no puede ser posterior a fecha_hasta.';
  END IF;

  -- SEDE-13: antes borraba en TODAS las sedes que hicieran match con el
  -- rango/turno/programa. Mismo patrón de resolución que borrar_horarios
  -- (0065): sede fija del perfil, o p_sede_id si el rol ve todas las
  -- sedes -- ya no se puede borrar más de una sede en una sola llamada.
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();
  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de borrar reportes de asistencia.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  DELETE FROM public.asistencias_diarias
  WHERE fecha BETWEEN p_fecha_desde AND p_fecha_hasta
    AND (p_turno    IS NULL OR turno    = p_turno)
    AND (p_programa IS NULL OR programa = p_programa)
    AND sede_id = v_sede_efectiva;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_audit_event(
    p_accion            := 'borrar_asistencias_rango',
    p_entidad           := 'asistencias_diarias',
    p_programa_afectado := p_programa,
    p_resumen           := format(
      'Se borraron %s registro(s) de asistencia entre %s y %s (sede %s).',
      v_count, p_fecha_desde, p_fecha_hasta, v_sede_efectiva
    ),
    p_datos_despues     := jsonb_build_object(
      'cantidad',     v_count,
      'fecha_desde',  p_fecha_desde,
      'fecha_hasta',  p_fecha_hasta,
      'turno',        p_turno,
      'programa',     p_programa,
      'sede_id',      v_sede_efectiva
    )
  );

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.admin_borrar_asistencias_rango(date, date, text, text, text) IS
  'SEDE-13: agrega p_sede_id y filtra el DELETE por sede_id -- antes '
  'borraba asistencias de TODAS las sedes que hicieran match con el '
  'rango/turno/programa. Mismo patrón de resolución que borrar_horarios '
  '(0065).';

REVOKE ALL    ON FUNCTION public.admin_borrar_asistencias_rango(date, date, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_borrar_asistencias_rango(date, date, text, text, text) TO authenticated;


-- ── SEDE-14. renovar_qr_token — exige que la sesión sea de la sede visible ──
-- Sin cambio de firma. En la práctica useQRSession.js solo renueva el
-- session_id que ella misma creó momentos antes (misma sede) -- defensa
-- en profundidad, mismo principio que ya motivó SEC-8 para esta función.
CREATE OR REPLACE FUNCTION public.renovar_qr_token(
  p_session_id UUID,
  p_ttl_min    INTEGER DEFAULT 5
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuevo_token UUID := gen_random_uuid();
  v_expires_at  TIMESTAMPTZ := now() + (p_ttl_min || ' minutes')::INTERVAL;
  v_rows        INTEGER;
  v_sede_sesion TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarQR') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar sesiones QR.';
  END IF;

  SELECT sede_id INTO v_sede_sesion FROM qr_sessions WHERE id = p_session_id;

  IF v_sede_sesion IS NULL THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SESION_NO_ENCONTRADA',
      'mensaje', 'La sesión no existe o ya fue cerrada.'
    );
  END IF;

  IF NOT usuario_puede_ver_sede(v_sede_sesion) THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SIN_PERMISO',
      'mensaje', 'No tienes permiso para gestionar sesiones QR de esa sede.'
    );
  END IF;

  UPDATE qr_sessions
  SET    token      = v_nuevo_token,
         expires_at = v_expires_at
  WHERE  id     = p_session_id
    AND  activa = true;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SESION_NO_ENCONTRADA',
      'mensaje', 'La sesión no existe o ya fue cerrada.'
    );
  END IF;

  RETURN json_build_object(
    'ok',         true,
    'token',      v_nuevo_token,
    'expires_at', v_expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.renovar_qr_token(uuid, integer) IS
  'SEDE-14: agrega usuario_puede_ver_sede(v_sede_sesion) -- antes bastaba '
  'puedeGestionarQR sin importar de qué sede era la sesión. Defensa en '
  'profundidad (mismo principio que SEC-8): useQRSession.js solo renueva '
  'un session_id que ella misma creó en la misma sede.';


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. replace_nombre_en_clases: como usuario SIN puedeEditarDocentes ni
--    puedeEditarMaterias, llamarla directo debe rechazar con "No tienes
--    permiso para editar horarios." Como usuario de sede A, no debe
--    tocar filas de horarios.clase en sede B aunque hagan match LIKE.
-- 2. admin_get_users: crear un rol de prueba con puedeGestionarUsuarios
--    = true y puedeVerTodasLasSedes = false/ausente, asignarlo a un
--    usuario de sede A -- admin_get_users() para ese usuario debe listar
--    SOLO usuarios de sede A (no los de sede B).
-- 3. admin_toggle_user_activo / admin_delete_user /
--    admin_reset_user_password: con el mismo usuario de prueba de sede
--    A, intentar cualquiera de las tres sobre un p_user_id de sede B ->
--    debe rechazar con el mensaje de permiso de sede.
-- 4. admin_borrar_qr_sesiones: pasar un id de una sesión de otra sede ->
--    debe rechazar con "No tienes permiso para borrar 1 de las sesiones
--    indicadas."
-- 5. admin_borrar_asistencias_rango: llamarla sin p_sede_id desde un
--    usuario con sede fija -> debe borrar solo esa sede. Desde un
--    usuario con puedeVerTodasLasSedes sin p_sede_id -> debe rechazar
--    pidiendo que seleccione una sede.
-- 6. renovar_qr_token: con un p_session_id de otra sede -> debe devolver
--    {"ok": false, "codigo": "SIN_PERMISO", ...} en vez de renovarlo.
-- ============================================================================
