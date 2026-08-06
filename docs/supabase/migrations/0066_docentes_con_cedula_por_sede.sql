-- ============================================================================
-- Migración: 0066_docentes_con_cedula_por_sede.sql
-- Fecha: 6 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Bug reportado: al elegir cualquier sede en el selector (SEDE-2), la app
-- seguía mostrando los docentes de Cabimas sin importar cuál se eligiera.
--
-- CAUSA RAÍZ
-- ----------
-- `docentes_con_cedula()` (0009, redeclarada en 0023) es SECURITY DEFINER
-- -- corre con los privilegios del dueño de la función, así que NINGUNA
-- política RLS la alcanza (mismo problema de fondo que ya se identificó en
-- 0065 para borrar_horarios/restaurar_backup). Nunca tuvo filtro de sede:
-- desde que existe, `SELECT ... FROM docentes d ... ORDER BY
-- d.nombre_display` devuelve TODOS los docentes de TODAS las sedes a
-- CUALQUIER usuario autenticado, sin importar su rol o permisos. Con una
-- sola sede en producción esto nunca se notó -- es exactamente el mismo
-- patrón de "nadie lo vio porque solo existía Cabimas" que motivó 0065.
--
-- FIX
-- ---
-- Se agrega p_sede_id y se resuelve la sede efectiva con el mismo patrón
-- ya establecido en borrar_horarios/restaurar_backup/crear_qr_session:
-- sede fija del perfil, o p_sede_id explícito si el rol tiene
-- puedeVerTodasLasSedes. El filtro por sede aplica tanto a `docentes`
-- como al cruce contra `asistencias_diarias` (para no traer una cédula
-- "prestada" de un docente con el mismo nombre en otra sede).
-- ============================================================================


-- FIX (mismo patrón que 0064/0065): la firma cambia de () a (text) --
-- se sueltan los overloads existentes antes de recrearla, en vez de
-- confiar en CREATE OR REPLACE (que no reemplaza cuando cambia la firma
-- y dejaría un COMMENT/REVOKE/GRANT ambiguo, error 42725).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'docentes_con_cedula'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.docentes_con_cedula(p_sede_id text DEFAULT NULL)
RETURNS TABLE (
  nombre_raw     TEXT,
  nombre_display TEXT,
  cedula         TEXT,
  cedula_fuente  TEXT   -- 'vinculada' | 'asistencia' | NULL
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_sede_efectiva TEXT;
BEGIN
  -- Mismo criterio de resolución de sede que borrar_horarios/
  -- restaurar_backup/crear_qr_session (0064/0065): sede fija del perfil
  -- primero; si no tiene, exige puedeVerTodasLasSedes + p_sede_id válido.
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();

  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de consultar docentes.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  RETURN QUERY
  SELECT
    d.nombre_raw,
    d.nombre_display,
    COALESCE(
      d.cedula,
      (
        SELECT ad.cedula_docente
        FROM   asistencias_diarias ad
        WHERE  LOWER(TRIM(ad.nombre_docente)) = LOWER(TRIM(d.nombre_raw))
          AND  ad.sede_id = v_sede_efectiva
        ORDER  BY ad.hora_registro DESC
        LIMIT  1
      )
    ) AS cedula,
    CASE
      WHEN d.cedula IS NOT NULL THEN 'vinculada'
      WHEN EXISTS (
        SELECT 1
        FROM   asistencias_diarias ad
        WHERE  LOWER(TRIM(ad.nombre_docente)) = LOWER(TRIM(d.nombre_raw))
          AND  ad.sede_id = v_sede_efectiva
      ) THEN 'asistencia'
      ELSE NULL
    END AS cedula_fuente
  FROM  docentes d
  WHERE d.sede_id = v_sede_efectiva
  ORDER BY d.nombre_display;
END;
$$;

COMMENT ON FUNCTION public.docentes_con_cedula(text) IS
  'SEDE-6: agrega p_sede_id. Antes era SECURITY DEFINER sin NINGÚN filtro '
  'de sede -- bypassaba RLS (0063) por completo y devolvía docentes de '
  'todas las sedes a cualquier usuario autenticado. Resuelve la sede '
  'efectiva igual que borrar_horarios/restaurar_backup/crear_qr_session '
  '(sede fija del perfil, o p_sede_id si el rol tiene '
  'puedeVerTodasLasSedes). El cruce con asistencias_diarias para inferir '
  'cédula también queda acotado a esa sede, para no "prestar" una cédula '
  'de un docente homónimo en otra sede.';

REVOKE ALL    ON FUNCTION public.docentes_con_cedula(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.docentes_con_cedula(text) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Con datos de prueba en dos sedes: SELECT * FROM
--    docentes_con_cedula('cabimas') -> solo docentes de Cabimas.
--    SELECT * FROM docentes_con_cedula('<otra_sede>') -> solo esa sede.
-- 2. Desde un usuario con sede fija: SELECT * FROM docentes_con_cedula()
--    (sin argumento) -> solo su sede, ignora cualquier otro dato.
-- 3. Desde un usuario con puedeVerTodasLasSedes y sin p_sede_id ->
--    debe rechazar pidiendo que seleccione una sede.
-- 4. Confirmar que el frontend (useNombresCache.js) empieza a mandar
--    sedeActiva como p_sede_id en la llamada RPC -- ver el cambio de
--    frontend correspondiente en el mismo despliegue; sin eso, esta
--    migración por sí sola no arregla el bug reportado, porque el
--    cliente actual llama la RPC sin argumento.
-- ============================================================================
