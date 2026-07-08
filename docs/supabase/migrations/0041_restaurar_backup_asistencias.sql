-- ============================================================
-- Migración: 0041_restaurar_backup_asistencias.sql
-- Gap #16 — importarDatos no procesaba la tabla asistencias
--           al restaurar un backup, perdiéndolas silenciosamente.
--
-- Cambios:
--   · Extiende restaurar_backup con p_asistencias JSONB (default
--     '[]' para retrocompatibilidad con backups versión < 2.0 que
--     no incluyan la clave).
--   · Borra las asistencias_diarias del lapso antes de reinsertar
--     (respeta el scope: si p_lapso es NULL borra todas).
--   · Reinserta con ON CONFLICT DO NOTHING (idempotente por la
--     constraint uq_asistencia_docente_dia_tipo).
--   · Devuelve asistencias_insertadas en el JSON de retorno.
-- ============================================================

CREATE OR REPLACE FUNCTION public.restaurar_backup(
  p_lapso        text,
  p_horarios     jsonb,
  p_docentes     jsonb,
  p_materias     jsonb,
  p_asistencias  jsonb DEFAULT '[]'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_h_count INTEGER := 0;
  v_d_count INTEGER := 0;
  v_m_count INTEGER := 0;
  v_a_count INTEGER := 0;
  v_fila    JSONB;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeRestaurarBackup') THEN
    RAISE EXCEPTION 'No tienes permiso para restaurar backups.';
  END IF;

  -- 1. Borrar horarios del lapso (o todos si p_lapso es NULL)
  IF p_lapso IS NOT NULL THEN
    DELETE FROM horarios WHERE lapso = p_lapso;
  ELSE
    DELETE FROM horarios WHERE id > 0;
  END IF;

  -- 2. Borrar docentes y materias
  DELETE FROM docentes WHERE id > 0;
  DELETE FROM materias WHERE id > 0;

  -- 3. Borrar asistencias_diarias del lapso
  --    (filtramos por fecha del backup cuando hay lapso; sin lapso borramos todo)
  IF p_lapso IS NOT NULL THEN
    -- Eliminar solo las asistencias cuya fecha esté representada en el backup
    DELETE FROM asistencias_diarias
    WHERE fecha IN (
      SELECT DISTINCT (elem->>'fecha')::date
      FROM jsonb_array_elements(p_asistencias) AS elem
      WHERE elem->>'fecha' IS NOT NULL
    );
  ELSE
    DELETE FROM asistencias_diarias WHERE id IS NOT NULL;
  END IF;

  -- 4. Reinsertar docentes
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_docentes)
  LOOP
    INSERT INTO docentes (nombre_raw, nombre_display)
    VALUES (v_fila->>'nombre_raw', v_fila->>'nombre_display')
    ON CONFLICT (nombre_raw) DO UPDATE SET nombre_display = EXCLUDED.nombre_display;
    v_d_count := v_d_count + 1;
  END LOOP;

  -- 5. Reinsertar materias
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_materias)
  LOOP
    INSERT INTO materias (nombre_raw, nombre_display)
    VALUES (v_fila->>'nombre_raw', v_fila->>'nombre_display')
    ON CONFLICT (nombre_raw) DO UPDATE SET nombre_display = EXCLUDED.nombre_display;
    v_m_count := v_m_count + 1;
  END LOOP;

  -- 6. Reinsertar horarios (sin id original para respetar la secuencia)
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

  -- 7. Reinsertar asistencias_diarias (sin id, sin qr_session_id — FK externa)
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_asistencias)
  LOOP
    INSERT INTO asistencias_diarias (
      cedula_docente,
      nombre_docente,
      fecha,
      turno,
      programa,
      hora_registro,
      device_fingerprint,
      tipo
    )
    VALUES (
      v_fila->>'cedula_docente',
      v_fila->>'nombre_docente',
      (v_fila->>'fecha')::date,
      v_fila->>'turno',
      v_fila->>'programa',
      COALESCE((v_fila->>'hora_registro')::timestamptz, now()),
      v_fila->>'device_fingerprint',
      COALESCE(v_fila->>'tipo', 'ENTRADA')
    )
    ON CONFLICT (cedula_docente, fecha, tipo) DO NOTHING;
    v_a_count := v_a_count + 1;
  END LOOP;

  RETURN json_build_object(
    'horarios_insertados',    v_h_count,
    'docentes_upserted',      v_d_count,
    'materias_upserted',      v_m_count,
    'asistencias_insertadas', v_a_count
  );
END;
$$;

-- Permisos: la firma cambió (nuevo parámetro con DEFAULT), pero PostgreSQL
-- mantiene los GRANT existentes sobre la función por nombre; re-declaramos
-- para asegurar coherencia.
REVOKE ALL ON FUNCTION public.restaurar_backup(TEXT, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restaurar_backup(TEXT, JSONB, JSONB, JSONB, JSONB) TO authenticated;
