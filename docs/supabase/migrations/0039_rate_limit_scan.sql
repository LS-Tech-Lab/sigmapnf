-- =============================================================================
-- Migración 0039 — D-3: Rate limiting en registrar_asistencia()
--
-- La ruta pública /scan no tenía límite de intentos por dispositivo,
-- lo que permitía flood de asistencias falsas con diferentes cédulas.
--
-- Estrategia: tabla scan_rate_limit que registra intentos por
-- device_fingerprint. La RPC registrar_asistencia() consulta esta tabla
-- y rechaza si supera MAX_INTENTOS en la ventana de tiempo VENTANA_MIN.
--
-- Límite: 10 intentos por device_fingerprint por hora.
-- Los intentos exitosos también cuentan (para evitar enumeración de cédulas).
-- La tabla se limpia automáticamente de registros viejos en cada llamada
-- (mantenimiento inline, sin cron adicional).
-- =============================================================================


-- ── 1. Tabla de rate limiting ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scan_rate_limit (
  device_fingerprint  TEXT        NOT NULL,
  intentos            INTEGER     NOT NULL DEFAULT 1,
  ventana_inicio      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_fingerprint)
);

COMMENT ON TABLE public.scan_rate_limit IS
  'Rate limiting para registrar_asistencia(). '
  'Un registro por device_fingerprint con contador de intentos en la ventana activa.';

-- Acceso solo via SECURITY DEFINER desde registrar_asistencia
ALTER TABLE public.scan_rate_limit ENABLE ROW LEVEL SECURITY;

-- Nadie accede directamente: sin políticas = todo denegado
-- (las RPCs SECURITY DEFINER corren con privilegios del owner)


-- ── 2. registrar_asistencia() con rate limiting ───────────────────────────────
-- Idéntica a la versión de 0013 excepto por el bloque de rate limiting
-- añadido al inicio, antes de cualquier otra validación.

CREATE OR REPLACE FUNCTION public.registrar_asistencia(
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

  -- Rate limiting
  MAX_INTENTOS     CONSTANT INTEGER     := 10;
  VENTANA_MIN      CONSTANT INTEGER     := 60; -- minutos
  v_intentos_act   INTEGER;
  v_ventana_inicio TIMESTAMPTZ;
BEGIN

  -- ── RATE LIMITING ────────────────────────────────────────────────────────
  -- Solo aplica si viene un device_fingerprint (siempre en producción).
  -- Limpiar registros de ventanas vencidas de paso (mantenimiento inline).
  IF p_device_fingerprint IS NOT NULL THEN

    -- Limpiar ventanas vencidas (oportunista, no bloquea si falla)
    DELETE FROM public.scan_rate_limit
    WHERE ventana_inicio < now() - (VENTANA_MIN || ' minutes')::INTERVAL;

    -- Leer o insertar registro para este fingerprint
    INSERT INTO public.scan_rate_limit (device_fingerprint, intentos, ventana_inicio)
    VALUES (p_device_fingerprint, 1, now())
    ON CONFLICT (device_fingerprint) DO UPDATE
      SET intentos = CASE
            -- Si la ventana expiró, reiniciar contador
            WHEN scan_rate_limit.ventana_inicio < now() - (VENTANA_MIN || ' minutes')::INTERVAL
            THEN 1
            -- Si sigue activa, incrementar
            ELSE scan_rate_limit.intentos + 1
          END,
          ventana_inicio = CASE
            WHEN scan_rate_limit.ventana_inicio < now() - (VENTANA_MIN || ' minutes')::INTERVAL
            THEN now()
            ELSE scan_rate_limit.ventana_inicio
          END
    RETURNING intentos, ventana_inicio INTO v_intentos_act, v_ventana_inicio;

    IF v_intentos_act > MAX_INTENTOS THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'RATE_LIMIT',
        'mensaje', 'Demasiados intentos desde este dispositivo. Intenta de nuevo en una hora.'
      );
    END IF;
  END IF;

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

  -- ── d) Verificar que la sesión es de HOY en Venezuela ────────────
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
    cedula_docente, nombre_docente, fecha, turno, programa,
    qr_session_id, device_fingerprint, tipo
  )
  VALUES (
    p_cedula_docente, p_nombre_docente, v_session.fecha, v_session.turno,
    v_session.programa, v_session.id, p_device_fingerprint, p_tipo
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

  -- ── h) Armar horario del día ──────────────────────────────────────
  v_dia_semana := CASE EXTRACT(ISODOW FROM v_session.fecha)::int
                    WHEN 1 THEN 'LUNES'   WHEN 2 THEN 'MARTES'
                    WHEN 3 THEN 'MIÉRCOLES' WHEN 4 THEN 'JUEVES'
                    WHEN 5 THEN 'VIERNES' WHEN 6 THEN 'SÁBADO'
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

COMMENT ON FUNCTION public.registrar_asistencia IS
  'RPC transaccional para registrar ENTRADA o SALIDA de un docente mediante token QR. '
  'Rate limiting: máx. 10 intentos por device_fingerprint por hora (tabla scan_rate_limit). '
  'Valida: token, TTL, sesión activa, fecha = hoy Venezuela, unicidad por tipo, '
  'device fingerprint y (para SALIDA) entrada previa. '
  'Devuelve además el horario del docente para el día en curso.';

-- Mantener acceso anónimo para la ruta pública /scan
GRANT EXECUTE ON FUNCTION public.registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT)
  TO anon;
