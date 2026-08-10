-- Migration: 0083_fix_restaurar_backup_on_conflict_sede_id
-- Fecha: 2026-08-10
--
-- Mismo bug que 0082 (registrar_asistencia / registrar_asistencia_manual),
-- encontrado durante la auditoria posterior: el paso 7 de restaurar_backup()
-- reinsertaba asistencias_diarias con ON CONFLICT (cedula_docente, fecha,
-- tipo), que no calza con la unique constraint real
-- uq_asistencia_docente_dia_tipo_sede = UNIQUE(sede_id, cedula_docente,
-- fecha, tipo). Se agrega sede_id al target.
--
-- Ya aplicado en produccion (Supabase project fcrrtpujuncxruwxpckq) el
-- 2026-08-10. Esta migracion sincroniza el repo.

CREATE OR REPLACE FUNCTION public.restaurar_backup(p_docentes jsonb, p_materias jsonb, p_horarios jsonb, p_asistencias jsonb, p_lapso text DEFAULT NULL::text, p_sede_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_h_count       INTEGER := 0;
  v_d_count       INTEGER := 0;
  v_m_count       INTEGER := 0;
  v_a_count       INTEGER := 0;
  v_fila          JSONB;
  v_sede_efectiva TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeRestaurarBackup') THEN
    RAISE EXCEPTION 'No tienes permiso para restaurar backups.';
  END IF;

  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();
  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de restaurar un backup.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  IF p_lapso IS NOT NULL THEN
    DELETE FROM horarios WHERE lapso = p_lapso AND sede_id = v_sede_efectiva;
  ELSE
    DELETE FROM horarios WHERE sede_id = v_sede_efectiva;
  END IF;

  DELETE FROM docentes WHERE sede_id = v_sede_efectiva;
  DELETE FROM materias WHERE sede_id = v_sede_efectiva;

  IF p_lapso IS NOT NULL THEN
    DELETE FROM asistencias_diarias
    WHERE sede_id = v_sede_efectiva
      AND fecha IN (
        SELECT DISTINCT (elem->>'fecha')::date
        FROM jsonb_array_elements(p_asistencias) AS elem
        WHERE elem->>'fecha' IS NOT NULL
      );
  ELSE
    DELETE FROM asistencias_diarias WHERE sede_id = v_sede_efectiva;
  END IF;

  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_docentes)
  LOOP
    INSERT INTO docentes (nombre_raw, nombre_display, sede_id)
    VALUES (v_fila->>'nombre_raw', v_fila->>'nombre_display', v_sede_efectiva)
    ON CONFLICT (sede_id, nombre_raw) DO UPDATE SET nombre_display = EXCLUDED.nombre_display;
    v_d_count := v_d_count + 1;
  END LOOP;

  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_materias)
  LOOP
    INSERT INTO materias (nombre_raw, nombre_display, sede_id)
    VALUES (v_fila->>'nombre_raw', v_fila->>'nombre_display', v_sede_efectiva)
    ON CONFLICT (sede_id, nombre_raw) DO UPDATE SET nombre_display = EXCLUDED.nombre_display;
    v_m_count := v_m_count + 1;
  END LOOP;

  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_horarios)
  LOOP
    INSERT INTO horarios (sheet, programa, trayecto, seccion, turno, sede, aula, dia, hora, clase, lapso, sede_id)
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
      COALESCE(v_fila->>'lapso', p_lapso),
      v_sede_efectiva
    );
    v_h_count := v_h_count + 1;
  END LOOP;

  -- FIX (post-mortem 2026-08-10): mismo bug que registrar_asistencia() y
  -- registrar_asistencia_manual(). Se agrega sede_id al target del
  -- ON CONFLICT para que calce con uq_asistencia_docente_dia_tipo_sede.
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_asistencias)
  LOOP
    INSERT INTO asistencias_diarias (
      cedula_docente, nombre_docente, fecha, turno, programa,
      hora_registro, device_fingerprint, tipo, sede_id
    )
    VALUES (
      v_fila->>'cedula_docente',
      v_fila->>'nombre_docente',
      (v_fila->>'fecha')::date,
      v_fila->>'turno',
      v_fila->>'programa',
      COALESCE((v_fila->>'hora_registro')::timestamptz, now()),
      v_fila->>'device_fingerprint',
      COALESCE(v_fila->>'tipo', 'ENTRADA'),
      v_sede_efectiva
    )
    ON CONFLICT (sede_id, cedula_docente, fecha, tipo) DO NOTHING;
    v_a_count := v_a_count + 1;
  END LOOP;

  RETURN json_build_object(
    'horarios_insertados',    v_h_count,
    'docentes_upserted',      v_d_count,
    'materias_upserted',      v_m_count,
    'asistencias_insertadas', v_a_count
  );
END;
$function$;
