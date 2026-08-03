-- =============================================================================
-- Migración 0059 — ARCH-33: condición de carrera real en registrar_asistencia()
--
-- HALLAZGO (auditoría de estrés operacional, verificado empíricamente contra
-- Postgres real, no solo lectura de código — ver docs/AUDITORIA_INDICE.md):
--
-- La migración 0058 (ARCH-32, backoff progresivo) reemplazó el patrón atómico
-- de 0039 (`INSERT ... ON CONFLICT DO UPDATE`, una sola sentencia) por
-- `SELECT ... FOR UPDATE` seguido de un `INSERT` simple cuando no existía fila
-- previa. Esa secuencia tiene una ventana NO atómica entre el SELECT y el
-- INSERT: dos llamadas concurrentes a registrar_asistencia() con el MISMO
-- device_fingerprint que todavía no tiene fila en scan_rate_limit (primer
-- escaneo de un dispositivo) ejecutan ambas el SELECT, ambas lo encuentran
-- vacío, y ambas intentan el INSERT — la segunda choca contra la PRIMARY KEY
-- (device_fingerprint) y la función completa levanta una excepción no
-- controlada en vez de devolver el JSON esperado.
--
-- Reproducido localmente (Postgres 16, dos sesiones psql concurrentes reales,
-- mismo device_fingerprint sin fila previa):
--
--   ERROR:  duplicate key value violates unique constraint "scan_rate_limit_pkey"
--   DETAIL:  Key (device_fingerprint)=(fp-concurrencia) already exists.
--
-- Esto no es un caso de laboratorio: ocurre con cualquier doble-tap del
-- usuario, doble envío del cliente por reintento de red, o dos dispositivos
-- distintos detrás del mismo NAT que comparten fingerprint y escanean casi
-- al mismo tiempo — exactamente el escenario de "concurrencia masiva"
-- (cierre de periodo, muchos docentes escaneando a la vez).
--
-- FIX
-- ---
-- Volver al patrón atómico de 0039 (una sola sentencia `INSERT ... ON
-- CONFLICT DO UPDATE`, sin SELECT previo ni ventana entre lectura y
-- escritura), pero conservando toda la lógica de backoff progresivo de 0058
-- (veces_bloqueado, bloqueado_hasta, decaimiento a 24h). El disparo del
-- bloqueo (escritura de bloqueado_hasta cuando se supera el límite) se hace
-- en una SEGUNDA sentencia, pero esa sí es segura bajo concurrencia porque
-- ya opera sobre una fila que EXISTE garantizado (el UPSERT anterior la
-- creó o la actualizó) — un UPDATE por clave primaria sobre una fila
-- existente serializa vía el lock de fila normal de Postgres, nunca choca
-- por PK duplicada.
-- =============================================================================


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
  MAX_INTENTOS      CONSTANT INTEGER     := 10;
  VENTANA_MIN       CONSTANT INTEGER     := 60; -- minutos, ventana de conteo
  TECHO_BLOQUEO_MIN CONSTANT INTEGER     := 60; -- minutos, tope del backoff
  v_intentos_act    INTEGER;
  v_bloqueado_hasta TIMESTAMPTZ;
  v_veces_bloqueado INTEGER;
  v_min_restantes   INTEGER;
BEGIN

  -- ── RATE LIMITING (backoff progresivo, Fix ARCH-32 + Fix ARCH-33) ───────
  -- Solo aplica si viene un device_fingerprint (siempre en producción).
  IF p_device_fingerprint IS NOT NULL THEN

    -- Limpiar filas verdaderamente inactivas (sin intentos recientes ni
    -- bloqueo vigente hace más de 24h) — mantenimiento inline, sin cron.
    DELETE FROM public.scan_rate_limit
    WHERE ventana_inicio < now() - interval '24 hours'
      AND (bloqueado_hasta IS NULL OR bloqueado_hasta < now() - interval '24 hours');

    -- ── PASO 1: UPSERT atómico (Fix ARCH-33) ────────────────────────────
    -- Una sola sentencia, sin SELECT previo: si la fila no existe, la crea
    -- con intentos=1. Si existe y sigue bloqueada, no toca nada (deja que
    -- el propio castigo expire solo). Si existe, no está bloqueada y la
    -- ventana de conteo venció, reinicia el contador. Si existe, no está
    -- bloqueada y la ventana sigue activa, incrementa.
    INSERT INTO public.scan_rate_limit AS srl
      (device_fingerprint, intentos, ventana_inicio, veces_bloqueado, bloqueado_hasta)
    VALUES
      (p_device_fingerprint, 1, now(), 0, NULL)
    ON CONFLICT (device_fingerprint) DO UPDATE
      SET intentos = CASE
            WHEN srl.bloqueado_hasta IS NOT NULL AND now() < srl.bloqueado_hasta
              THEN srl.intentos
            WHEN srl.ventana_inicio < now() - (VENTANA_MIN || ' minutes')::INTERVAL
              THEN 1
            ELSE srl.intentos + 1
          END,
          ventana_inicio = CASE
            WHEN srl.bloqueado_hasta IS NOT NULL AND now() < srl.bloqueado_hasta
              THEN srl.ventana_inicio
            WHEN srl.ventana_inicio < now() - (VENTANA_MIN || ' minutes')::INTERVAL
              THEN now()
            ELSE srl.ventana_inicio
          END,
          veces_bloqueado = CASE
            -- Reincidencia (bloqueo previo expiró hace menos de 24h): no
            -- decae, se conserva para que el próximo bloqueo escale.
            WHEN srl.bloqueado_hasta IS NOT NULL AND now() < srl.bloqueado_hasta
              THEN srl.veces_bloqueado
            WHEN srl.bloqueado_hasta IS NOT NULL
                 AND srl.bloqueado_hasta < now() - interval '24 hours'
              THEN 0
            ELSE srl.veces_bloqueado
          END
    RETURNING intentos, veces_bloqueado, bloqueado_hasta
      INTO v_intentos_act, v_veces_bloqueado, v_bloqueado_hasta;

    -- a) Dispositivo con bloqueo vigente (el UPSERT de arriba no tocó nada,
    --    solo devolvió el estado actual): rechazar sin haber incrementado.
    IF v_bloqueado_hasta IS NOT NULL AND now() < v_bloqueado_hasta THEN
      v_min_restantes := CEIL(EXTRACT(EPOCH FROM (v_bloqueado_hasta - now())) / 60);
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'RATE_LIMIT',
        'mensaje', 'Demasiados intentos desde este dispositivo. Intenta de nuevo en '
                   || GREATEST(v_min_restantes, 1) || ' minuto(s).'
      );
    END IF;

    -- b) Si con este intento se supera el límite, disparar el bloqueo.
    --    PASO 2: esta sentencia opera sobre una fila que YA EXISTE
    --    garantizado (la creó o actualizó el UPSERT de arriba), así que un
    --    UPDATE por PRIMARY KEY aquí serializa vía lock de fila normal de
    --    Postgres — no puede chocar por clave duplicada como el INSERT
    --    suelto que tenía 0058.
    IF v_intentos_act > MAX_INTENTOS THEN
      UPDATE public.scan_rate_limit
      SET veces_bloqueado = veces_bloqueado + 1,
          bloqueado_hasta = now() + (LEAST(TECHO_BLOQUEO_MIN, POWER(2, veces_bloqueado + 1))::text || ' minutes')::INTERVAL
      WHERE device_fingerprint = p_device_fingerprint
      RETURNING bloqueado_hasta INTO v_bloqueado_hasta;

      v_min_restantes := CEIL(EXTRACT(EPOCH FROM (v_bloqueado_hasta - now())) / 60);
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'RATE_LIMIT',
        'mensaje', 'Demasiados intentos desde este dispositivo. Intenta de nuevo en '
                   || GREATEST(v_min_restantes, 1) || ' minuto(s).'
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
  'Rate limiting con backoff progresivo (Fix ARCH-32) sobre un UPSERT atómico '
  '(Fix ARCH-33: elimina la condición de carrera SELECT+INSERT que 0058 '
  'introdujo entre dos llamadas concurrentes del mismo device_fingerprint sin '
  'fila previa): máx. 10 intentos por device_fingerprint en ventana de 60 min '
  'disparan un bloqueo que empieza en 2 minutos y se duplica en cada '
  'reincidencia hasta un techo de 60 min; decae a 0 tras 24h sin bloqueos '
  'nuevos (tabla scan_rate_limit). '
  'Valida: token, TTL, sesión activa, fecha = hoy Venezuela, unicidad por tipo, '
  'device fingerprint y (para SALIDA) entrada previa. '
  'Devuelve además el horario del docente para el día en curso.';

-- Mantener acceso anónimo para la ruta pública /scan
GRANT EXECUTE ON FUNCTION public.registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT)
  TO anon;
