-- ============================================================================
-- Migración: 0054_permisos_borrado_sesiones_reportes.sql
-- Fecha: 10 de julio de 2026
--
-- CONTEXTO
-- --------
-- Nueva capacidad solicitada: solo el rol admin puede borrar:
--   1. Registros de sesión de login  (tabla session_logs, vista en
--      TabSesiones.jsx dentro del módulo de Administración → Registros).
--   2. Sesiones QR de asistencia ya cerradas/expiradas (tabla qr_sessions,
--      vista en AdminQRPanel.jsx). Borrar una sesión QR NO borra las
--      asistencias que se registraron con ella: asistencias_diarias.
--      qr_session_id tiene ON DELETE SET NULL (ver 0006), así que el
--      historial de asistencia queda intacto, solo se pierde el vínculo
--      con la sesión que ya no existe.
--   3. Reportes de asistencia por rango de fechas (tabla asistencias_diarias,
--      vista en ReporteRango.jsx / VistaAusentes.jsx). Este SÍ borra datos
--      de asistencia reales — es la operación más destructiva de las tres.
--
-- DECISIÓN DE ARQUITECTURA (confirmada con el usuario):
--   Permiso dinámico en el JSONB de roles (mismo patrón que el resto del
--   sistema: puedeGestionarUsuarios, puedeVerLogs, etc.), NO un chequeo
--   hardcodeado por nombre de rol. Se asignan ambos permisos nuevos
--   ÚNICAMENTE al rol 'admin' en esta migración; si en el futuro se decide
--   dar esta capacidad a otro rol, se activa desde el panel de Usuarios y
--   Roles sin tocar código.
--
--   Nuevas claves en roles.permisos:
--     puedeBorrarSesiones  -> controla AMBOS: session_logs Y qr_sessions
--     puedeBorrarReportes  -> controla asistencias_diarias
--
-- SEGURIDAD (mismo patrón que admin_delete_user / admin_create_auth_user,
-- 0021, y SEC-10/SEC-11): el permiso se revalida DENTRO de cada RPC
-- SECURITY DEFINER, nunca se confía solo en que la UI oculte el botón.
-- No se agregan políticas RLS FOR DELETE en estas tres tablas a propósito:
-- hoy no existe ninguna (confirmado contra 0006/0031/0036), por lo que
-- cualquier DELETE directo desde el cliente ya es rechazado por RLS. El
-- único camino de borrado es a través de estas RPCs.
--
-- Cada RPC registra la acción en audit_logs (log_audit_event, 0024/0025)
-- con la cantidad de filas afectadas y los filtros usados, para que el
-- borrado quede trazado igual que cualquier otra acción administrativa.
-- ============================================================================


-- ── 1. Asignar los dos permisos nuevos SOLO al rol admin ────────────────────
UPDATE public.roles
SET permisos = permisos || jsonb_build_object(
  'puedeBorrarSesiones', true,
  'puedeBorrarReportes', true
)
WHERE nombre = 'admin';


-- ── 2. admin_borrar_session_logs ─────────────────────────────────────────────
-- Borra registros de session_logs por ids específicos O por antigüedad
-- (todo lo anterior a p_antes_de). Exactamente uno de los dos debe venir.
CREATE OR REPLACE FUNCTION public.admin_borrar_session_logs(
  p_ids       UUID[]      DEFAULT NULL,
  p_antes_de  TIMESTAMPTZ DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeBorrarSesiones') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar registros de sesión.';
  END IF;

  IF (p_ids IS NULL OR array_length(p_ids, 1) IS NULL) AND p_antes_de IS NULL THEN
    RAISE EXCEPTION 'Debes indicar ids específicos o una fecha límite (p_antes_de).';
  END IF;

  DELETE FROM public.session_logs
  WHERE (p_ids IS NOT NULL AND id = ANY(p_ids))
     OR (p_antes_de IS NOT NULL AND created_at < p_antes_de);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_audit_event(
    p_accion        := 'borrar_session_logs',
    p_entidad       := 'session_logs',
    p_resumen       := format('Se borraron %s registro(s) de sesión.', v_count),
    p_datos_despues := jsonb_build_object(
      'cantidad',  v_count,
      'ids',       p_ids,
      'antes_de',  p_antes_de
    )
  );

  RETURN v_count;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_borrar_session_logs(UUID[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_borrar_session_logs(UUID[], TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.admin_borrar_session_logs IS
  'Borra registros de session_logs por ids o por antigüedad. Requiere '
  'permiso puedeBorrarSesiones (revalidado en el servidor). Registra la '
  'acción en audit_logs.';


-- ── 3. admin_borrar_qr_sesiones ──────────────────────────────────────────────
-- Borra sesiones QR por id. Las asistencias ya registradas con esas
-- sesiones NO se borran (qr_session_id -> SET NULL, ver 0006). Por
-- seguridad, rechaza el borrado si alguna de las sesiones sigue activa
-- (activa = true): primero hay que cerrarla desde el panel.
CREATE OR REPLACE FUNCTION public.admin_borrar_qr_sesiones(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count  INTEGER;
  v_activas INTEGER;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeBorrarSesiones') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar sesiones QR.';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Debes indicar al menos un id de sesión.';
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

REVOKE ALL    ON FUNCTION public.admin_borrar_qr_sesiones(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_borrar_qr_sesiones(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.admin_borrar_qr_sesiones IS
  'Borra sesiones QR (qr_sessions) por id. No afecta asistencias_diarias '
  '(qr_session_id queda en NULL). Rechaza sesiones activas. Requiere '
  'permiso puedeBorrarSesiones.';


-- ── 4. admin_borrar_asistencias_rango ────────────────────────────────────────
-- Borra registros de asistencias_diarias dentro de un rango de fechas,
-- con filtros opcionales de turno y programa. Es la operación más
-- destructiva: borra datos de asistencia real, no metadatos de sesión.
CREATE OR REPLACE FUNCTION public.admin_borrar_asistencias_rango(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT DEFAULT NULL,
  p_programa    TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER;
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

  DELETE FROM public.asistencias_diarias
  WHERE fecha BETWEEN p_fecha_desde AND p_fecha_hasta
    AND (p_turno    IS NULL OR turno    = p_turno)
    AND (p_programa IS NULL OR programa = p_programa);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_audit_event(
    p_accion            := 'borrar_asistencias_rango',
    p_entidad           := 'asistencias_diarias',
    p_programa_afectado := p_programa,
    p_resumen           := format(
      'Se borraron %s registro(s) de asistencia entre %s y %s.',
      v_count, p_fecha_desde, p_fecha_hasta
    ),
    p_datos_despues     := jsonb_build_object(
      'cantidad',     v_count,
      'fecha_desde',  p_fecha_desde,
      'fecha_hasta',  p_fecha_hasta,
      'turno',        p_turno,
      'programa',     p_programa
    )
  );

  RETURN v_count;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_borrar_asistencias_rango(DATE, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_borrar_asistencias_rango(DATE, DATE, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_borrar_asistencias_rango IS
  'Borra registros de asistencias_diarias en un rango de fechas (con '
  'filtros opcionales de turno/programa). Requiere permiso '
  'puedeBorrarReportes. Operación destructiva sobre datos reales de '
  'asistencia, no solo metadatos de sesión.';


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Confirmar que el rol admin tiene los permisos nuevos:
--
--    SELECT nombre, permisos->'puedeBorrarSesiones' AS sesiones,
--           permisos->'puedeBorrarReportes' AS reportes
--    FROM roles WHERE nombre = 'admin';
--
--    Ambos deben ser `true`. Cualquier otro rol debe seguir en NULL/false
--    (PERMISOS_BASE en useAuth.js los trata como false por defecto).
--
-- 2. Con un usuario SIN estos permisos, cada RPC debe rechazar con el
--    mensaje de excepción correspondiente:
--
--    SELECT admin_borrar_session_logs(p_antes_de := now());
--    SELECT admin_borrar_qr_sesiones(ARRAY['00000000-0000-0000-0000-000000000000']::uuid[]);
--    SELECT admin_borrar_asistencias_rango(CURRENT_DATE, CURRENT_DATE);
--
-- 3. Con el usuario admin:
--    a) admin_borrar_qr_sesiones sobre una sesión con activa=true debe
--       rechazar con "sesión(es) todavía activa(s)".
--    b) admin_borrar_qr_sesiones sobre una sesión inactiva debe borrarla
--       y las filas de asistencias_diarias asociadas deben conservarse
--       con qr_session_id = NULL (no desaparecer).
--    c) admin_borrar_asistencias_rango con fecha_desde > fecha_hasta debe
--       rechazar.
--    d) Cada llamada exitosa debe dejar una fila nueva en audit_logs con
--       la acción correspondiente y la cantidad borrada.
-- ============================================================================
