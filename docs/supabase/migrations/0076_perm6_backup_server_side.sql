-- ============================================================================
-- Migración: 0076_perm6_backup_server_side.sql
-- Fecha: 8 de agosto de 2026
--
-- CONTEXTO
-- --------
-- PERM-6 (propuesta D de una revisión externa, ver AUDITORIA_INDICE.md):
-- `puedeHacerBackup` solo gatea el botón en `AdminMenu.jsx`. La función
-- real, `exportarDatos()` (backupActions.js), hacía 4 consultas directas
-- del cliente (horarios/docentes/materias/asistencias_diarias) sin pasar
-- por ningún RPC -- el único freno real era RLS, que restringe por SEDE
-- pero nunca comprobó el permiso `puedeHacerBackup` en sí. Cualquier
-- usuario autenticado con lectura normal a esas 4 tablas (p. ej. un
-- operador QR sin permiso de backup) podía ejecutar las mismas 4
-- consultas desde la consola del navegador y descargarse el mismo
-- dataset, sin tener el permiso.
--
-- DISEÑO
-- ------
-- Un solo RPC SECURITY DEFINER que:
--   1. Verifica tiene_permiso(auth.uid(), 'puedeHacerBackup') -- si no lo
--      tiene, ni siquiera llega a tocar las tablas.
--   2. Resuelve la sede exactamente igual que el resto de SEDE-N (sede
--      fija del perfil, o p_sede_id si el rol tiene puedeVerTodasLasSedes).
--   3. Como SECURITY DEFINER bypasea RLS por completo, hay que repetir
--      el filtro por sede A MANO en cada una de las 4 sub-consultas --
--      antes esto lo hacía RLS de forma implícita (0063/0064), ahora hay
--      que hacerlo explícito acá o se abriría una fuga cross-sede peor
--      que el problema que se está cerrando.
--
-- No se creó un RPC separado por tabla (4 RPCs) para no multiplicar
-- puntos donde alguien podría llamar solo 1 de las 4 y armar un backup
-- parcial sin darse cuenta -- un solo RPC devuelve las 4 juntas o falla
-- entero, igual que el `Promise.all` que reemplaza en el cliente.
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
  v_sede_efectiva TEXT;
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

  RETURN json_build_object(
    'horarios', COALESCE((
      SELECT json_agg(row_to_json(h)) FROM public.horarios h
      WHERE h.sede_id = v_sede_efectiva
        AND (p_lapso IS NULL OR h.lapso = p_lapso)
        AND (p_programa IS NULL OR p_programa = 'todos' OR h.programa = p_programa)
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
  'PERM-6: reemplaza las 4 consultas directas del cliente en exportarDatos() '
  '(backupActions.js). Verifica puedeHacerBackup server-side antes de leer '
  'nada -- antes, ese permiso solo gateaba el botón en la UI y cualquier '
  'usuario con lectura normal a horarios/docentes/materias/asistencias_'
  'diarias podía exportar el mismo dataset sin tenerlo.';

-- SEC-34 ya corrigió la regla de privilegios por defecto que otorgaba
-- EXECUTE a anon en toda función nueva -- este REVOKE/GRANT explícito es
-- defensa en profundidad, no una dependencia de esa corrección.
REVOKE ALL    ON FUNCTION public.exportar_backup_completo(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exportar_backup_completo(text, text, text) TO authenticated;
