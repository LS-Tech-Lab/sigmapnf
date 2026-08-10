-- ============================================================================
-- Migración: 0084_estad1_reporte_estadisticas_academicas.sql
-- Fecha: 9 de agosto de 2026
--
-- CONTEXTO
-- --------
-- ESTAD-1. Primera funcionalidad de valor del dashboard de estadísticas y
-- analítica académica (§4.2 de RESUMEN_PENDIENTES.md). Alcance decidido:
-- acceso para admin + coordinadores por programa, prioridad en métricas de
-- asistencia (tendencia en el tiempo, % por docente/materia/sede).
--
-- Un solo RPC devuelve las 4 series ya agregadas en el servidor (una fila,
-- 4 columnas jsonb) para evitar 4 idas y vueltas de red por cada cambio de
-- filtro -- mismo criterio de "agregación server-side" que ya se aplicó en
-- reporte_asistencias_rango_agregado (0055/ARCH-27).
--
-- SECURITY INVOKER (no DEFINER): corre con los privilegios de quien llama,
-- así que hereda automáticamente las políticas RLS ya existentes --
-- lee_asistencias_por_permiso (puedeVerReporteAsistencias/puedeGestionarQR
-- + usuario_puede_ver_sede + usuario_puede_ver_programa, 0081) sobre
-- asistencias_diarias, y la RLS de horarios (también por programa desde
-- 0081) para el cruce de materia. No hace falta un permiso nuevo en
-- GRUPOS_PERMISOS: puedeVerReporteAsistencias ya es el gate correcto,
-- misma pantalla que el Reporte de Asistencias. El guard explícito de
-- p_programa (igual que 0080) es solo UX -- da un error claro en vez de
-- filas vacías cuando un rol restringido no manda programa.
--
-- MATERIA INFERIDA (decisión explícita, no un bug pendiente)
-- ------------------------------------------------------------
-- asistencias_diarias no registra la materia dictada (el QR se escanea por
-- docente/turno, no por clase puntual) -- ver docs/FLUJO_ASISTENCIAS_QR.md.
-- Se infiere cruzando cada registro con el horario vigente de ese docente
-- ese día: asistencias_diarias.cedula_docente -> docentes.id -> horarios
-- con el mismo lapso (vía trimestres.fecha_inicio/fecha_fin activo en la
-- fecha exacta de la asistencia, no el trimestre "actual"), turno,
-- programa y día de la semana (derivado de EXTRACT(ISODOW)). Es una
-- aproximación: si el docente tiene 2+ materias asignadas ese mismo
-- turno/programa/día, la asistencia se cuenta una vez por cada una --
-- no hay forma de saber cuál dictó realmente sin pedir la materia en el
-- QR (fuera de alcance de este RPC). Documentado también en el
-- COMMENT ON FUNCTION para que quede visible en \df+ sin tener que leer
-- esta migración.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reporte_estadisticas_academicas(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT,
  p_programa    TEXT DEFAULT NULL,
  p_sede_id     TEXT DEFAULT NULL
)
RETURNS TABLE (
  tendencia   JSONB,
  por_docente JSONB,
  por_materia JSONB,
  por_sede    JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_restringe BOOLEAN;
BEGIN
  SELECT r.restringe_programa INTO v_restringe
  FROM user_profiles up
  JOIN roles r ON r.nombre = up.rol
  WHERE up.id = auth.uid();

  IF v_restringe THEN
    IF p_programa IS NULL THEN
      RAISE EXCEPTION 'Selecciona un programa antes de generar las estadísticas.';
    END IF;
    IF NOT usuario_puede_ver_programa(p_programa) THEN
      RAISE EXCEPTION 'No tienes acceso a ese programa.';
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT a.fecha, a.turno, a.programa, a.sede_id, a.cedula_docente, a.nombre_docente, a.hora_registro
    FROM public.asistencias_diarias a
    WHERE a.fecha BETWEEN p_fecha_desde AND p_fecha_hasta
      AND a.turno = p_turno
      AND (p_programa IS NULL OR a.programa = p_programa)
      AND (p_sede_id  IS NULL OR a.sede_id  = p_sede_id)
  ),
  serie_tendencia AS (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.fecha), '[]'::jsonb) AS j
    FROM (
      SELECT b.fecha,
             count(*)                        AS total_asistencias,
             count(DISTINCT b.cedula_docente) AS docentes_distintos
      FROM base b
      GROUP BY b.fecha
    ) t
  ),
  serie_docente AS (
    SELECT COALESCE(jsonb_agg(d ORDER BY d.dias_asistidos DESC), '[]'::jsonb) AS j
    FROM (
      SELECT b.cedula_docente                                             AS cedula,
             (array_agg(b.nombre_docente ORDER BY b.hora_registro DESC))[1] AS nombre,
             count(DISTINCT b.fecha)                                       AS dias_asistidos
      FROM base b
      GROUP BY b.cedula_docente
    ) d
  ),
  -- Ver nota "MATERIA INFERIDA" arriba: aproximado por diseño.
  materia_inferida AS (
    SELECT DISTINCT b.fecha, b.cedula_docente, h.materia_id
    FROM base b
    JOIN docentes  doc ON doc.cedula = b.cedula_docente
    JOIN trimestres tr ON b.fecha BETWEEN tr.fecha_inicio AND tr.fecha_fin
    JOIN horarios  h   ON h.docente_id = doc.id
                       AND h.lapso     = tr.lapso
                       AND h.turno     = b.turno
                       AND h.programa  = b.programa
                       AND h.dia = CASE EXTRACT(ISODOW FROM b.fecha)
                                     WHEN 1 THEN 'LUNES'
                                     WHEN 2 THEN 'MARTES'
                                     WHEN 3 THEN 'MIÉRCOLES'
                                     WHEN 4 THEN 'JUEVES'
                                     WHEN 5 THEN 'VIERNES'
                                   END
    WHERE h.materia_id IS NOT NULL
  ),
  serie_materia AS (
    SELECT COALESCE(jsonb_agg(m ORDER BY m.dias_asistidos DESC), '[]'::jsonb) AS j
    FROM (
      SELECT mi.materia_id,
             mat.nombre_display                          AS nombre,
             count(DISTINCT (mi.fecha, mi.cedula_docente)) AS dias_asistidos
      FROM materia_inferida mi
      JOIN materias mat ON mat.id = mi.materia_id
      GROUP BY mi.materia_id, mat.nombre_display
    ) m
  ),
  serie_sede AS (
    SELECT COALESCE(jsonb_agg(s ORDER BY s.dias_asistidos DESC), '[]'::jsonb) AS j
    FROM (
      SELECT b.sede_id,
             count(*)                        AS dias_asistidos,
             count(DISTINCT b.cedula_docente) AS docentes_distintos
      FROM base b
      GROUP BY b.sede_id
    ) s
  )
  SELECT serie_tendencia.j, serie_docente.j, serie_materia.j, serie_sede.j
  FROM serie_tendencia, serie_docente, serie_materia, serie_sede;
END;
$$;

COMMENT ON FUNCTION public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT) IS
  'ESTAD-1. SECURITY INVOKER: hereda RLS de asistencias_diarias '
  '(puedeVerReporteAsistencias/puedeGestionarQR + programa/sede, 0081) y de '
  'horarios (programa, 0081) -- no requiere permiso nuevo. Igual que '
  'reporte_asistencias_rango_agregado (0080): si el rol restringe_programa, '
  'p_programa es obligatorio y validado. por_materia se infiere cruzando '
  'asistencias_diarias con el horario vigente del docente ese día (mismo '
  'lapso/turno/programa/día de semana) -- aproximado si el docente dicta '
  '2+ materias en el mismo turno/programa; no hay materia real registrada '
  'en el QR.';

REVOKE ALL    ON FUNCTION public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Como usuario con rol restringido, sin p_programa -- debe rechazar:
--    "Selecciona un programa antes de generar las estadísticas."
-- 2. Mismo usuario, con el programa de OTRO coordinador -- debe rechazar:
--    "No tienes acceso a ese programa."
-- 3. Mismo usuario, con su propio programa -- debe devolver las 4 series.
-- 4. Usuario sin restricción (puedeVerTodo): p_programa = NULL sigue
--    devolviendo el agregado completo.
-- 5. SELECT * FROM reporte_estadisticas_academicas(
--      (CURRENT_DATE - INTERVAL '14 days')::date, CURRENT_DATE, 'DIURNO',
--      NULL, NULL);
--    -- confirmar que tendencia/por_docente/por_sede tienen filas cuando
--    -- hay asistencias en el rango, y que por_materia es '[]' si ningún
--    -- docente con asistencia tiene horario asignado ese día/turno/lapso
--    -- (caso esperado, no un error).
-- ============================================================================
