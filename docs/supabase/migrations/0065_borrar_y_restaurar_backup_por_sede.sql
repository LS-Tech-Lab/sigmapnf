-- ============================================================================
-- Migración: 0065_borrar_y_restaurar_backup_por_sede.sql
-- Fecha: 5 de agosto de 2026
--
-- CONTEXTO — POR QUÉ ESTA MIGRACIÓN ES CRÍTICA
-- ---------------------------------------------------------------------------
-- `borrar_horarios` y `restaurar_backup` son SECURITY DEFINER: corren con
-- privilegios del dueño de la función, no con los del usuario que las
-- invoca, así que NINGUNA política RLS (ni las de 0063/0064) las alcanza.
-- Hasta esta migración, ambas hacían DELETE/INSERT directo sobre
-- `horarios`/`docentes`/`materias`/`asistencias_diarias` sin ningún
-- filtro de sede:
--
--   - `borrar_horarios(NULL, NULL)` → `DELETE FROM horarios WHERE id > 0`
--     (TODAS las sedes).
--   - `restaurar_backup(...)` → `DELETE FROM docentes WHERE id > 0` y
--     `DELETE FROM materias WHERE id > 0` (sin excepción, SIEMPRE todas
--     las sedes), más horarios/asistencias con el mismo problema cuando
--     p_lapso es NULL.
--
-- Con una sola sede en producción esto nunca se notó. En cuanto exista
-- una segunda sede, cualquier "Borrar datos" o "Restaurar backup" hecho
-- por un operador de una sede borraría (y en el caso del backup,
-- reemplazaría parcialmente) el catálogo de TODAS las demás sedes. Esta
-- migración cierra ese hueco antes de que pueda causar pérdida de datos
-- real — se aplica junto con el resto de SEDE-3/4/5, no es opcional.
--
-- Mismo patrón de resolución de sede que crear_qr_session (0064): sede
-- fija del perfil, o p_sede_id explícito si el rol tiene
-- puedeVerTodasLasSedes.
-- ============================================================================


-- ── 1. borrar_horarios — acotado a la sede del actor ─────────────────────────
-- FIX (post-error 42725, mismo patrón que 0064): esta firma cambia
-- respecto a la versión previa (agrega p_sede_id). CREATE OR REPLACE no
-- reemplaza una función cuando cambia la lista de parámetros -- crea un
-- segundo overload y cualquier referencia sin lista de argumentos
-- (como el COMMENT ON FUNCTION de más abajo) queda ambigua. Se sueltan
-- dinámicamente todos los overloads existentes en vez de adivinar la
-- firma vieja.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'borrar_horarios'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.borrar_horarios(
  p_lapso    text DEFAULT NULL,
  p_programa text DEFAULT NULL,
  p_sede_id  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted       INTEGER;
  v_sede_efectiva TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeBorrarHorarios') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar horarios.';
  END IF;

  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();
  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de borrar horarios.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  IF p_lapso IS NOT NULL AND p_programa IS NOT NULL THEN
    DELETE FROM horarios WHERE lapso = p_lapso AND programa = p_programa AND sede_id = v_sede_efectiva;
  ELSIF p_lapso IS NOT NULL THEN
    DELETE FROM horarios WHERE lapso = p_lapso AND sede_id = v_sede_efectiva;
  ELSIF p_programa IS NOT NULL THEN
    DELETE FROM horarios WHERE programa = p_programa AND sede_id = v_sede_efectiva;
  ELSE
    DELETE FROM horarios WHERE sede_id = v_sede_efectiva;
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL    ON FUNCTION public.borrar_horarios(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.borrar_horarios(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.borrar_horarios(text, text, text) IS
  'SEDE-5: agrega p_sede_id. Cada DELETE queda acotado a sede_id = la '
  'sede efectiva del actor — antes borraba horarios de TODAS las sedes '
  'cuando p_lapso/p_programa venían NULL (SECURITY DEFINER, sin RLS).';


-- ── 2. restaurar_backup — acotado a la sede del actor ────────────────────────
-- FIX (mismo patrón que borrar_horarios más arriba): su firma también
-- cambia (agrega p_sede_id) -- se sueltan los overloads existentes antes
-- de recrearla.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'restaurar_backup'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.restaurar_backup(
  p_lapso        text,
  p_horarios     jsonb,
  p_docentes     jsonb,
  p_materias     jsonb,
  p_asistencias  jsonb DEFAULT '[]'::jsonb,
  p_sede_id      text  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- ── SEDE-5: resolver la sede efectiva, mismo criterio que
  -- crear_qr_session/borrar_horarios ────────────────────────────────
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

  -- 1. Borrar horarios del lapso (o todos) — SOLO de esta sede.
  IF p_lapso IS NOT NULL THEN
    DELETE FROM horarios WHERE lapso = p_lapso AND sede_id = v_sede_efectiva;
  ELSE
    DELETE FROM horarios WHERE sede_id = v_sede_efectiva;
  END IF;

  -- 2. Borrar docentes y materias — SOLO de esta sede. Antes de esta
  --    migración esto era `DELETE FROM docentes WHERE id > 0` sin
  --    ninguna condición: borraba el catálogo de TODAS las sedes.
  DELETE FROM docentes WHERE sede_id = v_sede_efectiva;
  DELETE FROM materias WHERE sede_id = v_sede_efectiva;

  -- 3. Borrar asistencias_diarias — SOLO de esta sede (además del
  --    filtro por fecha que ya existía cuando hay lapso).
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

  -- 4. Reinsertar docentes — con sede_id, onConflict compuesto (0061).
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_docentes)
  LOOP
    INSERT INTO docentes (nombre_raw, nombre_display, sede_id)
    VALUES (v_fila->>'nombre_raw', v_fila->>'nombre_display', v_sede_efectiva)
    ON CONFLICT (sede_id, nombre_raw) DO UPDATE SET nombre_display = EXCLUDED.nombre_display;
    v_d_count := v_d_count + 1;
  END LOOP;

  -- 5. Reinsertar materias — igual que docentes.
  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_materias)
  LOOP
    INSERT INTO materias (nombre_raw, nombre_display, sede_id)
    VALUES (v_fila->>'nombre_raw', v_fila->>'nombre_display', v_sede_efectiva)
    ON CONFLICT (sede_id, nombre_raw) DO UPDATE SET nombre_display = EXCLUDED.nombre_display;
    v_m_count := v_m_count + 1;
  END LOOP;

  -- 6. Reinsertar horarios — con sede_id.
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

  -- 7. Reinsertar asistencias_diarias — con sede_id.
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

REVOKE ALL    ON FUNCTION public.restaurar_backup(text, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restaurar_backup(text, jsonb, jsonb, jsonb, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.restaurar_backup(text, jsonb, jsonb, jsonb, jsonb, text) IS
  'SEDE-5: agrega p_sede_id. TODO el borrado/reinserción (horarios, '
  'docentes, materias, asistencias_diarias) queda acotado a la sede '
  'efectiva del actor. Antes de esta migración, "DELETE FROM docentes '
  'WHERE id > 0" y "DELETE FROM materias WHERE id > 0" no tenían NINGÚN '
  'filtro — restaurar un backup de una sede borraba el catálogo completo '
  'de todas las demás.';


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Con datos de prueba en dos sedes distintas: restaurar un backup en
--    la sede A y confirmar que los docentes/materias/horarios de la
--    sede B siguen intactos (antes de esta migración, desaparecían).
-- 2. borrar_horarios() sin p_lapso/p_programa desde un usuario de la
--    sede A -> solo deben desaparecer horarios de la sede A.
-- 3. Un usuario con puedeVerTodasLasSedes pero sin sede fija, llamando
--    restaurar_backup sin mandar p_sede_id -> debe rechazar pidiendo
--    que seleccione una sede.
-- ============================================================================
