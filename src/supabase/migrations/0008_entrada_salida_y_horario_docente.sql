-- =====================================================================
-- Migración 0008: Entrada/Salida separadas + horario del día en el
--                  mensaje de confirmación al docente.
--
-- Contexto:
--   El módulo de asistencias (migración 0006) solo registraba UNA marca
--   por docente/día (la "entrada"), por el UNIQUE(cedula_docente, fecha).
--   Esta migración:
--
--   1. Agrega cedula a la tabla docentes (vínculo manual desde el panel
--      de gestión de docentes), necesaria para cruzar la cédula que el
--      docente escribe en /scan con su horario real en `horarios`.
--
--   2. Agrega la columna `tipo` ('ENTRADA' | 'SALIDA') a
--      asistencias_diarias y cambia la restricción de unicidad a
--      (cedula_docente, fecha, tipo), permitiendo hasta dos marcas por
--      día por docente sin perder la idempotencia de cada una.
--
--   3. Crea horario_docente_hoy(cedula, dia), que devuelve las materias,
--      sección y hora que le tocan a ese docente ese día, usando el
--      docente_id real (FK horarios.docente_id -> docentes.id ya
--      existente en producción).
--
--   4. Actualiza registrar_asistencia() para aceptar p_tipo, validar que
--      no se pueda marcar SALIDA sin una ENTRADA previa ese día, e
--      incluir el horario del día en el JSON de respuesta.
--
-- Compatibilidad hacia atrás:
--   p_tipo tiene DEFAULT 'ENTRADA', así que cualquier llamado antiguo
--   sin ese parámetro sigue funcionando exactamente igual que antes.
--   Las filas ya existentes en asistencias_diarias quedan como ENTRADA
--   (DEFAULT de la columna nueva), sin perder histórico.
-- =====================================================================


-- ─────────────────────────────────────────────
-- 1. docentes.cedula
-- ─────────────────────────────────────────────
-- Vínculo manual cédula <-> docente. Se completa desde el panel de
-- gestión de docentes (DocentesView). NULL mientras no se haya
-- vinculado todavía a ese docente.

ALTER TABLE docentes
  ADD COLUMN IF NOT EXISTS cedula TEXT;

-- Único pero permitiendo múltiples NULL (un docente sin vincular aún
-- no debe chocar con otro sin vincular).
CREATE UNIQUE INDEX IF NOT EXISTS uq_docentes_cedula
  ON docentes (cedula)
  WHERE cedula IS NOT NULL;

COMMENT ON COLUMN docentes.cedula IS
  'Cédula del docente (ej: V-12345678), vinculada manualmente desde el panel de gestión. Usada para cruzar el registro de asistencia QR con su horario real.';


-- ─────────────────────────────────────────────
-- 2. asistencias_diarias.tipo + nueva unicidad
-- ─────────────────────────────────────────────

ALTER TABLE asistencias_diarias
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'ENTRADA';

DO $$
BEGIN
  ALTER TABLE asistencias_diarias
    ADD CONSTRAINT chk_asistencia_tipo CHECK (tipo IN ('ENTRADA', 'SALIDA'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- Reemplazar el UNIQUE(cedula_docente, fecha) por uno que incluya tipo,
-- para permitir una fila de ENTRADA y otra de SALIDA el mismo día.
ALTER TABLE asistencias_diarias
  DROP CONSTRAINT IF EXISTS uq_asistencia_docente_dia;

DO $$
BEGIN
  ALTER TABLE asistencias_diarias
    ADD CONSTRAINT uq_asistencia_docente_dia_tipo UNIQUE (cedula_docente, fecha, tipo);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS idx_asistencias_cedula_fecha_tipo
  ON asistencias_diarias (cedula_docente, fecha, tipo);

COMMENT ON COLUMN asistencias_diarias.tipo IS
  'ENTRADA o SALIDA. Un docente puede tener hasta una fila de cada tipo por día (UNIQUE cedula_docente, fecha, tipo).';


-- ─────────────────────────────────────────────
-- 3. RPC: horario_docente_hoy
-- ─────────────────────────────────────────────
-- Devuelve, para un docente identificado por cédula, las clases que le
-- corresponden en un día dado (LUNES..VIERNES), ordenadas por hora.
-- Usa el docente_id real de horarios (FK horarios.docente_id ->
-- docentes.id), no texto parseado, así que es exacto incluso si el
-- nombre_display del docente cambió o tiene homónimos.
--
-- p_dia se recibe en mayúsculas sin tilde-sensitive estricto porque el
-- cliente ya normaliza con DAYS = ["LUNES","MARTES","MIÉRCOLES",
-- "JUEVES","VIERNES"] (con tilde en MIÉRCOLES); se compara tal cual.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION horario_docente_hoy(
  p_cedula TEXT,
  p_dia    TEXT
)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
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
  FROM horarios h
  JOIN docentes d ON d.id = h.docente_id
  WHERE d.cedula = p_cedula
    AND h.dia    = p_dia;
$$;

COMMENT ON FUNCTION horario_docente_hoy IS
  'Devuelve en JSON las clases (materia, sección, hora) que le corresponden a un docente (por cédula) en un día específico, usando horarios.docente_id.';


-- ─────────────────────────────────────────────
-- 4. RPC: registrar_asistencia (reemplaza la de la migración 0006)
-- ─────────────────────────────────────────────
-- IMPORTANTE: la firma cambia de 4 a 5 parámetros (se agrega p_tipo).
-- En Postgres, CREATE OR REPLACE con una firma distinta crea una
-- función SOBRECARGADA nueva en lugar de reemplazar la anterior, lo
-- que dejaría dos versiones de registrar_asistencia conviviendo.
-- Por eso se elimina explícitamente la firma vieja de 4 parámetros
-- antes de crear la nueva de 5.
--
-- Cambios respecto a la versión original:
--   a) Nuevo parámetro p_tipo ('ENTRADA' | 'SALIDA'), DEFAULT 'ENTRADA'
--      para no romper llamadas existentes.
--   b) Si p_tipo = 'SALIDA', exige que exista una fila ENTRADA ese
--      mismo día para esa cédula; si no, devuelve SIN_ENTRADA_PREVIA.
--   c) El ON CONFLICT usa ahora (cedula_docente, fecha, tipo).
--   d) Los códigos YA_REGISTRADO distinguen tipo en el mensaje.
--   e) El JSON de respuesta exitoso incluye horario_hoy con las clases
--      del docente para el día de la sesión QR (v_session.fecha ->
--      día de la semana correspondiente).
-- ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS registrar_asistencia(UUID, TEXT, TEXT, TEXT);

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
BEGIN

  -- ── Validar p_tipo ───────────────────────────────────────────────
  IF p_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TIPO_INVALIDO',
      'mensaje', 'El tipo de registro debe ser ENTRADA o SALIDA.'
    );
  END IF;

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

  -- ── e) Si es SALIDA, exigir ENTRADA previa el mismo día ─────────
  IF p_tipo = 'SALIDA' THEN
    SELECT EXISTS (
      SELECT 1 FROM asistencias_diarias
      WHERE cedula_docente = p_cedula_docente
        AND fecha          = v_session.fecha
        AND tipo            = 'ENTRADA'
    ) INTO v_tiene_entrada;

    IF NOT v_tiene_entrada THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'SIN_ENTRADA_PREVIA',
        'mensaje', 'No se encontró un registro de entrada hoy. Marca tu entrada antes de marcar la salida.'
      );
    END IF;
  END IF;

  -- ── f) Insertar asistencia (o ignorar si ya existe ese tipo) ────
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

  -- ── g) Armar horario del día para incluirlo en la respuesta ─────
  -- EXTRACT(ISODOW) da 1=lunes .. 7=domingo.
  v_dia_semana  := CASE EXTRACT(ISODOW FROM v_session.fecha)::int
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
    'ok',           true,
    'tipo',         p_tipo,
    'mensaje',      CASE WHEN p_tipo = 'SALIDA'
                          THEN 'Salida registrada correctamente. ¡Hasta pronto!'
                          ELSE 'Entrada registrada correctamente. ¡Buen día!' END,
    'asistencia_id', v_nuevo_id,
    'dia_semana',    v_dia_semana,
    'horario_hoy',   v_horario_hoy
  );

END;
$$;

COMMENT ON FUNCTION registrar_asistencia IS
  'RPC transaccional para registrar ENTRADA o SALIDA de un docente mediante token QR. Valida token, TTL, unicidad por tipo, device fingerprint y (para SALIDA) entrada previa. Devuelve además el horario del docente para el día en curso.';

-- Permitir que clientes anónimos sigan ejecutando la RPC con la nueva firma
GRANT EXECUTE ON FUNCTION registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT)
  TO anon;

-- horario_docente_hoy es invocada internamente por registrar_asistencia
-- (SECURITY DEFINER), pero se deja también accesible por si se quiere
-- consultar de forma independiente desde el panel admin en el futuro.
GRANT EXECUTE ON FUNCTION horario_docente_hoy(TEXT, TEXT)
  TO anon, authenticated;
