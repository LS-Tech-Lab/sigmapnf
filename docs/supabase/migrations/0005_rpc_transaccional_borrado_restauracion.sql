-- =====================================================================
-- Migración 0005: RPCs transaccionales para borrado y restauración
--
-- Mejora 5: clearAllData e importarDatos ejecutaban múltiples llamadas
-- separadas (delete + insert) sin transacción. Si la conexión se cortaba
-- entre el DELETE y el INSERT la BD quedaba vacía sin posibilidad de
-- recuperar los datos.
--
-- Esta migración crea dos funciones que encapsulan cada operación en
-- una única transacción Postgres: o todo tiene éxito, o todo se revierte.
-- =====================================================================

CREATE OR REPLACE FUNCTION borrar_horarios(
  p_lapso    TEXT DEFAULT NULL,
  p_programa TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_lapso IS NOT NULL AND p_programa IS NOT NULL THEN
    DELETE FROM horarios WHERE lapso = p_lapso AND programa = p_programa;
  ELSIF p_lapso IS NOT NULL THEN
    DELETE FROM horarios WHERE lapso = p_lapso;
  ELSIF p_programa IS NOT NULL THEN
    DELETE FROM horarios WHERE programa = p_programa;
  ELSE
    DELETE FROM horarios WHERE id > 0;
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION restaurar_backup(
  p_lapso    TEXT,
  p_horarios JSONB,
  p_docentes JSONB,
  p_materias JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_h_count INTEGER := 0;
  v_d_count INTEGER := 0;
  v_m_count INTEGER := 0;
  v_fila    JSONB;
BEGIN
  -- 1. Borrar horarios del lapso (o todos si p_lapso es NULL)
  IF p_lapso IS NOT NULL THEN
    DELETE FROM horarios WHERE lapso = p_lapso;
  ELSE
    DELETE FROM horarios WHERE id > 0;
  END IF;

  -- 2. Borrar docentes y materias
  DELETE FROM docentes WHERE id > 0;
  DELETE FROM materias WHERE id > 0;

  -- 3. Reinsertar docentes
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_docentes)
  LOOP
    INSERT INTO docentes (nombre_raw, nombre_display)
    VALUES (v_fila->>'nombre_raw', v_fila->>'nombre_display')
    ON CONFLICT (nombre_raw) DO UPDATE SET nombre_display = EXCLUDED.nombre_display;
    v_d_count := v_d_count + 1;
  END LOOP;

  -- 4. Reinsertar materias
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_materias)
  LOOP
    INSERT INTO materias (nombre_raw, nombre_display)
    VALUES (v_fila->>'nombre_raw', v_fila->>'nombre_display')
    ON CONFLICT (nombre_raw) DO UPDATE SET nombre_display = EXCLUDED.nombre_display;
    v_m_count := v_m_count + 1;
  END LOOP;

  -- 5. Reinsertar horarios (sin id original para respetar la secuencia)
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_horarios)
  LOOP
    INSERT INTO horarios (sheet, programa, trayecto, seccion, turno, sede, aula, dia, hora, clase, lapso)
    VALUES (
      v_fila->>'sheet',
      v_fila->>'programa',
      v_fila->>'trayecto',
      v_fila->>'seccion',
      v_fila->>'turno',
      v_fila->>'sede',
      v_fila->>'aula',
      v_fila->>'dia',
      v_fila->>'hora',
      v_fila->>'clase',
      COALESCE(v_fila->>'lapso', p_lapso)
    );
    v_h_count := v_h_count + 1;
  END LOOP;

  RETURN json_build_object(
    'horarios_insertados', v_h_count,
    'docentes_upserted',   v_d_count,
    'materias_upserted',   v_m_count
  );
END;
$$;

REVOKE ALL ON FUNCTION borrar_horarios(TEXT, TEXT)                FROM PUBLIC;
REVOKE ALL ON FUNCTION restaurar_backup(TEXT, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION borrar_horarios(TEXT, TEXT)                TO authenticated;
GRANT EXECUTE ON FUNCTION restaurar_backup(TEXT, JSONB, JSONB, JSONB) TO authenticated;
