-- =====================================================================
-- Migración 0013: Validaciones de seguridad de fecha en el servidor
--
-- Implementa tres capas de defensa que operan independientemente
-- del frontend, haciendo imposible manipular la fecha desde el cliente:
--
--   1. crear_qr_session()  — Rechaza si p_fecha ≠ fecha actual en VE
--      (UTC-4). Un operador no puede crear sesiones en fechas pasadas
--      ni futuras aunque manipule el payload desde DevTools.
--
--   2. RLS policy en qr_sessions — Bloquea cualquier INSERT directo
--      con fecha ≠ hoy Venezuela, como segunda línea de defensa si
--      alguien intentara bypassear el RPC.
--
--   3. registrar_asistencia() — Verifica que la sesión QR escaneada
--      corresponda a la fecha actual en Venezuela. Un token válido de
--      ayer no puede usarse hoy.
--
-- Zona horaria Venezuela: UTC-4 fijo (no cambia por DST).
-- Se usa AT TIME ZONE 'America/Caracas' que Postgres resuelve
-- correctamente como UTC-4 todo el año.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- HELPER: fecha_hoy_ve()
-- Devuelve la fecha actual en Venezuela (UTC-4) como DATE.
-- Centraliza el cálculo para que todas las validaciones sean
-- consistentes aunque el servidor corra en otra zona horaria.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fecha_hoy_ve()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'America/Caracas')::DATE;
$$;

COMMENT ON FUNCTION fecha_hoy_ve IS
  'Devuelve la fecha actual en Venezuela (America/Caracas, UTC-4) como DATE. '
  'Usada por las validaciones de seguridad de sesión QR.';


-- ─────────────────────────────────────────────────────────────────────
-- 1. crear_qr_session() — Validación de fecha en servidor
--
-- Cambio respecto a la versión de 0006:
--   • Se verifica que p_fecha == fecha_hoy_ve() y se rechaza con
--     FECHA_INVALIDA si no coincide.
--   • p_fecha sigue teniendo DEFAULT CURRENT_DATE para compatibilidad,
--     pero si el cliente envía otra fecha, se rechaza aquí.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION crear_qr_session(
  p_turno    TEXT,
  p_programa TEXT    DEFAULT NULL,
  p_fecha    DATE    DEFAULT CURRENT_DATE,
  p_ttl_min  INTEGER DEFAULT 5
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hoy          DATE := fecha_hoy_ve();
  v_nueva_sesion qr_sessions%ROWTYPE;
BEGIN

  -- ── Validar turno ────────────────────────────────────────────────
  IF p_turno NOT IN ('DIURNO','VESPERTINO','NOCTURNO') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TURNO_INVALIDO',
      'mensaje', 'El turno debe ser DIURNO, VESPERTINO o NOCTURNO.'
    );
  END IF;

  -- ── NUEVO: Validar que la fecha sea hoy en Venezuela ─────────────
  IF p_fecha <> v_hoy THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'FECHA_INVALIDA',
      'mensaje', 'Solo se puede crear una sesión QR para la fecha de hoy ('
                 || to_char(v_hoy, 'DD/MM/YYYY') || ').'
    );
  END IF;

  -- Desactivar sesiones previas activas del mismo contexto
  UPDATE qr_sessions
  SET    activa = false
  WHERE  fecha    = p_fecha
    AND  turno    = p_turno
    AND  (programa = p_programa OR (programa IS NULL AND p_programa IS NULL))
    AND  activa   = true;

  -- Crear nueva sesión
  INSERT INTO qr_sessions (fecha, turno, programa, creado_por, expires_at)
  VALUES (
    p_fecha,
    p_turno,
    p_programa,
    auth.uid(),
    now() + (p_ttl_min || ' minutes')::INTERVAL
  )
  RETURNING * INTO v_nueva_sesion;

  RETURN json_build_object(
    'ok',         true,
    'session_id', v_nueva_sesion.id,
    'token',      v_nueva_sesion.token,
    'expires_at', v_nueva_sesion.expires_at
  );

END;
$$;

COMMENT ON FUNCTION crear_qr_session IS
  'Crea una nueva sesión QR para el admin. '
  'Invalida sesiones previas del mismo día/turno/programa. '
  'Rechaza si la fecha solicitada no es hoy en Venezuela (America/Caracas).';


-- ─────────────────────────────────────────────────────────────────────
-- 2. RLS: política de inserción en qr_sessions
--
-- Segunda línea de defensa: aunque alguien bypasee el RPC y tenga
-- credenciales de admin, no puede insertar directamente un registro
-- con fecha distinta a hoy Venezuela.
--
-- Nota: el INSERT real ocurre desde SECURITY DEFINER (privilegios del
-- owner), no del llamador, así que esta policy aplica solo a intentos
-- de acceso directo a la tabla (no a la RPC). Aun así se añade como
-- capa de profundidad.
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "solo_hoy_insert_qr_sessions" ON qr_sessions;

CREATE POLICY "solo_hoy_insert_qr_sessions"
  ON qr_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    fecha = fecha_hoy_ve()
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE  up.id     = auth.uid()
        AND  up.rol    IN ('admin', 'operador_qr')
        AND  up.activo = true
    )
  );

COMMENT ON POLICY "solo_hoy_insert_qr_sessions" ON qr_sessions IS
  'Impide insertar sesiones QR con fecha distinta a hoy en Venezuela. '
  'Segunda línea de defensa tras la validación en crear_qr_session().';


-- ─────────────────────────────────────────────────────────────────────
-- 3. registrar_asistencia() — Verificar fecha de la sesión al escanear
--
-- Cambio respecto a la versión de 0008:
--   • Tras validar token/activa/expires_at, se verifica que
--     v_session.fecha == fecha_hoy_ve().
--   • Evita que un token válido de una sesión de ayer pueda ser
--     usado hoy (ej.: si alguien guardó la URL del QR).
--   • La verificación va DESPUÉS de las validaciones existentes para
--     no cambiar el orden de los códigos de error ya integrados en
--     el frontend.
-- ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION registrar_asistencia(
  p_token              UUID,
  p_cedula_docente     TEXT,
  p_nombre_docente     TEXT,
  p_device_fingerprint TEXT DEFAULT NULL,
  p_tipo               TEXT DEFAULT 'ENTRADA'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session        qr_sessions%ROWTYPE;
  v_device_usado   TEXT;
  v_nuevo_id       UUID;
  v_tiene_entrada  BOOLEAN;
  v_dia_semana     TEXT;
  v_horario_hoy    JSON;
  v_hoy            DATE := fecha_hoy_ve();
BEGIN

  -- ── Validar p_tipo ───────────────────────────────────────────────
  IF p_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TIPO_INVALIDO',
      'mensaje', 'El tipo de registro debe ser ENTRADA o SALIDA.'
    );
  END IF;

  -- ── a) Buscar sesión por token ───────────────────────────────────
  SELECT * INTO v_session
  FROM   qr_sessions
  WHERE  token = p_token
  LIMIT  1;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TOKEN_INVALIDO',
      'mensaje', 'El código QR no es válido. Solicita uno nuevo al administrador.'
    );
  END IF;

  -- ── b) Verificar que la sesión esté activa ───────────────────────
  IF NOT v_session.activa THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SESION_INACTIVA',
      'mensaje', 'Esta sesión fue cerrada por el administrador. '
                 || 'Pide al operador que abra una nueva sesión QR.'
    );
  END IF;

  -- ── c) Verificar que el token no haya expirado ───────────────────
  IF now() > v_session.expires_at THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TOKEN_EXPIRADO',
      'mensaje', 'El código QR ha expirado. El administrador debe generar uno nuevo.'
    );
  END IF;

  -- ── NUEVO d) Verificar que la sesión es de HOY en Venezuela ──────
  -- Protege contra tokens de sesiones de días anteriores que por
  -- algún motivo no fueron cerradas y aún están dentro del TTL.
  IF v_session.fecha <> v_hoy THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SESION_FECHA_INVALIDA',
      'mensaje', 'Este código QR corresponde a una sesión de otro día y no puede usarse hoy.'
    );
  END IF;

  -- ── e) Detectar device_fingerprint duplicado en OTRA cédula ──────
  IF p_device_fingerprint IS NOT NULL THEN
    SELECT ad.cedula_docente INTO v_device_usado
    FROM   asistencias_diarias ad
    WHERE  ad.qr_session_id      = v_session.id
      AND  ad.device_fingerprint = p_device_fingerprint
      AND  ad.cedula_docente    <> p_cedula_docente
    LIMIT  1;

    IF FOUND THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'DEVICE_DUPLICADO',
        'mensaje', 'Este dispositivo ya fue utilizado para registrar la asistencia de otro docente en esta sesión.'
      );
    END IF;
  END IF;

  -- ── f) Si es SALIDA, exigir ENTRADA previa el mismo día ──────────
  IF p_tipo = 'SALIDA' THEN
    SELECT EXISTS (
      SELECT 1 FROM asistencias_diarias
      WHERE cedula_docente = p_cedula_docente
        AND fecha          = v_session.fecha
        AND tipo           = 'ENTRADA'
    ) INTO v_tiene_entrada;

    IF NOT v_tiene_entrada THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'SIN_ENTRADA_PREVIA',
        'mensaje', 'No se encontró un registro de entrada hoy. Marca tu entrada antes de marcar la salida.'
      );
    END IF;
  END IF;

  -- ── g) Insertar asistencia (o ignorar si ya existe ese tipo) ─────
  INSERT INTO asistencias_diarias (
    cedula_docente,
    nombre_docente,
    fecha,
    turno,
    programa,
    qr_session_id,
    device_fingerprint,
    tipo
  )
  VALUES (
    p_cedula_docente,
    p_nombre_docente,
    v_session.fecha,
    v_session.turno,
    v_session.programa,
    v_session.id,
    p_device_fingerprint,
    p_tipo
  )
  ON CONFLICT (cedula_docente, fecha, tipo) DO NOTHING
  RETURNING id INTO v_nuevo_id;

  IF v_nuevo_id IS NULL THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  CASE WHEN p_tipo = 'SALIDA' THEN 'YA_REGISTRADO_SALIDA' ELSE 'YA_REGISTRADO' END,
      'mensaje', CASE WHEN p_tipo = 'SALIDA'
                       THEN 'Tu salida ya fue registrada hoy.'
                       ELSE 'Tu entrada ya fue registrada hoy.' END
    );
  END IF;

  -- ── h) Armar horario del día para incluirlo en la respuesta ──────
  v_dia_semana := CASE EXTRACT(ISODOW FROM v_session.fecha)::int
                    WHEN 1 THEN 'LUNES'
                    WHEN 2 THEN 'MARTES'
                    WHEN 3 THEN 'MIÉRCOLES'
                    WHEN 4 THEN 'JUEVES'
                    WHEN 5 THEN 'VIERNES'
                    WHEN 6 THEN 'SÁBADO'
                    ELSE 'DOMINGO'
                  END;

  v_horario_hoy := horario_docente_hoy(p_cedula_docente, v_dia_semana);

  RETURN json_build_object(
    'ok',            true,
    'tipo',          p_tipo,
    'mensaje',       CASE WHEN p_tipo = 'SALIDA'
                           THEN 'Salida registrada correctamente. ¡Hasta pronto!'
                           ELSE 'Entrada registrada correctamente. ¡Buen día!' END,
    'asistencia_id', v_nuevo_id,
    'dia_semana',    v_dia_semana,
    'horario_hoy',   v_horario_hoy
  );

END;
$$;

COMMENT ON FUNCTION registrar_asistencia IS
  'RPC transaccional para registrar ENTRADA o SALIDA de un docente mediante token QR. '
  'Valida: token, TTL, sesión activa, fecha = hoy Venezuela, unicidad por tipo, '
  'device fingerprint y (para SALIDA) entrada previa. '
  'Devuelve además el horario del docente para el día en curso.';

-- Mantener acceso anónimo para la ruta pública /scan
GRANT EXECUTE ON FUNCTION registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT)
  TO anon;

GRANT EXECUTE ON FUNCTION fecha_hoy_ve()
  TO anon, authenticated;
