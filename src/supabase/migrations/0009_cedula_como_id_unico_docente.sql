-- =====================================================================
-- Migración 0009: Cédula como identificador único del docente
--
-- Problema que resuelve:
--   El flujo actual tiene DOS mundos desconectados:
--     a) asistencias_diarias.cedula_docente — la cédula que escribe el
--        docente al escanear el QR.
--     b) docentes.cedula — la cédula vinculada MANUALMENTE desde el
--        panel de administración (DocentesView).
--
--   Resultado: un docente que ya marcó asistencia sigue apareciendo
--   como "sin vincular" en el panel porque nadie hizo el vínculo manual.
--
-- Principio que se establece:
--   La cédula ES el identificador único del docente en todo el sistema.
--   Cuando un docente escanea el QR y proporciona su cédula por primera
--   vez, eso debe vincularse automáticamente en docentes.cedula.
--   El panel de Docentes debe reflejar eso inmediatamente, sin pasos
--   manuales adicionales.
--
-- Cambios:
--   1. RPC registrar_asistencia(): al registrar con éxito, hace un
--      UPDATE docentes SET cedula = p_cedula_docente WHERE nombre_raw
--      coincide con el nombre que escribió el docente (match por
--      nombre_docente → nombre_raw) si la cédula aún no está vinculada.
--      Si hay ambigüedad de nombre (varios docentes con ese nombre_raw),
--      no vincula automáticamente para evitar errores — el admin lo
--      resuelve manualmente.
--
--   2. Nueva RPC: docentes_con_cedula() — devuelve todos los docentes
--      con su nombre_raw, nombre_display y cedula (incluyendo las que
--      vienen de asistencias_diarias para los que no tienen vínculo
--      en docentes.cedula todavía). Permite que el panel muestre la
--      cédula aunque el vínculo sea "por asistencia" y no "manual".
--
--   3. Índice de búsqueda por nombre_docente en asistencias_diarias
--      para hacer eficiente el cruce nombre→cédula.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Actualizar registrar_asistencia():
--    Tras insertar exitosamente, vincula la cédula en docentes si aún
--    no está vinculada y el nombre del docente coincide sin ambigüedad.
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
  v_docente_count  INT;
  v_cedula_norm    TEXT;
BEGIN

  -- ── Normalizar cédula (mayúsculas, quitar espacios) ────────────────
  v_cedula_norm := UPPER(TRIM(p_cedula_docente));

  -- ── Validar p_tipo ─────────────────────────────────────────────────
  IF p_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TIPO_INVALIDO',
      'mensaje', 'El tipo de registro debe ser ENTRADA o SALIDA.'
    );
  END IF;

  -- ── a) Buscar sesión por token ────────────────────────────────────
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

  -- ── b) Verificar que la sesión esté activa ────────────────────────
  IF NOT v_session.activa THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SESION_INACTIVA',
      'mensaje', 'Esta sesión fue cerrada por el administrador.'
    );
  END IF;

  -- ── c) Verificar que el token no haya expirado ────────────────────
  IF now() > v_session.expires_at THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TOKEN_EXPIRADO',
      'mensaje', 'El código QR ha expirado. El administrador debe generar uno nuevo.'
    );
  END IF;

  -- ── d) Detectar device_fingerprint duplicado en OTRA cédula ───────
  IF p_device_fingerprint IS NOT NULL THEN
    SELECT ad.cedula_docente INTO v_device_usado
    FROM   asistencias_diarias ad
    WHERE  ad.qr_session_id      = v_session.id
      AND  ad.device_fingerprint = p_device_fingerprint
      AND  ad.cedula_docente    <> v_cedula_norm
    LIMIT  1;

    IF FOUND THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'DEVICE_DUPLICADO',
        'mensaje', 'Este dispositivo ya fue utilizado para registrar la asistencia de otro docente en esta sesión.'
      );
    END IF;
  END IF;

  -- ── e) Si es SALIDA, exigir ENTRADA previa el mismo día ──────────
  IF p_tipo = 'SALIDA' THEN
    SELECT EXISTS (
      SELECT 1 FROM asistencias_diarias
      WHERE cedula_docente = v_cedula_norm
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

  -- ── f) Insertar asistencia (o ignorar si ya existe ese tipo) ──────
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
    v_cedula_norm,
    TRIM(p_nombre_docente),
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

  -- ── g) AUTO-VINCULAR cédula en docentes ───────────────────────────
  -- Si el docente que acaba de marcar asistencia aún no tiene su
  -- cédula vinculada en la tabla docentes, se vincula automáticamente.
  -- Condiciones para vincular:
  --   1. La cédula no está ya usada por otro docente (unicidad).
  --   2. Existe exactamente UN docente cuyo nombre_raw coincide con el
  --      nombre que escribió el docente (evita vinculación ambigua).
  --   3. Ese docente aún no tiene cédula (cedula IS NULL).
  --
  -- El match de nombre usa LOWER/TRIM para ser tolerante a mayúsculas.

  -- ¿Ya existe esa cédula vinculada a algún docente?
  PERFORM 1 FROM docentes WHERE cedula = v_cedula_norm LIMIT 1;
  IF NOT FOUND THEN
    -- Buscar docentes cuyo nombre_raw coincide con el nombre escrito
    -- (match exacto case-insensitive y sin espacios extra)
    SELECT COUNT(*) INTO v_docente_count
    FROM docentes
    WHERE LOWER(TRIM(nombre_raw)) = LOWER(TRIM(p_nombre_docente))
      AND cedula IS NULL;

    IF v_docente_count = 1 THEN
      -- Vínculo automático seguro: exactamente un candidato sin cédula
      UPDATE docentes
      SET    cedula = v_cedula_norm
      WHERE  LOWER(TRIM(nombre_raw)) = LOWER(TRIM(p_nombre_docente))
        AND  cedula IS NULL;
    END IF;
    -- Si hay 0 o >1 candidatos, no se vincula automáticamente.
    -- El administrador lo resuelve desde el panel (como antes).
  END IF;

  -- ── h) Armar horario del día para incluirlo en la respuesta ───────
  v_dia_semana := CASE EXTRACT(ISODOW FROM v_session.fecha)::int
                    WHEN 1 THEN 'LUNES'
                    WHEN 2 THEN 'MARTES'
                    WHEN 3 THEN 'MIÉRCOLES'
                    WHEN 4 THEN 'JUEVES'
                    WHEN 5 THEN 'VIERNES'
                    WHEN 6 THEN 'SÁBADO'
                    ELSE 'DOMINGO'
                  END;

  v_horario_hoy := horario_docente_hoy(v_cedula_norm, v_dia_semana);

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
  'RPC transaccional para registrar ENTRADA o SALIDA de un docente mediante token QR.
   Al registrar exitosamente, vincula automáticamente la cédula en docentes.cedula
   si el docente existe por nombre (sin ambigüedad) y aún no tenía cédula vinculada.
   La cédula es el identificador único del docente en todo el sistema.';

-- Permisos para clientes anónimos (docentes en /scan)
GRANT EXECUTE ON FUNCTION registrar_asistencia(UUID, TEXT, TEXT, TEXT, TEXT)
  TO anon;


-- ─────────────────────────────────────────────────────────────────────
-- 2. Retroactivo: vincular cédulas de asistencias ya existentes
--    Para los docentes que YA marcaron asistencia antes de esta
--    migración, intentar vincular su cédula de forma retroactiva.
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
  v_count INT;
BEGIN
  -- Por cada cédula única en asistencias que aún no está en docentes
  FOR r IN
    SELECT DISTINCT
      ad.cedula_docente,
      ad.nombre_docente
    FROM asistencias_diarias ad
    WHERE NOT EXISTS (
      SELECT 1 FROM docentes d WHERE d.cedula = ad.cedula_docente
    )
  LOOP
    -- Contar docentes con ese nombre sin cédula asignada
    SELECT COUNT(*) INTO v_count
    FROM docentes
    WHERE LOWER(TRIM(nombre_raw)) = LOWER(TRIM(r.nombre_docente))
      AND cedula IS NULL;

    IF v_count = 1 THEN
      UPDATE docentes
      SET    cedula = r.cedula_docente
      WHERE  LOWER(TRIM(nombre_raw)) = LOWER(TRIM(r.nombre_docente))
        AND  cedula IS NULL;

      RAISE NOTICE 'Cédula % vinculada retroactivamente a docente "%"',
        r.cedula_docente, r.nombre_docente;
    ELSIF v_count = 0 THEN
      RAISE NOTICE 'Cédula % (nombre: "%") — no se encontró docente con ese nombre en la tabla docentes',
        r.cedula_docente, r.nombre_docente;
    ELSE
      RAISE NOTICE 'Cédula % (nombre: "%") — % candidatos, ambigüedad, requiere vínculo manual',
        r.cedula_docente, r.nombre_docente, v_count;
    END IF;
  END LOOP;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 3. RPC: docentes_con_cedula()
--    Devuelve todos los docentes con nombre_raw, nombre_display y
--    cedula. Para los que tienen cedula en docentes, la usa. Para los
--    que no, cruza con asistencias_diarias para mostrar la cédula con
--    la que marcaron asistencia (aunque el vínculo formal aún no esté).
--    Permite que el panel muestre la información real sin requerir
--    vínculo manual previo.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION docentes_con_cedula()
RETURNS TABLE (
  nombre_raw     TEXT,
  nombre_display TEXT,
  cedula         TEXT,
  cedula_fuente  TEXT   -- 'vinculada' | 'asistencia' | NULL
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    d.nombre_raw,
    d.nombre_display,
    COALESCE(
      d.cedula,
      -- Si no tiene vínculo formal, tomar la cédula más reciente de asistencias
      (
        SELECT ad.cedula_docente
        FROM   asistencias_diarias ad
        WHERE  LOWER(TRIM(ad.nombre_docente)) = LOWER(TRIM(d.nombre_raw))
        ORDER BY ad.hora_registro DESC
        LIMIT  1
      )
    ) AS cedula,
    CASE
      WHEN d.cedula IS NOT NULL THEN 'vinculada'
      WHEN EXISTS (
        SELECT 1 FROM asistencias_diarias ad
        WHERE LOWER(TRIM(ad.nombre_docente)) = LOWER(TRIM(d.nombre_raw))
      ) THEN 'asistencia'
      ELSE NULL
    END AS cedula_fuente
  FROM docentes d
  ORDER BY d.nombre_display;
$$;

COMMENT ON FUNCTION docentes_con_cedula IS
  'Devuelve todos los docentes con su cédula, priorizando la vinculada en docentes.cedula.
   Si no tiene vínculo formal, cruza con asistencias_diarias para mostrar la cédula
   con la que ese docente marcó asistencia. cedula_fuente indica el origen del dato.';

GRANT EXECUTE ON FUNCTION docentes_con_cedula()
  TO authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 4. Índice para acelerar el cruce nombre_docente → docentes.nombre_raw
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_asistencias_nombre_docente
  ON asistencias_diarias (LOWER(nombre_docente));

CREATE INDEX IF NOT EXISTS idx_docentes_nombre_raw_lower
  ON docentes (LOWER(nombre_raw));
