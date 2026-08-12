-- Migration: 0089_asist4_5_guard_trimestre_borrar_asistencias_rango
-- Fecha: 2026-08-12
--
-- ASIST-4/5 (pedido de LS, 12 ago): el módulo de Asistencias debe abrir
-- por defecto en el trimestre actual, y los trimestres cerrados deben
-- quedar como historial de SOLO LECTURA.
--
-- Auditando ReporteRango.jsx (ASIST-4) se encontró que
-- admin_borrar_asistencias_rango() -- borrado real de asistencias_diarias
-- por rango de fechas, ya restringido a permiso 'puedeBorrarReportes' y a
-- la sede del actor (SEDE-13) -- NO validaba en absoluto que el rango
-- solicitado cayera dentro del trimestre activo. Un admin podía borrar
-- asistencias de cualquier fecha, incluidas las de un trimestre cerrado
-- hace meses -- el mismo tipo de gap que ASIST-2 cerró para Panel QR,
-- pero encontrado aquí en un flujo distinto (borrado por rango, no
-- creación de sesión QR).
--
-- Regla elegida: el rango [p_fecha_desde, p_fecha_hasta] completo debe
-- caer dentro de [fecha_inicio, fecha_fin] del trimestre con
-- estado='activo'. Se rechaza también un borrado que cruce dos
-- trimestres a la vez (más seguro: evita un borrado masivo que mezcle
-- datos vigentes con históricos en una sola llamada). Si no hay ningún
-- trimestre activo, o su fila no trae fechas (ambiente sin `trimestres`
-- poblada), se rechaza el borrado -- fallar cerrado, no abierto, para una
-- operación destructiva.

CREATE OR REPLACE FUNCTION public.admin_borrar_asistencias_rango(p_fecha_desde date, p_fecha_hasta date, p_turno text DEFAULT NULL::text, p_programa text DEFAULT NULL::text, p_sede_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
  v_sede_efectiva TEXT;
  v_trimestre_activo RECORD;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeBorrarReportes') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar reportes de asistencia.';
  END IF;

  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
    RAISE EXCEPTION 'Debes indicar fecha_desde y fecha_hasta.';
  END IF;

  IF p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'fecha_desde no puede ser posterior a fecha_hasta.';
  END IF;

  -- ASIST-5: el rango solicitado debe caer completo dentro del trimestre
  -- activo -- borrar asistencias de un trimestre cerrado (historial) no
  -- está permitido, sin importar el permiso del actor.
  SELECT fecha_inicio, fecha_fin INTO v_trimestre_activo
    FROM trimestres WHERE estado = 'activo' LIMIT 1;

  IF v_trimestre_activo IS NULL OR v_trimestre_activo.fecha_inicio IS NULL OR v_trimestre_activo.fecha_fin IS NULL THEN
    RAISE EXCEPTION 'No hay un trimestre activo configurado -- no se puede borrar asistencias.';
  END IF;

  IF p_fecha_desde < v_trimestre_activo.fecha_inicio OR p_fecha_hasta > v_trimestre_activo.fecha_fin THEN
    RAISE EXCEPTION 'El rango de fechas debe estar dentro del trimestre activo (% a %). Los trimestres cerrados son de solo lectura.',
      v_trimestre_activo.fecha_inicio, v_trimestre_activo.fecha_fin;
  END IF;

  -- SEDE-13: antes borraba en TODAS las sedes que hicieran match con el
  -- rango/turno/programa. Mismo patrón de resolución que borrar_horarios
  -- (0065): sede fija del perfil, o p_sede_id si el rol ve todas las
  -- sedes -- ya no se puede borrar más de una sede en una sola llamada.
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();
  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de borrar reportes de asistencia.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  DELETE FROM public.asistencias_diarias
  WHERE fecha BETWEEN p_fecha_desde AND p_fecha_hasta
    AND (p_turno    IS NULL OR turno    = p_turno)
    AND (p_programa IS NULL OR programa = p_programa)
    AND sede_id = v_sede_efectiva;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_audit_event(
    p_accion            := 'borrar_asistencias_rango',
    p_entidad           := 'asistencias_diarias',
    p_programa_afectado := p_programa,
    p_resumen           := format(
      'Se borraron %s registro(s) de asistencia entre %s y %s (sede %s).',
      v_count, p_fecha_desde, p_fecha_hasta, v_sede_efectiva
    ),
    p_datos_despues     := jsonb_build_object(
      'cantidad',     v_count,
      'fecha_desde',  p_fecha_desde,
      'fecha_hasta',  p_fecha_hasta,
      'turno',        p_turno,
      'programa',     p_programa,
      'sede_id',      v_sede_efectiva
    )
  );

  RETURN v_count;
END;
$function$;
