-- ============================================================================
-- Migración: 0097_turno_todos_reporte_rango_y_estadisticas.sql
-- Fecha: 14 de agosto de 2026
--
-- CONTEXTO (pedido por LS)
-- --------
-- El Reporte Diario (ReporteAsistencias/index.jsx) ya tenía "Todos los
-- turnos" en su select desde hace tiempo (sentinel "TODOS", ver
-- TURNOS_FILTRO en helpers.js) -- ahí es un filtro puramente de cliente,
-- porque esa vista consulta `asistencias_diarias` directo y simplemente
-- omite el `.eq("turno", ...)` cuando turno === "TODOS".
--
-- Pero "Reporte por Rango" (ReporteRango.jsx) y "Estadísticas"
-- (EstadisticasAcademicas/index.jsx) NUNCA tuvieron esa opción en su
-- select -- ambos delegan la agregación al servidor vía RPC
-- (reporte_asistencias_rango_agregado / reporte_estadisticas_academicas),
-- y ambas funciones exigían `a.turno = p_turno` con match exacto: no había
-- forma de pedir "todos los turnos" aunque el frontend quisiera, porque el
-- servidor no lo soportaba.
--
-- FIX
-- ---
-- Se agrega el frontend en los dos selects (mismo TURNOS_FILTRO/sentinel
-- "TODOS" que ya usa el Reporte Diario, sin duplicar la lista) y aquí se
-- habilita el soporte real en el servidor: p_turno ahora acepta NULL como
-- "sin filtro", exactamente el mismo patrón que ya existe para p_programa
-- en ambas funciones (`p_programa IS NULL OR a.programa = p_programa`).
-- El frontend traduce el sentinel "TODOS" a NULL antes de llamar al RPC.
--
-- reporte_estadisticas_academicas: con p_turno NULL, v_turno_inicio_min
-- ya caía en NULL de forma natural (el CASE no matchea ningún WHEN), así
-- que por_puntualidad sale '[]' sin cambios -- comportamiento ya previsto
-- en el comentario original de 0093 ("NULL si p_turno no matchea ningún
-- turno conocido"), simplemente antes era inalcanzable desde la UI porque
-- el select nunca mandaba NULL. Ahora sí es alcanzable (al elegir "Todos
-- los turnos"), y el frontend muestra un aviso explicando por qué esa
-- serie queda vacía en ese caso.
-- ============================================================================

-- ── 1. reporte_asistencias_rango_agregado ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reporte_asistencias_rango_agregado(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT DEFAULT NULL,
  p_programa    TEXT DEFAULT NULL,
  p_sede_id     TEXT DEFAULT NULL
)
RETURNS TABLE (
  cedula_docente TEXT,
  nombre_docente TEXT,
  dias_asistidos BIGINT,
  programas      TEXT[]
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
      RAISE EXCEPTION 'Selecciona un programa antes de generar el reporte.';
    END IF;
    IF NOT usuario_puede_ver_programa(p_programa) THEN
      RAISE EXCEPTION 'No tienes acceso a ese programa.';
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      a.cedula_docente,
      (array_agg(a.nombre_docente ORDER BY a.hora_registro DESC))[1] AS nombre_docente,
      count(DISTINCT a.fecha)                                        AS dias_asistidos,
      array_agg(DISTINCT a.programa) FILTER (WHERE a.programa IS NOT NULL) AS programas
    FROM public.asistencias_diarias a
    WHERE a.fecha BETWEEN p_fecha_desde AND p_fecha_hasta
      AND (p_turno    IS NULL OR a.turno    = p_turno)
      AND (p_programa IS NULL OR a.programa = p_programa)
      AND (p_sede_id  IS NULL OR a.sede_id  = p_sede_id)
    GROUP BY a.cedula_docente
    ORDER BY dias_asistidos DESC;
END;
$$;

COMMENT ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT, TEXT) IS
  'ARCH-27/SEDE-16/PROG-3. SECURITY INVOKER: respeta las mismas políticas '
  'RLS que el SELECT directo que sustituye (SEC-11/SEDE-3). p_sede_id '
  'acota además a una sede concreta para puedeVerTodasLasSedes. Desde '
  'PROG-3 (fase 2, 0080): si el rol del usuario restringe_programa, '
  'p_programa es obligatorio y debe ser uno de los suyos '
  '(usuario_puede_ver_programa). Desde 0097: p_turno NULL = sin filtro '
  '("Todos los turnos" en el select), mismo patrón que p_programa/p_sede_id.';

REVOKE ALL    ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT, TEXT) TO authenticated;


-- ── 2. reporte_estadisticas_academicas ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reporte_estadisticas_academicas(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT DEFAULT NULL,
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
  -- replica TURNOS_CONFIG (src/constants/index.js). NULL si p_turno es
  -- NULL ("Todos los turnos", 0097) o no matchea ningún turno conocido
  -- (defensivo: por_puntualidad sale '[]' en cualquiera de los dos casos,
  -- no hay una única hora de inicio con la cual comparar).
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
      AND (p_turno    IS NULL OR a.turno    = p_turno)
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
  -- v_turno_inicio_min NULL (turno desconocido o "Todos los turnos", 0097)
  -- deja la serie vacía.
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
  'v_turno_inicio_min replica TURNOS_CONFIG del frontend a mano. '
  'Desde 0097: p_turno NULL = sin filtro ("Todos los turnos" en el '
  'select); por_puntualidad sale [] en ese caso (sin hora de inicio única '
  'con la cual comparar).';

REVOKE ALL    ON FUNCTION public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_estadisticas_academicas(DATE, DATE, TEXT, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT * FROM reporte_asistencias_rango_agregado(
--      (CURRENT_DATE - INTERVAL '14 days')::date, CURRENT_DATE, NULL,
--      NULL, NULL);
--    -- debe devolver el agregado de TODOS los turnos, sin error.
-- 2. SELECT * FROM reporte_estadisticas_academicas(
--      (CURRENT_DATE - INTERVAL '14 days')::date, CURRENT_DATE, NULL,
--      NULL, NULL);
--    -- debe devolver las 5 series sin error; por_puntualidad debe salir
--    -- '[]' (sin hora de inicio de turno única con la cual comparar).
-- 3. Con turno real (ej. 'DIURNO') en ambas funciones: comportamiento
--    idéntico al de antes de esta migración (regresión).
-- 4. Repetir los chequeos de permisos por programa restringido de 0080/
--    0084/0093 (sin cambios en esa parte de ninguna de las dos funciones).
-- ============================================================================
