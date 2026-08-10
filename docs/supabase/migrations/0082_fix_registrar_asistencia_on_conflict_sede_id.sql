-- Migration: 0082_fix_registrar_asistencia_on_conflict_sede_id
-- Fecha: 2026-08-10
--
-- Contexto (post-mortem):
-- Al agregar sede_id a la unique constraint de asistencias_diarias
-- (epica SEDE-N -> uq_asistencia_docente_dia_tipo_sede =
-- UNIQUE(sede_id, cedula_docente, fecha, tipo)), no se actualizo el
-- ON CONFLICT de registrar_asistencia(), que seguia apuntando solo a
-- (cedula_docente, fecha, tipo). Postgres exige que el target de
-- ON CONFLICT calce EXACTAMENTE con un indice/constraint unico
-- existente; al faltar sede_id no habia ninguno que calzara, y
-- CUALQUIER intento de registrar asistencia (entrada o salida)
-- fallaba con:
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- Fix: agregar sede_id al target del ON CONFLICT.
--
-- Nota: este fix ya fue aplicado directamente en produccion via SQL
-- (Supabase project fcrrtpujuncxruwxpckq) el 2026-08-10. Esta
-- migracion documenta el cambio en el repo para mantener el historial
-- de migraciones sincronizado con la base de datos real.

CREATE OR REPLACE FUNCTION public.registrar_asistencia(p_token uuid, p_cedula_docente text, p_nombre_docente text, p_device_fingerprint text DEFAULT NULL::text, p_tipo text DEFAULT 'ENTRADA'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session         qr_sessions%ROWTYPE;
  v_device_usado    TEXT;
  v_nuevo_id        UUID;
  v_tiene_entrada   BOOLEAN;
  v_dia_semana      TEXT;
  v_horario_hoy     JSON;
  v_hoy             DATE := fecha_hoy_ve();

  -- Rate limiting (backoff progresivo, Fix ARCH-32 + Fix ARCH-33 — ver 0059)
  MAX_INTENTOS      CONSTANT INTEGER     := 10;
  VENTANA_MIN       CONSTANT INTEGER     := 60; -- minutos, ventana de conteo
  TECHO_BLOQUEO_MIN CONSTANT INTEGER     := 60; -- minutos, tope del backoff
  v_intentos_act    INTEGER;
  v_bloqueado_hasta TIMESTAMPTZ;
  v_veces_bloqueado INTEGER;
  v_min_restantes   INTEGER;
BEGIN

  -- ── RATE LIMITING (backoff progresivo, Fix ARCH-32 + Fix ARCH-33) ───────
  IF p_device_fingerprint IS NOT NULL THEN

    DELETE FROM public.scan_rate_limit
    WHERE ventana_inicio < now() - interval '24 hours'
      AND (bloqueado_hasta IS NULL OR bloqueado_hasta < now() - interval '24 hours');

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
            WHEN srl.bloqueado_hasta IS NOT NULL AND now() < srl.bloqueado_hasta
              THEN srl.veces_bloqueado
            WHEN srl.bloqueado_hasta IS NOT NULL
                 AND srl.bloqueado_hasta < now() - interval '24 hours'
              THEN 0
            ELSE srl.veces_bloqueado
          END
    RETURNING intentos, veces_bloqueado, bloqueado_hasta
      INTO v_intentos_act, v_veces_bloqueado, v_bloqueado_hasta;

    IF v_bloqueado_hasta IS NOT NULL AND now() < v_bloqueado_hasta THEN
      v_min_restantes := CEIL(EXTRACT(EPOCH FROM (v_bloqueado_hasta - now())) / 60);
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'RATE_LIMIT',
        'mensaje', 'Demasiados intentos desde este dispositivo. Intenta de nuevo en '
                   || GREATEST(v_min_restantes, 1) || ' minuto(s).'
      );
    END IF;

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

  -- ── f) Si es SALIDA, exigir ENTRADA previa el mismo día EN LA MISMA
  --      SEDE ── SEDE-3
  IF p_tipo = 'SALIDA' THEN
    SELECT EXISTS (
      SELECT 1 FROM asistencias_diarias
      WHERE cedula_docente = p_cedula_docente
        AND fecha          = v_session.fecha
        AND sede_id        = v_session.sede_id
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
  -- SEDE-3: sede_id se hereda de la sesión escaneada, nunca de un
  -- parámetro que el cliente anónimo pudiera mandar.
  -- FIX (post-mortem 2026-08-10): el ON CONFLICT solo listaba
  -- (cedula_docente, fecha, tipo), pero la unique constraint real de la
  -- tabla es uq_asistencia_docente_dia_tipo_sede = UNIQUE(sede_id,
  -- cedula_docente, fecha, tipo) desde la épica SEDE-N. Postgres exige
  -- que el target de ON CONFLICT calce exactamente con un índice/constraint
  -- único existente; al faltar sede_id no había ninguno que calzara, y
  -- CUALQUIER intento de registrar asistencia fallaba con
  -- "there is no unique or exclusion constraint matching the ON CONFLICT
  -- specification". Se agrega sede_id al target para que vuelva a calzar.
  INSERT INTO asistencias_diarias (
    cedula_docente, nombre_docente, fecha, turno, programa,
    qr_session_id, device_fingerprint, tipo, sede_id
  )
  VALUES (
    p_cedula_docente, p_nombre_docente, v_session.fecha, v_session.turno,
    v_session.programa, v_session.id, p_device_fingerprint, p_tipo,
    v_session.sede_id
  )
  ON CONFLICT (sede_id, cedula_docente, fecha, tipo) DO NOTHING
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

  v_horario_hoy := horario_docente_hoy(p_cedula_docente, v_dia_semana, v_session.sede_id);

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
$function$;
