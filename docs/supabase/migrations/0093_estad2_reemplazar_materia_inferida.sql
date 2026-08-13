-- ============================================================================
-- 0093 — ESTAD-2: reemplaza "por_materia" (inferida) por dos series nuevas
-- ============================================================================
-- Contexto: "Asistencia por materia (inferida)" (0084) cruzaba
-- asistencias_diarias con horarios/trimestres/docentes para adivinar qué
-- materia dictó el docente ese día -- un JOIN frágil (exige que el horario,
-- el trimestre y el día de semana calcen exacto) que salía vacío seguido y
-- que un usuario real no lograba explicarse ("no entiendo el dato").
--
-- Se reemplaza por dos series que se calculan SOLO con asistencias_diarias,
-- sin ningún JOIN a horarios/trimestres/docentes -- no pueden salir vacías
-- por un desfase de turno/trimestre, y son más fáciles de explicar:
--
--   1. por_dia_semana: total de asistencias y docentes distintos agrupados
--      por día de la semana dentro del rango filtrado -- responde "¿qué
--      días fallan más?".
--   2. por_puntualidad: docentes agrupados en franjas según cuánto tardaron
--      en marcar ENTRADA respecto a la hora de inicio del turno filtrado
--      -- responde "¿quién llega tarde y cuánto?", no solo "quién faltó".
--      La hora de inicio de cada turno replica TURNOS_CONFIG
--      (src/constants/index.js) -- si se agrega un turno nuevo o se cambia
--      su horario ahí, hay que actualizar el CASE de acá también (no hay
--      una tabla de turnos en la BD, es una constante compartida a mano).
-- ============================================================================

DROP FUNCTION IF EXISTS public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.reporte_estadisticas_academicas(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT,
  p_programa    TEXT DEFAULT NULL,
  p_sede_id     TEXT DEFAULT NULL
)
RETURNS TABLE (
  tendencia       JSONB,
  por_docente     JSONB,
  por_dia_semana  JSONB,
  por_puntualidad JSONB,
  por_sede        JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_restringe BOOLEAN;
  -- Inicio de turno en minutos desde medianoche, hora de Venezuela --
  -- replica TURNOS_CONFIG (src/constants/index.js). NULL si p_turno no
  -- matchea ningún turno conocido (defensivo: por_puntualidad sale '[]').
  v_turno_inicio_min INT;
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

  v_turno_inicio_min := CASE p_turno
    WHEN 'DIURNO'     THEN 450   -- 7:30
    WHEN 'VESPERTINO' THEN 780   -- 13:00
    WHEN 'MIXTO'      THEN 420   -- 7:00
    WHEN 'NOCTURNO'   THEN 1080  -- 18:00
    ELSE NULL
  END;

  RETURN QUERY
  WITH base AS (
    SELECT a.fecha, a.turno, a.programa, a.sede_id, a.tipo,
           a.cedula_docente, a.nombre_docente, a.hora_registro
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
  serie_dia_semana AS (
    SELECT COALESCE(jsonb_agg(ds ORDER BY ds.dia_iso), '[]'::jsonb) AS j
    FROM (
      SELECT EXTRACT(ISODOW FROM b.fecha)::INT AS dia_iso,
             CASE EXTRACT(ISODOW FROM b.fecha)
               WHEN 1 THEN 'Lunes' WHEN 2 THEN 'Martes' WHEN 3 THEN 'Miércoles'
               WHEN 4 THEN 'Jueves' WHEN 5 THEN 'Viernes'
               WHEN 6 THEN 'Sábado' WHEN 7 THEN 'Domingo'
             END                                AS dia_nombre,
             count(*)                            AS total_asistencias,
             count(DISTINCT b.cedula_docente)     AS docentes_distintos
      FROM base b
      GROUP BY 1, 2
    ) ds
  ),
  -- Solo ENTRADA -- "puntualidad" no aplica a la marca de salida, y
  -- v_turno_inicio_min NULL (turno desconocido) deja la serie vacía.
  serie_puntualidad AS (
    SELECT COALESCE(jsonb_agg(p ORDER BY p.orden), '[]'::jsonb) AS j
    FROM (
      SELECT franja.orden, franja.etiqueta,
             count(*) AS total_docentes
      FROM (
        SELECT b.cedula_docente,
               (EXTRACT(HOUR   FROM (b.hora_registro AT TIME ZONE 'America/Caracas')) * 60
              + EXTRACT(MINUTE FROM (b.hora_registro AT TIME ZONE 'America/Caracas')))
                - v_turno_inicio_min AS minutos_tarde
        FROM base b
        WHERE b.tipo = 'ENTRADA' AND v_turno_inicio_min IS NOT NULL
      ) e
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN e.minutos_tarde <= 5  THEN 1
          WHEN e.minutos_tarde <= 15 THEN 2
          WHEN e.minutos_tarde <= 30 THEN 3
          ELSE 4
        END AS orden,
        CASE
          WHEN e.minutos_tarde <= 5  THEN 'A tiempo'
          WHEN e.minutos_tarde <= 15 THEN '5–15 min tarde'
          WHEN e.minutos_tarde <= 30 THEN '15–30 min tarde'
          ELSE '+30 min tarde'
        END AS etiqueta
      ) franja
      GROUP BY franja.orden, franja.etiqueta
    ) p
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
  SELECT serie_tendencia.j, serie_docente.j, serie_dia_semana.j, serie_puntualidad.j, serie_sede.j
  FROM serie_tendencia, serie_docente, serie_dia_semana, serie_puntualidad, serie_sede;
END;
$$;

COMMENT ON FUNCTION public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT) IS
  'ESTAD-1/ESTAD-2. SECURITY INVOKER: hereda RLS de asistencias_diarias '
  '(puedeVerReporteAsistencias/puedeGestionarQR + programa/sede, 0081) -- '
  'no requiere permiso nuevo. Igual que reporte_asistencias_rango_agregado '
  '(0080): si el rol restringe_programa, p_programa es obligatorio y '
  'validado. por_dia_semana y por_puntualidad (0089) se calculan solo con '
  'asistencias_diarias, sin JOIN a horarios/trimestres/docentes -- '
  'reemplazan a por_materia (0084, removida), que inferia la materia '
  'cruzando con el horario del dia y salia vacia seguido. '
  'v_turno_inicio_min replica TURNOS_CONFIG del frontend a mano.';

REVOKE ALL    ON FUNCTION public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT * FROM reporte_estadisticas_academicas(
--      (CURRENT_DATE - INTERVAL '14 days')::date, CURRENT_DATE, 'DIURNO',
--      NULL, NULL);
--    -- confirmar 5 columnas (tendencia, por_docente, por_dia_semana,
--    -- por_puntualidad, por_sede), y que por_dia_semana/por_puntualidad
--    -- tienen filas siempre que tendencia las tenga (a diferencia de la
--    -- vieja por_materia, ya no dependen de horarios/trimestres).
-- 2. Confirmar que un p_turno inválido/desconocido deja por_puntualidad
--    en '[]' sin error (v_turno_inicio_min queda NULL).
-- 3. Repetir los 4 chequeos de permisos de la migración 0084 (sin cambios
--    en esa parte de la función).
-- ============================================================================
