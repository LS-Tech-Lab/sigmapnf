-- ============================================================
-- Migración: 0032_rpcs_faltantes.sql
--
-- Documenta 4 funciones que existían en Supabase pero no en
-- ningún archivo de migración del repositorio.
-- Detectadas en auditoría técnica (Junio 2026).
--
-- NOTA IMPORTANTE — discrepancia con 0031:
--   El 0031 documenta session_logs con columnas mínimas
--   (user_id, evento, user_agent, detalles). La BD real tiene
--   columnas adicionales: email, nombre, rol, programa, ip.
--   Esta migración usa el schema real de la BD.
--   El 0031 debe corregirse en 0033 para sincronizarse.
--
-- FUNCIONES DOCUMENTADAS (lógica copiada de BD real):
--   1. asegurar_particion_lapso      — crea partición de horarios
--   2. conflictos_horario_detalle    — wrapper de conflictos_horario()
--   3. replace_nombre_en_clases      — renombra en columna clase
--
-- FUNCIÓN CORREGIDA:
--   4. get_session_logs              — reemplaza get_auth_role()
--      (sistema viejo) por tiene_permiso(). Lógica y columnas
--      tomadas de la BD real.
--
-- FUNCIONES HELPER AÚN SIN MIGRACIÓN (pendiente 0033):
--   · public._aplicar_rls_horarios(text)
--   · public.conflictos_horario(text, text)
-- ============================================================

SET search_path TO public;


-- ════════════════════════════════════════════════════════════
-- 1. asegurar_particion_lapso
--    Lógica copiada exactamente de la BD real.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.asegurar_particion_lapso(
  p_lapso TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part_name TEXT;
BEGIN
  IF p_lapso IS NULL THEN
    RETURN;
  END IF;

  v_part_name := 'horarios_lapso_' || REPLACE(p_lapso, '-', '_');

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = v_part_name
      AND relnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.horarios FOR VALUES IN (%L)',
      v_part_name, p_lapso
    );
    PERFORM public._aplicar_rls_horarios(v_part_name);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.asegurar_particion_lapso IS
  'Crea la partición horarios_lapso_<N>_<YYYY> si no existe y aplica '
  'RLS via _aplicar_rls_horarios(). Llamada por useUpload.js antes de '
  'cada INSERT masivo. _aplicar_rls_horarios() pendiente de documentar '
  'en 0033.';

REVOKE ALL    ON FUNCTION public.asegurar_particion_lapso FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asegurar_particion_lapso TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 2. conflictos_horario_detalle
--    Lógica copiada exactamente de la BD real.
--    DROP necesario: firma en BD no tenía DEFAULT en p_lapso.
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.conflictos_horario_detalle(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.conflictos_horario_detalle(
  p_lapso    TEXT DEFAULT NULL,
  p_programa TEXT DEFAULT NULL
)
RETURNS TABLE (
  docente_id     BIGINT,
  docente_nombre TEXT,
  dia            TEXT,
  hora           TEXT,
  horario_a      JSONB,
  horario_b      JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.docente_id,
    c.docente_nombre,
    c.dia,
    c.hora_a AS hora,
    to_jsonb(ha) - 'docente_id' - 'materia_id' - 'clase_raw' AS horario_a,
    to_jsonb(hb) - 'docente_id' - 'materia_id' - 'clase_raw' AS horario_b
  FROM public.conflictos_horario(p_lapso, p_programa) c
  JOIN public.horarios ha ON ha.id = c.horario_a_id
  JOIN public.horarios hb ON hb.id = c.horario_b_id;
$$;

COMMENT ON FUNCTION public.conflictos_horario_detalle IS
  'Wrapper de conflictos_horario() que adjunta los objetos JSONB de cada '
  'clase en conflicto. Usada por useConflictos.js con fallback local. '
  'conflictos_horario() pendiente de documentar en 0033.';

REVOKE ALL    ON FUNCTION public.conflictos_horario_detalle FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conflictos_horario_detalle TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 3. replace_nombre_en_clases
--    Lógica copiada exactamente de la BD real.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.replace_nombre_en_clases(
  old_raw TEXT,
  new_raw TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.horarios
  SET    clase = REPLACE(clase, old_raw, new_raw)
  WHERE  clase LIKE '%' || old_raw || '%';
END;
$$;

COMMENT ON FUNCTION public.replace_nombre_en_clases IS
  'Reemplaza old_raw por new_raw en la columna clase (texto libre) de '
  'horarios. Llamada por nameEditing.js al unificar docentes o materias.';

REVOKE ALL    ON FUNCTION public.replace_nombre_en_clases FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_nombre_en_clases TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 4. get_session_logs  ← CORREGIDA
--
-- PROBLEMA: versión en BD usa get_auth_role() — función del
-- sistema viejo eliminada en 0025. Cada llamada desde LogsView
-- falla con "function get_auth_role() does not exist".
--
-- CORRECCIÓN: reemplaza get_auth_role() por tiene_permiso().
-- Columnas y lógica (UNION ALL, IDs negativos) conservadas
-- exactamente de la BD real.
--
-- DROP necesario: firma puede diferir por cambio en RETURNS.
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_session_logs(INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.get_session_logs(
  p_limit  INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_email  TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id         BIGINT,
  email      TEXT,
  nombre     TEXT,
  rol        TEXT,
  programa   TEXT,
  evento     TEXT,
  ip         TEXT,
  detalles   JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reemplaza get_auth_role() por tiene_permiso() (sistema actual)
  IF NOT tiene_permiso(auth.uid(), 'puedeVerLogs') THEN
    RAISE EXCEPTION 'PERMISO_DENEGADO';
  END IF;

  RETURN QUERY
    -- Sesiones exitosas, logouts, renovaciones, etc.
    SELECT
      sl.id,
      sl.email,
      sl.nombre,
      sl.rol,
      sl.programa,
      sl.evento,
      sl.ip,
      sl.detalles,
      sl.created_at
    FROM public.session_logs sl
    WHERE (p_email IS NULL OR sl.email ILIKE '%' || p_email || '%')

    UNION ALL

    -- Intentos fallidos (login_attempts)
    SELECT
      (la.id * -1)::BIGINT,
      la.email,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      'login_fallido'::TEXT,
      la.ip,
      jsonb_build_object('motivo', la.motivo, 'user_agent', la.user_agent),
      la.created_at
    FROM public.login_attempts la
    WHERE (p_email IS NULL OR la.email ILIKE '%' || p_email || '%')

    ORDER BY created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_session_logs IS
  'Lectura paginada de session_logs + login_attempts para LogsView. '
  'Corregida en 0032: reemplaza get_auth_role() (eliminada en 0025) '
  'por tiene_permiso(). Lógica y columnas conservadas de BD real.';

REVOKE ALL    ON FUNCTION public.get_session_logs FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_logs TO authenticated;


-- ════════════════════════════════════════════════════════════
-- Verificación post-migración
-- ════════════════════════════════════════════════════════════
--
-- 1. Confirmar que get_session_logs ya no usa get_auth_role():
--    SELECT pg_get_functiondef(oid) FROM pg_proc
--    WHERE proname = 'get_session_logs'
--      AND pronamespace = 'public'::regnamespace;
--    → no debe contener 'get_auth_role'
--
-- 2. Smoke test (usuario con puedeVerLogs):
--    SELECT * FROM get_session_logs(10, 0, NULL);
--    → debe retornar filas sin error
--
-- 3. Pendiente en 0033:
--    · Documentar public._aplicar_rls_horarios(text)
--    · Documentar public.conflictos_horario(text, text)
--    · Corregir 0031 para reflejar columnas reales de session_logs
-- ════════════════════════════════════════════════════════════
