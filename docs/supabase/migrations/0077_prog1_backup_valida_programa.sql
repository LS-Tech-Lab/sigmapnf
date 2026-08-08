-- ============================================================================
-- Migración: 0077_prog1_backup_valida_programa.sql
-- Fecha: 8 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Hallazgo durante el mapeo PROG-1 (ver AUDITORIA_INDICE.md): el RPC
-- exportar_backup_completo (0076, PERM-6) ya verifica el permiso
-- puedeHacerBackup server-side, pero el parámetro p_programa lo manda el
-- cliente sin validar (backupActions.js lo llena directo desde el estado
-- `selectedPrograma` de la UI, que es cliente-only). Un usuario restringido
-- a un solo programa (rol con restringe_programa = true, sin puedeVerTodo)
-- podía forzar p_programa a otro valor -- o a NULL/'todos' -- y exportar
-- el backup de un programa que no es el suyo, aunque nunca podría *verlo*
-- en la UI normal. Mismo patrón que ya resolvía v_sede_efectiva para
-- p_sede_id (0076): ahí el perfil manda cuando el usuario está fijo a una
-- sede, y solo se acepta el parámetro del cliente cuando el usuario tiene
-- el permiso de ver todo. p_programa no tenía ese mismo tratamiento.
--
-- FIX
-- ---
-- Se resuelve v_programa_efectivo igual que v_sede_efectiva:
--   - Si el usuario tiene puedeVerTodo, se respeta lo que mande el
--     cliente (p_programa = NULL/'todos' => sin filtro, o un programa
--     puntual si está explorando uno solo).
--   - Si NO tiene puedeVerTodo, se ignora p_programa por completo y se
--     usa user_profiles.programa -- el mismo valor que ya lo restringe en
--     toda la UI (HistorialView, PlanillaQR, ReporteAsistencias). Si ese
--     usuario no tiene programa asignado, se rechaza el backup en vez de
--     dejarlo pasar sin filtro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.exportar_backup_completo(
  p_lapso    text DEFAULT NULL,
  p_programa text DEFAULT NULL,
  p_sede_id  text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sede_efectiva     TEXT;
  v_programa_efectivo TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeHacerBackup') THEN
    RAISE EXCEPTION 'No tienes permiso para exportar un backup.';
  END IF;

  -- Mismo criterio de resolución de sede que conflictos_horario (0067) /
  -- contar_docentes_esperados (0072) / el resto de SEDE-N.
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();

  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de exportar un backup.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  -- PROG-1: mismo tratamiento para programa. Si el usuario NO tiene
  -- puedeVerTodo, p_programa se ignora por completo -- se fuerza al
  -- valor real de su perfil, igual que ya lo restringe en toda la UI.
  IF tiene_permiso(auth.uid(), 'puedeVerTodo') THEN
    v_programa_efectivo := NULLIF(p_programa, 'todos');
  ELSE
    SELECT programa INTO v_programa_efectivo FROM user_profiles WHERE id = auth.uid();
    IF v_programa_efectivo IS NULL THEN
      RAISE EXCEPTION 'Tu usuario no tiene un programa asignado.';
    END IF;
  END IF;

  RETURN json_build_object(
    'horarios', COALESCE((
      SELECT json_agg(row_to_json(h)) FROM public.horarios h
      WHERE h.sede_id = v_sede_efectiva
        AND (p_lapso IS NULL OR h.lapso = p_lapso)
        AND (v_programa_efectivo IS NULL OR h.programa = v_programa_efectivo)
    ), '[]'::json),
    'docentes', COALESCE((
      SELECT json_agg(row_to_json(d)) FROM public.docentes d
      WHERE d.sede_id = v_sede_efectiva
    ), '[]'::json),
    'materias', COALESCE((
      SELECT json_agg(row_to_json(m)) FROM public.materias m
      WHERE m.sede_id = v_sede_efectiva
    ), '[]'::json),
    'asistencias', COALESCE((
      SELECT json_agg(row_to_json(a)) FROM public.asistencias_diarias a
      WHERE a.sede_id = v_sede_efectiva
    ), '[]'::json)
  );
END;
$function$;

COMMENT ON FUNCTION public.exportar_backup_completo(text, text, text) IS
  'PERM-6/PROG-1: reemplaza las 4 consultas directas del cliente en '
  'exportarDatos() (backupActions.js). Verifica puedeHacerBackup '
  'server-side antes de leer nada. p_sede_id y p_programa solo se '
  'respetan cuando el usuario tiene puedeVerTodasLasSedes/puedeVerTodo '
  'respectivamente -- si no, se ignoran y se fuerza el valor real del '
  'perfil (sede_id/programa), para que un usuario restringido no pueda '
  'exportar datos fuera de su alcance mandando otro valor desde el '
  'cliente.';

-- Los GRANT/REVOKE de 0076 siguen vigentes (CREATE OR REPLACE no los toca),
-- pero se repiten explícitos por claridad y para que esta migración sea
-- autocontenida si se revisa fuera de orden.
REVOKE ALL    ON FUNCTION public.exportar_backup_completo(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exportar_backup_completo(text, text, text) TO authenticated;
