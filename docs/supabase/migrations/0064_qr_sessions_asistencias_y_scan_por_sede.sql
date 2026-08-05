-- ============================================================================
-- Migración: 0064_qr_sessions_asistencias_y_scan_por_sede.sql
-- Fecha: 5 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Continúa 0063. Cierra el aislamiento por sede en el módulo de
-- Asistencias QR:
--   1. RLS de `qr_sessions`/`asistencias_diarias` (lectura del staff).
--   2. `crear_qr_session` — resuelve/valida la sede de la sesión nueva y
--      deja de desactivar sesiones de OTRAS sedes por error (antes
--      "desactivar sesión previa del mismo turno/programa" no miraba
--      sede — dos sedes con QR abierto el mismo turno se pisaban).
--   3. `registrar_asistencia` — la asistencia queda anclada a la sede de
--      la sesión QR escaneada; el chequeo "SALIDA requiere ENTRADA
--      previa" pasa a exigir que esa entrada sea de la MISMA sede.
--   4. `horario_docente_hoy` — ahora recibe la sede explícita, porque
--      con catálogos de docentes independientes por sede (0061) la
--      misma cédula puede existir en más de una fila `docentes` (una
--      por sede) y el JOIN por cédula sola dejaría de ser único.
--   5. `buscar_docente_scan` (RPC nueva) — reemplaza los SELECT directos
--      y anónimos que hacía DocenteScan/index.jsx contra `docentes` y
--      `asistencias_diarias` (ya no son legibles por `anon` desde 0063).
--      Resuelve la sede desde el token QR, no desde ningún parámetro que
--      el cliente pueda manipular.
-- ============================================================================


-- ── 1. qr_sessions — SELECT exige sede además del permiso existente ─────────
DROP POLICY IF EXISTS "lee_qr_sessions_por_permiso" ON public.qr_sessions;

CREATE POLICY "lee_qr_sessions_por_permiso"
  ON public.qr_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE  up.id     = auth.uid()
        AND  up.activo = true
    )
    AND (
      tiene_permiso(auth.uid(), 'puedeGestionarQR')
      OR tiene_permiso(auth.uid(), 'puedeVerReporteAsistencias')
    )
    AND usuario_puede_ver_sede(sede_id)
  );

COMMENT ON POLICY "lee_qr_sessions_por_permiso" ON public.qr_sessions IS
  'SEDE-3: agrega usuario_puede_ver_sede(sede_id) al chequeo de permiso '
  'existente (puedeGestionarQR / puedeVerReporteAsistencias) de 0036.';


-- ── 2. asistencias_diarias — mismo criterio ──────────────────────────────────
DROP POLICY IF EXISTS "lee_asistencias_por_permiso" ON public.asistencias_diarias;

CREATE POLICY "lee_asistencias_por_permiso"
  ON public.asistencias_diarias FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE  up.id     = auth.uid()
        AND  up.activo = true
    )
    AND (
      tiene_permiso(auth.uid(), 'puedeGestionarQR')
      OR tiene_permiso(auth.uid(), 'puedeVerReporteAsistencias')
    )
    AND usuario_puede_ver_sede(sede_id)
  );

COMMENT ON POLICY "lee_asistencias_por_permiso" ON public.asistencias_diarias IS
  'SEDE-3: agrega usuario_puede_ver_sede(sede_id) al chequeo de permiso '
  'existente de 0036.';


-- ── 3. crear_qr_session — resolver sede, no pisar sesiones de otra sede ─────
-- FIX (post-error 42725 "function name ... is not unique"): la versión
-- previa de esta función (sin p_sede_id) ya existía en la base con una
-- firma distinta. CREATE OR REPLACE no la reemplaza cuando cambia la
-- lista de parámetros -- crea un segundo overload (mismo problema que ya
-- resolvió explícitamente 0062 con admin_upsert_user_profile vía DROP
-- FUNCTION IF EXISTS). Acá no se conoce con certeza la firma vieja
-- exacta desde este archivo solo, así que en vez de adivinarla se
-- sueltan dinámicamente TODOS los overloads existentes de
-- crear_qr_session antes de crear la versión nueva -- deja exactamente
-- una firma viva, sin importar cuál era la anterior.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'crear_qr_session'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.crear_qr_session(
  p_turno    TEXT,
  p_programa TEXT    DEFAULT NULL,
  p_fecha    DATE    DEFAULT CURRENT_DATE,
  p_ttl_min  INTEGER DEFAULT 5,
  p_sede_id  TEXT    DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoy           DATE := fecha_hoy_ve();
  v_nueva_sesion  qr_sessions%ROWTYPE;
  v_sede_efectiva TEXT;
BEGIN

  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarQR') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SIN_PERMISO',
      'mensaje', 'Sin permiso para gestionar sesiones QR.'
    );
  END IF;

  -- ── SEDE-3: resolver la sede efectiva de esta sesión ─────────────
  -- Prioridad: la sede fija del perfil. Si el rol ve todas las sedes
  -- (sin sede fija en el perfil), exige que el cliente la mande — viene
  -- de SedeContext/sedeActiva (ver AdminQRPanel.jsx / useSedeActiva.js),
  -- nunca de una elección libre sin pasar por el selector de sede.
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();

  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'SIN_SEDE',
        'mensaje', 'Tu usuario no tiene una sede asignada. Contacta a un administrador.'
      );
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'SEDE_REQUERIDA',
        'mensaje', 'Selecciona una sede antes de generar el código QR.'
      );
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  -- ── Validar turno ────────────────────────────────────────────────
  -- FIX (revisión previa a aplicar): este whitelist ya estaba desactualizado
  -- antes del feature de sedes — 'MIXTO' está habilitado en TURNOS_CONFIG
  -- (es justo el turno que se prioriza para PNF Agroalimentación en
  -- AdminQRPanel.jsx) y nunca estuvo en esta lista, mientras que 'NOCTURNO'
  -- sí está pero permanece deshabilitado (habilitado: false) y no se puede
  -- seleccionar desde la UI. Sin este fix, abrir una sesión QR en turno
  -- MIXTO seguiría rechazándose acá con TURNO_INVALIDO.
  IF p_turno NOT IN ('DIURNO','VESPERTINO','MIXTO','NOCTURNO') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TURNO_INVALIDO',
      'mensaje', 'El turno debe ser DIURNO, VESPERTINO, MIXTO o NOCTURNO.'
    );
  END IF;

  -- ── Validar que la fecha sea hoy en Venezuela ────────────────────
  IF p_fecha <> v_hoy THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'FECHA_INVALIDA',
      'mensaje', 'Solo se puede crear una sesión QR para la fecha de hoy ('
                 || to_char(v_hoy, 'DD/MM/YYYY') || ').'
    );
  END IF;

  -- Desactivar sesiones previas activas del mismo contexto — SEDE-3:
  -- ahora incluye sede_id, así dos sedes con el mismo turno/programa
  -- abierto simultáneamente ya no se desactivan entre sí.
  UPDATE qr_sessions
  SET    activa = false
  WHERE  fecha    = p_fecha
    AND  turno    = p_turno
    AND  (programa = p_programa OR (programa IS NULL AND p_programa IS NULL))
    AND  sede_id  = v_sede_efectiva
    AND  activa   = true;

  -- Crear nueva sesión
  INSERT INTO qr_sessions (fecha, turno, programa, creado_por, expires_at, sede_id)
  VALUES (
    p_fecha,
    p_turno,
    p_programa,
    auth.uid(),
    now() + (p_ttl_min || ' minutes')::INTERVAL,
    v_sede_efectiva
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

REVOKE ALL    ON FUNCTION public.crear_qr_session(TEXT, TEXT, DATE, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_qr_session(TEXT, TEXT, DATE, INTEGER, TEXT) TO authenticated;

COMMENT ON FUNCTION public.crear_qr_session(TEXT, TEXT, DATE, INTEGER, TEXT) IS
  'SEDE-3: agrega p_sede_id. Resuelve la sede efectiva desde el perfil del '
  'caller (o desde p_sede_id si el rol ve todas las sedes); la sesión nueva '
  'y la desactivación de sesiones previas del mismo turno/programa quedan '
  'acotadas a esa sede.';


-- ── 4. horario_docente_hoy — exige sede explícita ────────────────────────────
-- Con catálogos independientes (0061), `d.cedula = p_cedula` solo es
-- único DENTRO de una sede — hace falta filtrar también por sede_id o
-- el JOIN puede traer horarios de la fila equivocada si la cédula se
-- repite en más de una sede.
-- FIX (mismo patrón que crear_qr_session más arriba): esta firma también
-- cambia (agrega p_sede_id, obligatorio) respecto a la versión previa —
-- se sueltan los overloads existentes antes de recrearla, en vez de
-- adivinar la firma vieja.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'horario_docente_hoy'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.horario_docente_hoy(
  p_cedula  text,
  p_dia     text,
  p_sede_id text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'materia',  h.clase,
        'sheet',    h.sheet,
        'hora',     h.hora,
        'trayecto', h.trayecto,
        'programa', h.programa,
        'aula',     h.aula
      )
      ORDER BY h.hora
    ),
    '[]'::json
  )
  FROM   horarios h
  JOIN   docentes  d ON d.id    = h.docente_id
  JOIN   trimestres t ON t.lapso = h.lapso AND t.estado = 'activo'
  WHERE  d.cedula  = p_cedula
    AND  d.sede_id = p_sede_id
    AND  h.dia     = p_dia;
$$;

COMMENT ON FUNCTION public.horario_docente_hoy(text, text, text) IS
  'SEDE-3: agrega p_sede_id (obligatorio) para no cruzar horarios de otra '
  'sede cuando la misma cédula existe en más de un catálogo de docentes.';


-- ── 5. registrar_asistencia — sede de la sesión, no de un parámetro ─────────
-- p_sede_id NO se agrega como parámetro de esta RPC a propósito: se lee
-- de `v_session.sede_id` (la sesión ya resuelta por token), igual que ya
-- hace con turno/programa/fecha. Así el cliente anónimo nunca elige la
-- sede — la hereda del QR que escaneó.
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
SET search_path TO 'public'
AS $$
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
  -- FIX (revisión previa a aplicar): la versión que traía este archivo
  -- estaba basada en un snapshot anterior a 0058/0059 — sin
  -- veces_bloqueado/bloqueado_hasta, sin backoff escalonado. Se restaura
  -- tal cual el bloque de 0059 (que ya corrige, además, la condición de
  -- carrera de 0058 con el UPSERT atómico de un solo statement); lo único
  -- que cambia respecto a 0059 es que este bloque no toca sede_id en
  -- absoluto — scan_rate_limit es por device_fingerprint, sin relación
  -- con sede, así que no necesitaba tocarse para SEDE-3/4.
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

  -- ── f) Si es SALIDA, exigir ENTRADA previa el mismo día EN LA MISMA
  --      SEDE ── SEDE-3: antes solo miraba cedula+fecha, sin sede — un
  --      docente podía "heredar" una entrada marcada en otra sede.
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
  INSERT INTO asistencias_diarias (
    cedula_docente, nombre_docente, fecha, turno, programa,
    qr_session_id, device_fingerprint, tipo, sede_id
  )
  VALUES (
    p_cedula_docente, p_nombre_docente, v_session.fecha, v_session.turno,
    v_session.programa, v_session.id, p_device_fingerprint, p_tipo,
    v_session.sede_id
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
$$;

COMMENT ON FUNCTION public.registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT) IS
  'SEDE-3: la fila insertada hereda sede_id de la sesión QR escaneada '
  '(v_session.sede_id), y el chequeo de ENTRADA previa para SALIDA ahora '
  'exige que sea de la misma sede. Rate limiting con backoff progresivo '
  '(Fix ARCH-32) sobre un UPSERT atómico (Fix ARCH-33, ver 0059): máx. 10 '
  'intentos por device_fingerprint en ventana de 60 min disparan un '
  'bloqueo que empieza en 2 minutos y se duplica en cada reincidencia '
  'hasta un techo de 60 min; decae a 0 tras 24h sin bloqueos nuevos. '
  'Resto del comportamiento sin cambios (ver 0039): TTL, device '
  'fingerprint, unicidad por tipo.';

GRANT EXECUTE ON FUNCTION public.registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT)
  TO anon;


-- ── 6. buscar_docente_scan — autocompletado anónimo, sede desde el token ────
-- Reemplaza los dos SELECT directos que hacía DocenteScan/index.jsx
-- contra `docentes` y `asistencias_diarias` (0063 les quitó el SELECT
-- público). anon nunca elige la sede: se resuelve del token QR, igual
-- que ya hace registrar_asistencia. Si el token no existe o no trae
-- sede, se responde "no encontrado" en vez de fallar — es solo una
-- ayuda de autocompletado, no la fuente de verdad del registro.
CREATE OR REPLACE FUNCTION public.buscar_docente_scan(
  p_token  UUID,
  p_cedula TEXT
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sede_id     TEXT;
  v_nombre      TEXT;
  v_fuente      TEXT;
BEGIN
  SELECT sede_id INTO v_sede_id FROM qr_sessions WHERE token = p_token LIMIT 1;

  IF v_sede_id IS NULL THEN
    RETURN json_build_object('encontrado', false);
  END IF;

  -- Fuente 1: catálogo de docentes (nombre canónico, misma sede)
  SELECT nombre_raw INTO v_nombre
  FROM   docentes
  WHERE  cedula = p_cedula AND sede_id = v_sede_id
  LIMIT  1;

  IF v_nombre IS NOT NULL THEN
    RETURN json_build_object('encontrado', true, 'nombre', v_nombre, 'fuente', 'docentes');
  END IF;

  -- Fuente 2: última asistencia registrada por esa cédula en esa sede
  SELECT nombre_docente INTO v_nombre
  FROM   asistencias_diarias
  WHERE  cedula_docente = p_cedula
    AND  sede_id        = v_sede_id
    AND  nombre_docente IS NOT NULL
  ORDER  BY fecha DESC, hora_registro DESC
  LIMIT  1;

  IF v_nombre IS NOT NULL THEN
    RETURN json_build_object('encontrado', true, 'nombre', v_nombre, 'fuente', 'asistencias_diarias');
  END IF;

  RETURN json_build_object('encontrado', false);
END;
$$;

COMMENT ON FUNCTION public.buscar_docente_scan(UUID, TEXT) IS
  'SEDE-3/4. Autocompletado anónimo de nombre por cédula para /scan. '
  'Resuelve la sede desde qr_sessions.token (nunca desde un parámetro '
  'que el cliente anónimo controle). Reemplaza los SELECT directos que '
  'DocenteScan/index.jsx hacía contra docentes/asistencias_diarias antes '
  'de que 0063 les quitara el SELECT público.';

REVOKE ALL    ON FUNCTION public.buscar_docente_scan(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_docente_scan(UUID, TEXT) TO anon, authenticated;


-- ============================================================================
-- PENDIENTE A PROPÓSITO (no es parte de esta migración)
-- ============================================================================
-- - El `ON CONFLICT (cedula_docente, fecha, tipo)` de registrar_asistencia
--   sigue siendo global (no incluye sede_id) — un docente con la misma
--   cédula "activo" en dos sedes el mismo día solo podría marcar un tipo
--   una vez en total, no una vez POR SEDE. Es un caso de borde real pero
--   angosto (persona dando clases en dos sedes el mismo día) que no
--   estaba en el alcance confirmado por el usuario; cambiar esa
--   constraint es una decisión de negocio aparte, no algo para decidir
--   solo en una migración de RLS.
-- - DocenteScan/index.jsx todavía no fue actualizado para llamar a
--   buscar_docente_scan — ver el próximo mensaje del asistente para el
--   cambio de frontend correspondiente.
--
-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Crear una sesión QR desde un usuario con sede fija -> confirmar
--    que la fila en qr_sessions queda con sede_id = la del usuario.
-- 2. Con dos sesiones activas de DISTINTA sede, mismo turno/programa,
--    mismo día: crear una tercera en cualquiera de las dos sedes NO debe
--    desactivar la sesión de la otra sede.
-- 3. Escanear y marcar ENTRADA en la sede A, luego intentar SALIDA con
--    la sesión QR de la sede B el mismo día -> debe rechazar con
--    SIN_ENTRADA_PREVIA (antes de esta migración, hubiera aceptado).
-- 4. SELECT buscar_docente_scan('<token válido>', '<cédula existente
--    en esa sede>') -> {"encontrado": true, ...}.
-- 5. SELECT buscar_docente_scan('<token de otra sede>', '<esa misma
--    cédula>') -> {"encontrado": false} si esa cédula no existe también
--    en la sede del segundo token.
-- ============================================================================
