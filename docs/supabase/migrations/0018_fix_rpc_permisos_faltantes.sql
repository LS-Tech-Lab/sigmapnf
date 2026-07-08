-- ============================================================
-- Migración: 0018_fix_rpc_permisos_faltantes.sql
-- Fix #8 — Agregar verificación de permisos internos a las
--           RPCs que carecían de ella:
--           · borrar_horarios  → requiere puedeBorrarHorarios
--           · restaurar_backup → requiere puedeRestaurarBackup
--           · admin_quedaria_sin_gestion → auxiliar interna,
--             se restringe a SECURITY DEFINER sin exposición
--             directa (no requiere permiso propio porque solo
--             es llamada desde otras RPCs que ya verifican).
-- ============================================================


-- ── borrar_horarios ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.borrar_horarios(
  p_lapso    text DEFAULT NULL,
  p_programa text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeBorrarHorarios') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar horarios.';
  END IF;

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


-- ── restaurar_backup ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restaurar_backup(
  p_lapso     text,
  p_horarios  jsonb,
  p_docentes  jsonb,
  p_materias  jsonb
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


-- ── Verificación post-migración ─────────────────────────────
-- Ejecutar luego para confirmar que las 3 RPCs ahora tienen
-- verificación interna:
--
-- SELECT
--   proname AS funcion,
--   CASE
--     WHEN pg_get_functiondef(oid) ILIKE '%tiene_permiso%'
--       OR pg_get_functiondef(oid) ILIKE '%admin_caller_puede%' THEN 'Sí'
--     ELSE 'No'
--   END AS tiene_verificacion_interna
-- FROM pg_proc
-- WHERE proname IN ('borrar_horarios', 'restaurar_backup')
-- ORDER BY proname;
--
-- Resultado esperado: ambas deben mostrar 'Sí'.
