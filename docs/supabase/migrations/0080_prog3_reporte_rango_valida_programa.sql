-- ============================================================================
-- Migración: 0080_prog3_reporte_rango_valida_programa.sql
-- Fecha: 8 de agosto de 2026
--
-- CONTEXTO
-- --------
-- PROG-3 (fase 2). `reporte_asistencias_rango_agregado()` (0069) es
-- SECURITY INVOKER: corre con los privilegios de quien la llama, así que
-- las políticas RLS de `asistencias_diarias` (0064) ya limitan el
-- resultado por sede. Pero no existe (todavía) ninguna política RLS por
-- programa -- eso es PROG-3 fase 3 -- así que `p_programa` seguía siendo
-- un filtro puramente decorativo mandado por el cliente: un usuario
-- restringido a un programa podía mandar `p_programa = NULL` (o el de
-- otro programa) y el "Reporte por Rango" le devolvía datos agregados de
-- TODOS los programas de su sede, mezclados. Mismo patrón de hueco que
-- ya se cerró en `exportar_backup_completo` (`PROG-1a`, 0077).
--
-- FIX
-- ---
-- La función pasa de `LANGUAGE sql` a `LANGUAGE plpgsql` para poder
-- validar antes de correr la agregación: si el rol del usuario que llama
-- tiene `restringe_programa`, exige `p_programa` no nulo y verifica que
-- sea uno de los suyos vía `usuario_puede_ver_programa()` (`PROG-2`,
-- 0078) -- rechaza en vez de devolver datos fuera de su alcance. Un
-- usuario sin restricción sigue pudiendo mandar `p_programa = NULL` para
-- ver el agregado completo, igual que antes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reporte_asistencias_rango_agregado(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  p_turno       TEXT,
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
      AND a.turno = p_turno
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
  '(usuario_puede_ver_programa) -- antes era un filtro decorativo que el '
  'cliente podía omitir o falsear.';

-- GRANT/REVOKE de 0069 siguen vigentes (CREATE OR REPLACE no los toca),
-- se repiten explícitos por claridad -- mismo criterio que 0077/0078.
REVOKE ALL    ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_asistencias_rango_agregado(DATE, DATE, TEXT, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Como usuario con rol restringido: SELECT * FROM
--    reporte_asistencias_rango_agregado('2026-08-01','2026-08-07','DIURNO',
--    NULL, NULL); -- debe rechazar: "Selecciona un programa..."
-- 2. Mismo usuario, con el programa de OTRO coordinador -- debe rechazar:
--    "No tienes acceso a ese programa."
-- 3. Mismo usuario, con su propio programa -- debe devolver resultados
--    normalmente.
-- 4. Usuario SIN restricción (puedeVerTodo): sigue pudiendo mandar
--    p_programa = NULL y ver el agregado completo, sin cambios.
-- ============================================================================
