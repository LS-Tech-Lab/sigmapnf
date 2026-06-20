-- =====================================================================
-- Migración 0006: Módulo de Control de Asistencias Diarias con QR
--
-- Implementa tres componentes de base de datos:
--
--   1. qr_sessions       — Sesiones QR con token rotativo (TTL 5 min).
--                          Cada vez que el admin inicia una sesión de
--                          registro, se crea un registro aquí. El token
--                          es un UUID único que se incluye en la URL del QR.
--
--   2. asistencias_diarias — Registro definitivo de presencia del docente.
--                          Tiene restricción UNIQUE(cedula_docente, fecha)
--                          para que el mismo docente no pueda marcarse
--                          dos veces en el mismo día.
--
--   3. registrar_asistencia() — RPC atómica que valida el token, el TTL,
--                          el device fingerprint y la unicidad, y luego
--                          hace el INSERT en una sola transacción.
--                          El cliente nunca escribe directamente en las
--                          tablas; todo pasa por esta función.
--
-- Estrategia anti-fraude (foto compartida):
--   • El token expira en 5 minutos (expires_at). Una foto enviada por
--     mensajería llega después de que el token ya cambió.
--   • El device_fingerprint (hash del navegador del docente) queda
--     registrado. Si el mismo dispositivo intenta marcar a más de un
--     docente en la misma sesión, la función lo detecta y rechaza.
--   • La restricción UNIQUE en asistencias_diarias garantiza idempotencia:
--     aunque se reintente, solo se registra una asistencia por docente/día.
-- =====================================================================


-- ─────────────────────────────────────────────
-- 1. TABLA: qr_sessions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Token que viaja en la URL del QR. Se regenera cada vez.
  token           UUID        NOT NULL    DEFAULT gen_random_uuid(),

  -- Metadatos de la sesión
  fecha           DATE        NOT NULL    DEFAULT CURRENT_DATE,
  turno           TEXT        NOT NULL    CHECK (turno IN ('DIURNO','VESPERTINO','NOCTURNO')),
  programa        TEXT,                   -- NULL = válido para todos los programas

  -- Quién creó la sesión (user_profiles.id)
  creado_por      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Ventana de validez. La RPC rechaza tokens fuera de esta ventana.
  created_at      TIMESTAMPTZ NOT NULL    DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL    DEFAULT now() + INTERVAL '5 minutes',

  -- Permite invalidar manualmente sin borrar el registro
  activa          BOOLEAN     NOT NULL    DEFAULT true,

  CONSTRAINT uq_qr_token UNIQUE (token)
);

COMMENT ON TABLE  qr_sessions                IS 'Sesiones QR activas generadas por el administrador para registrar asistencias.';
COMMENT ON COLUMN qr_sessions.token          IS 'UUID único incluido en la URL del código QR. Caduca en expires_at.';
COMMENT ON COLUMN qr_sessions.expires_at     IS 'Momento hasta el que el token es aceptable (por defecto +5 min).';
COMMENT ON COLUMN qr_sessions.activa         IS 'false = sesión invalidada manualmente por el admin antes de expirar.';


-- ─────────────────────────────────────────────
-- 2. TABLA: asistencias_diarias
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asistencias_diarias (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificación del docente (cédula de identidad, ej: "V-12345678")
  cedula_docente      TEXT        NOT NULL,
  nombre_docente      TEXT        NOT NULL,

  -- Cuándo y en qué contexto
  fecha               DATE        NOT NULL    DEFAULT CURRENT_DATE,
  turno               TEXT        NOT NULL,
  programa            TEXT,

  -- Trazabilidad
  hora_registro       TIMESTAMPTZ NOT NULL    DEFAULT now(),
  qr_session_id       UUID        REFERENCES qr_sessions(id) ON DELETE SET NULL,

  -- Hash del navegador/dispositivo (user-agent + screen + idioma + zona).
  -- Permite detectar si el mismo físico intenta registrar a dos docentes.
  device_fingerprint  TEXT,

  -- Un docente solo puede tener UNA asistencia por día.
  -- (si necesitas distinguir por turno, agrega turno a la constraint)
  CONSTRAINT uq_asistencia_docente_dia UNIQUE (cedula_docente, fecha)
);

COMMENT ON TABLE  asistencias_diarias                   IS 'Registro de asistencia diaria de docentes mediante escaneo de QR.';
COMMENT ON COLUMN asistencias_diarias.cedula_docente    IS 'Cédula del docente, ej: V-12345678.';
COMMENT ON COLUMN asistencias_diarias.device_fingerprint IS 'Hash del dispositivo que realizó el escaneo para detectar fraude.';


-- ─────────────────────────────────────────────
-- 3. ÍNDICES DE CONSULTA FRECUENTE
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha
  ON asistencias_diarias (fecha DESC);

CREATE INDEX IF NOT EXISTS idx_asistencias_cedula
  ON asistencias_diarias (cedula_docente);

CREATE INDEX IF NOT EXISTS idx_qr_sessions_token
  ON qr_sessions (token)
  WHERE activa = true;

CREATE INDEX IF NOT EXISTS idx_qr_sessions_fecha
  ON qr_sessions (fecha DESC);


-- ─────────────────────────────────────────────
-- 4. RPC: registrar_asistencia
-- ─────────────────────────────────────────────
-- Función transaccional que:
--   a) Valida que el token existe, está activo y no ha expirado.
--   b) Detecta si el mismo device_fingerprint ya fue usado en esta
--      sesión para registrar a OTRO docente (fraude de foto compartida).
--   c) Inserta la asistencia o devuelve un error descriptivo.
--
-- Retorna JSON con:
--   { ok: true,  mensaje: "...", asistencia_id: "uuid" }
--   { ok: false, codigo: "TOKEN_INVALIDO"|"TOKEN_EXPIRADO"|
--                         "SESION_INACTIVA"|"YA_REGISTRADO"|
--                         "DEVICE_DUPLICADO", mensaje: "..." }
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION registrar_asistencia(
  p_token              UUID,
  p_cedula_docente     TEXT,
  p_nombre_docente     TEXT,
  p_device_fingerprint TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER           -- corre con privilegios del owner, no del invocador
AS $$
DECLARE
  v_session        qr_sessions%ROWTYPE;
  v_device_usado   TEXT;
  v_nuevo_id       UUID;
BEGIN

  -- ── a) Buscar sesión por token ──────────────────────────────────
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

  -- ── b) Verificar que la sesión esté activa ──────────────────────
  IF NOT v_session.activa THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SESION_INACTIVA',
      'mensaje', 'Esta sesión fue cerrada por el administrador.'
    );
  END IF;

  -- ── c) Verificar que el token no haya expirado ──────────────────
  IF now() > v_session.expires_at THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TOKEN_EXPIRADO',
      'mensaje', 'El código QR ha expirado. El administrador debe generar uno nuevo.'
    );
  END IF;

  -- ── d) Detectar device_fingerprint duplicado en OTRA cédula ─────
  --    Si el mismo dispositivo ya registró a alguien más en esta sesión,
  --    rechazamos (posible foto compartida o registro por tercero).
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

  -- ── e) Insertar asistencia (o ignorar si ya existe) ─────────────
  INSERT INTO asistencias_diarias (
    cedula_docente,
    nombre_docente,
    fecha,
    turno,
    programa,
    qr_session_id,
    device_fingerprint
  )
  VALUES (
    p_cedula_docente,
    p_nombre_docente,
    v_session.fecha,
    v_session.turno,
    v_session.programa,
    v_session.id,
    p_device_fingerprint
  )
  ON CONFLICT (cedula_docente, fecha) DO NOTHING
  RETURNING id INTO v_nuevo_id;

  -- Si el INSERT no devolvió id, es porque ya existía (ON CONFLICT DO NOTHING)
  IF v_nuevo_id IS NULL THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'YA_REGISTRADO',
      'mensaje', 'Tu asistencia ya fue registrada hoy.'
    );
  END IF;

  RETURN json_build_object(
    'ok',           true,
    'mensaje',      'Asistencia registrada correctamente. ¡Buen día!',
    'asistencia_id', v_nuevo_id
  );

END;
$$;

COMMENT ON FUNCTION registrar_asistencia IS
  'RPC transaccional para registrar asistencia de un docente mediante token QR.
   Valida token, TTL, unicidad y device fingerprint antes de insertar.';


-- ─────────────────────────────────────────────
-- 5. RPC: crear_qr_session
-- ─────────────────────────────────────────────
-- Llamada por el admin al pulsar "Iniciar sesión QR".
-- Desactiva todas las sesiones anteriores del mismo día/turno/programa
-- antes de crear la nueva, para evitar tokens huérfanos activos.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION crear_qr_session(
  p_turno    TEXT,
  p_programa TEXT    DEFAULT NULL,
  p_fecha    DATE    DEFAULT CURRENT_DATE,
  p_ttl_min  INTEGER DEFAULT 5         -- minutos de vida del token
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_nueva_sesion qr_sessions%ROWTYPE;
BEGIN
  -- Validar turno
  IF p_turno NOT IN ('DIURNO','VESPERTINO','NOCTURNO') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TURNO_INVALIDO',
      'mensaje', 'El turno debe ser DIURNO, VESPERTINO o NOCTURNO.'
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
  'Crea una nueva sesión QR para el admin. Invalida sesiones previas del mismo día/turno/programa.';


-- ─────────────────────────────────────────────
-- 6. RPC: renovar_qr_token
-- ─────────────────────────────────────────────
-- Rota el token de una sesión activa sin crear una nueva sesión.
-- Útil para el auto-refresh cada 5 minutos en la pantalla del admin.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION renovar_qr_token(
  p_session_id UUID,
  p_ttl_min    INTEGER DEFAULT 5
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_nuevo_token UUID := gen_random_uuid();
  v_expires_at  TIMESTAMPTZ := now() + (p_ttl_min || ' minutes')::INTERVAL;
  v_rows        INTEGER;
BEGIN
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

COMMENT ON FUNCTION renovar_qr_token IS
  'Rota el token de una sesión activa y extiende su TTL. Llamada automáticamente cada N minutos.';


-- ─────────────────────────────────────────────
-- 7. SEGURIDAD (Row Level Security)
-- ─────────────────────────────────────────────
-- Las tablas solo son accesibles mediante las RPCs (SECURITY DEFINER).
-- Los clientes no tienen acceso directo a SELECT/INSERT/UPDATE/DELETE.

ALTER TABLE qr_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE asistencias_diarias ENABLE ROW LEVEL SECURITY;

-- Admins autenticados pueden leer qr_sessions (para el panel)
CREATE POLICY "admin_lee_qr_sessions"
  ON qr_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE  up.id  = auth.uid()
        AND  up.rol = 'admin'
        AND  up.activo = true
    )
  );

-- Admins autenticados pueden leer asistencias (para el reporte)
CREATE POLICY "admin_lee_asistencias"
  ON asistencias_diarias FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE  up.id  = auth.uid()
        AND  up.rol = 'admin'
        AND  up.activo = true
    )
  );

-- Nadie inserta/actualiza/borra directamente: solo vía RPC SECURITY DEFINER
-- (No se crean políticas INSERT/UPDATE/DELETE → por defecto denegado con RLS activo)
