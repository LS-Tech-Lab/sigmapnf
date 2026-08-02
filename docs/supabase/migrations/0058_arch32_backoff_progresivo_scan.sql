-- =============================================================================
-- Migración 0058 — ARCH-32: backoff progresivo en registrar_asistencia()
--
-- El límite de `scan_rate_limit` (migración 0039, SEC-13) era un contador
-- fijo: 10 intentos por device_fingerprint en una ventana de 60 minutos, y
-- al superarlo el dispositivo quedaba bloqueado la hora completa sin
-- distinción entre "un dispositivo real con mala señal que reintentó de
-- más" y "un dispositivo intentando flood/enumeración". Ambos casos
-- recibían el mismo castigo de 60 minutos.
--
-- FIX
-- ---
-- Se agregan 2 columnas (`veces_bloqueado`, `bloqueado_hasta`) a la misma
-- tabla — no se crea tabla nueva, mismo patrón de mantenimiento inline que
-- ya tenía 0039. La PRIMERA vez que un dispositivo supera el límite recibe
-- un bloqueo corto (2 minutos); si vuelve a superarlo después de que ese
-- bloqueo corto expira, el bloqueo se duplica (4, 8, 16... hasta un techo
-- de 60 minutos, el mismo límite que existía antes para todos los casos).
-- `veces_bloqueado` decae a 0 solo tras 24h sin ningún bloqueo nuevo — así
-- un dispositivo que tuvo un pico aislado un día no arrastra penalización
-- al día siguiente, pero uno que insiste en el mismo período sí escala.
--
-- El conteo de intentos dentro de la ventana de 60 min (para decidir CUÁNDO
-- se dispara el bloqueo) no cambia — sigue contando éxitos y fallos por
-- igual, a propósito (comentario original de 0039: evita enumeración de
-- cédulas). Lo que cambia es la DURACIÓN del bloqueo una vez disparado.
--
-- Nota de verificación (mismo patrón que SEC-9/SEC-17): esta migración no
-- se pudo probar contra una instancia Supabase real desde este entorno (sin
-- acceso a la BD de producción). Antes de dar ARCH-32 por cerrado, correr
-- manualmente el escenario de la sección 4 de abajo contra staging/producción
-- y confirmar los tiempos de bloqueo reales, no solo la lectura del código.
-- =============================================================================


-- ── 1. Columnas nuevas ────────────────────────────────────────────────────

ALTER TABLE public.scan_rate_limit
  ADD COLUMN IF NOT EXISTS veces_bloqueado INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMPTZ;

COMMENT ON COLUMN public.scan_rate_limit.veces_bloqueado IS
  'Cantidad de veces que este device_fingerprint superó el límite de '
  'intentos. Determina la duración del próximo bloqueo (2^n minutos, '
  'techo 60). Decae a 0 si el último bloqueo expiró hace más de 24h.';

COMMENT ON COLUMN public.scan_rate_limit.bloqueado_hasta IS
  'Si no es NULL y aún no pasó, registrar_asistencia() rechaza con '
  'RATE_LIMIT sin tocar el contador de intentos — evita que un '
  'dispositivo ya bloqueado siga incrementando su propio castigo por '
  'seguir reintentando mientras espera.';


-- ── 2. registrar_asistencia() con backoff progresivo ──────────────────────
-- Idéntica a la versión de 0039 excepto por el bloque de rate limiting.

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
  v_fila            public.scan_rate_limit%ROWTYPE;
  v_intentos_act    INTEGER;
  v_min_restantes   INTEGER;
BEGIN

  -- ── RATE LIMITING (backoff progresivo, Fix ARCH-32) ─────────────────────
  -- Solo aplica si viene un device_fingerprint (siempre en producción).
  IF p_device_fingerprint IS NOT NULL THEN

    -- Limpiar filas verdaderamente inactivas (sin intentos recientes ni
    -- bloqueo vigente hace más de 24h) — mantenimiento inline, sin cron.
    DELETE FROM public.scan_rate_limit
    WHERE ventana_inicio < now() - interval '24 hours'
      AND (bloqueado_hasta IS NULL OR bloqueado_hasta < now() - interval '24 hours');

    SELECT * INTO v_fila
    FROM public.scan_rate_limit
    WHERE device_fingerprint = p_device_fingerprint
    FOR UPDATE;

    -- a) Dispositivo con bloqueo vigente: rechazar SIN incrementar nada,
    --    para no alargar el propio castigo solo por seguir consultando.
    IF FOUND AND v_fila.bloqueado_hasta IS NOT NULL AND now() < v_fila.bloqueado_hasta THEN
      v_min_restantes := CEIL(EXTRACT(EPOCH FROM (v_fila.bloqueado_hasta - now())) / 60);
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'RATE_LIMIT',
        'mensaje', 'Demasiados intentos desde este dispositivo. Intenta de nuevo en '
                   || GREATEST(v_min_restantes, 1) || ' minuto(s).'
      );
    END IF;

    -- b) Sin fila previa: crear con contador en 1.
    IF NOT FOUND THEN
      INSERT INTO public.scan_rate_limit (device_fingerprint, intentos, ventana_inicio)
      VALUES (p_device_fingerprint, 1, now());
      v_intentos_act := 1;

    -- c) Con fila previa y ventana de conteo vencida: reiniciar contador.
    --    `veces_bloqueado` decae a 0 solo si el último bloqueo expiró hace
    --    más de 24h — un pico aislado no debe arrastrar penalización al
    --    día siguiente, pero reincidencia en el mismo período sí escala.
    ELSIF v_fila.ventana_inicio < now() - (VENTANA_MIN || ' minutes')::INTERVAL THEN
      UPDATE public.scan_rate_limit
      SET intentos         = 1,
          ventana_inicio   = now(),
          veces_bloqueado  = CASE
                                WHEN bloqueado_hasta IS NOT NULL
                                     AND bloqueado_hasta < now() - interval '24 hours'
                                THEN 0
                                ELSE veces_bloqueado
                              END
      WHERE device_fingerprint = p_device_fingerprint
      RETURNING intentos INTO v_intentos_act;

    -- d) Ventana activa: incrementar contador.
    ELSE
      UPDATE public.scan_rate_limit
      SET intentos = intentos + 1
      WHERE device_fingerprint = p_device_fingerprint
      RETURNING intentos INTO v_intentos_act;
    END IF;

    -- e) Si con este intento se supera el límite, disparar el bloqueo:
    --    2^(veces_bloqueado+1) minutos, con techo de 60 — la primera vez
    --    son 2 minutos, no la hora completa; solo la reincidencia escala
    --    hasta el mismo tope que existía antes para todos los casos.
    IF v_intentos_act > MAX_INTENTOS THEN
      UPDATE public.scan_rate_limit
      SET veces_bloqueado = veces_bloqueado + 1,
          bloqueado_hasta = now() + (LEAST(TECHO_BLOQUEO_MIN, POWER(2, veces_bloqueado + 1))::text || ' minutes')::INTERVAL
      WHERE device_fingerprint = p_device_fingerprint
      RETURNING bloqueado_hasta INTO v_fila.bloqueado_hasta;

      v_min_restantes := CEIL(EXTRACT(EPOCH FROM (v_fila.bloqueado_hasta - now())) / 60);
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
  'Rate limiting con backoff progresivo (Fix ARCH-32): máx. 10 intentos por '
  'device_fingerprint en ventana de 60 min disparan un bloqueo que empieza en '
  '2 minutos y se duplica en cada reincidencia hasta un techo de 60 min; decae '
  'a 0 tras 24h sin bloqueos nuevos (tabla scan_rate_limit). '
  'Valida: token, TTL, sesión activa, fecha = hoy Venezuela, unicidad por tipo, '
  'device fingerprint y (para SALIDA) entrada previa. '
  'Devuelve además el horario del docente para el día en curso.';

-- Mantener acceso anónimo para la ruta pública /scan
GRANT EXECUTE ON FUNCTION public.registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT)
  TO anon;


-- ── 3. Backfill de filas existentes ────────────────────────────────────────
-- Las filas que ya existían en scan_rate_limit antes de esta migración
-- quedan con veces_bloqueado=0 / bloqueado_hasta=NULL por el DEFAULT del
-- ALTER TABLE — comportamiento correcto: nadie arranca "pre-bloqueado" por
-- una migración que no existía cuando se generó su historial.


-- ── 4. Verificación manual post-despliegue (no ejecutar como parte de la
--       migración — dejar como referencia) ────────────────────────────────
-- Simular 11 llamadas seguidas a registrar_asistencia() con el mismo
-- device_fingerprint (token inválido está bien, el rate limit corre antes
-- de validar el token) y confirmar:
--   1) Las primeras 10 devuelven un código distinto de RATE_LIMIT.
--   2) La 11ª devuelve RATE_LIMIT con "Intenta de nuevo en 2 minuto(s)"
--      (no "en una hora").
--   3) SELECT veces_bloqueado, bloqueado_hasta FROM scan_rate_limit
--      WHERE device_fingerprint = '<el usado en la prueba>';
--      -- veces_bloqueado debe ser 1, bloqueado_hasta ~ now() + 2 min.
--   4) Repetir el mismo flujo de 11 llamadas una vez que el bloqueo de
--      2 minutos expiró: la 11ª esta vez debe anunciar 4 minutos, y
--      veces_bloqueado debe leerse 2.
