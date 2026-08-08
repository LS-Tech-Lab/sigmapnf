-- ============================================================================
-- Migración: 0072_ux33_docentes_esperados_hoy.sql
-- Fecha: 7 de agosto de 2026
--
-- CONTEXTO
-- --------
-- UX-33 (propuesta C, "Notificaciones en tiempo real más inteligentes"):
-- ContadorSesion (AdminQRPanel.jsx) ya muestra "N entraron / N salieron"
-- en vivo. Falta el denominador: "N de M esperados", donde M es cuántos
-- docentes tienen clase hoy en el turno/programa/sede de la sesión QR
-- activa, según `horarios`.
--
-- DISEÑO
-- ------
-- SECURITY DEFINER (igual que conflictos_horario/docentes_con_cedula/
-- horario_docente_hoy) porque cuenta sobre `horarios`, que RLS ya
-- restringe por sede (0063) -- sin DEFINER, un operador_qr sin acceso de
-- lectura amplio a horarios no podría ni contar. Sigue el MISMO patrón de
-- resolución de sede que 0064/0065/0066/0067 (sede fija del perfil, o
-- p_sede_id si el rol tiene puedeVerTodasLasSedes) -- no se introduce un
-- patrón nuevo.
--
-- No filtra por `lapso`: horario_docente_hoy() (0008, el RPC que ya usa
-- el flujo real de escaneo del docente) tampoco lo hace -- se mantiene la
-- misma convención en vez de inventar un requisito nuevo que obligaría a
-- enhebrar lapsoActivo hasta AdminQRPanel (que hoy no lo recibe).
--
-- p_dia se recibe ya resuelto por el cliente (mismo formato LUNES..
-- VIERNES que usa horarios.dia) en vez de calcularse aquí, porque
-- AdminQRPanel ya conoce la fecha de la sesión (columna `fecha`, que
-- puede no ser HOY -- ver selector de fecha en el panel) y no tiene
-- sentido forzar "hoy" servidor cuando el cliente puede pedir el conteo
-- de un turno de otro día.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.contar_docentes_esperados(
  p_turno    text,
  p_dia      text,
  p_programa text DEFAULT NULL,
  p_sede_id  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sede_efectiva TEXT;
  v_total         INTEGER;
BEGIN
  -- Mismo criterio de resolución de sede que conflictos_horario/
  -- borrar_horarios/restaurar_backup/crear_qr_session/docentes_con_cedula.
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();

  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de contar docentes esperados.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  SELECT COUNT(DISTINCT h.docente_id) INTO v_total
  FROM public.horarios h
  WHERE h.turno     = p_turno
    AND h.dia       = p_dia
    AND h.sede_id   = v_sede_efectiva
    AND h.docente_id IS NOT NULL
    AND (p_programa IS NULL OR h.programa = p_programa);

  RETURN COALESCE(v_total, 0);
END;
$function$;

COMMENT ON FUNCTION public.contar_docentes_esperados(text, text, text, text) IS
  'UX-33: cuenta docentes distintos (por docente_id) con clase en un turno/'
  'día/programa dado, filtrado por sede. Usado por ContadorSesion '
  '(AdminQRPanel.jsx) para mostrar "N de M esperados" durante una sesión QR.';

REVOKE ALL    ON FUNCTION public.contar_docentes_esperados(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contar_docentes_esperados(text, text, text, text) TO authenticated;
