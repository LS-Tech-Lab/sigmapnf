-- ============================================================
-- Migración: 0026_formato_v2_docentes_y_materias.sql
--
-- Contexto:
--   El nuevo formato unificado de Excel (v2) incorpora dos hojas
--   estructuradas adicionales:
--     - DOCENTES: catálogo del trimestre con cédula, teléfono,
--                 email y observaciones.
--     - MALLA: catálogo curricular con trayecto, código UC,
--              horas semanales y unidades de crédito.
--
--   El parser en excelParser.js ya extrae esos datos y los envía
--   al upsert. Esta migración agrega las columnas que faltan para
--   que Supabase las acepte sin error.
--
-- Cambios:
--   Bloque 1 — tabla `docentes`:
--     Agrega telefono, email, observaciones.
--     (cedula ya existe desde la migración 0009)
--
--   Bloque 2 — tabla `materias`:
--     Agrega trayecto, codigo_uc, horas_semanales, unidades_credito.
--
-- Todas las ALTER son idempotentes (ADD COLUMN IF NOT EXISTS).
-- No elimina ni modifica columnas existentes → rollback trivial.
-- ============================================================

SET search_path TO public;


-- ════════════════════════════════════════════════════════════
-- BLOQUE 1 — tabla docentes
--
-- Columnas existentes (no se tocan):
--   id, nombre_raw, nombre_display, cedula, created_at
--
-- Columnas nuevas:
--   telefono        TEXT  — número de contacto del docente
--   email           TEXT  — correo electrónico
--   observaciones   TEXT  — notas libres del coordinador
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.docentes
  ADD COLUMN IF NOT EXISTS telefono      TEXT,
  ADD COLUMN IF NOT EXISTS email         TEXT,
  ADD COLUMN IF NOT EXISTS observaciones TEXT;

COMMENT ON COLUMN public.docentes.telefono IS
  'Número de contacto importado desde la hoja DOCENTES del Excel (formato v2).';

COMMENT ON COLUMN public.docentes.email IS
  'Correo electrónico importado desde la hoja DOCENTES del Excel (formato v2).';

COMMENT ON COLUMN public.docentes.observaciones IS
  'Notas libres del coordinador, importadas desde la hoja DOCENTES del Excel (formato v2).';


-- ════════════════════════════════════════════════════════════
-- BLOQUE 2 — tabla materias
--
-- Columnas existentes (no se tocan):
--   id, nombre_raw, nombre_display, created_at
--
-- Columnas nuevas:
--   trayecto          TEXT  — ej. "1-1", "2-3", "INICIAL"
--   codigo_uc         TEXT  — código de la unidad curricular
--   horas_semanales   TEXT  — horas semanales según malla
--   unidades_credito  TEXT  — unidades de crédito académico
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.materias
  ADD COLUMN IF NOT EXISTS trayecto         TEXT,
  ADD COLUMN IF NOT EXISTS codigo_uc        TEXT,
  ADD COLUMN IF NOT EXISTS horas_semanales  TEXT,
  ADD COLUMN IF NOT EXISTS unidades_credito TEXT;

COMMENT ON COLUMN public.materias.trayecto IS
  'Trayecto de la unidad curricular según la malla del programa (ej. "2-1").';

COMMENT ON COLUMN public.materias.codigo_uc IS
  'Código oficial de la unidad curricular importado desde la hoja MALLA.';

COMMENT ON COLUMN public.materias.horas_semanales IS
  'Horas semanales según malla curricular, importadas desde la hoja MALLA.';

COMMENT ON COLUMN public.materias.unidades_credito IS
  'Unidades de crédito académico según malla curricular, importadas desde la hoja MALLA.';


-- ════════════════════════════════════════════════════════════
-- BLOQUE 3 — Actualizar RPC docentes_con_cedula()
--
-- La función existente devuelve (nombre_raw, nombre_display,
-- cedula, cedula_fuente). Con el nuevo formato v2, el panel de
-- docentes puede mostrar también teléfono y email sin necesidad
-- de una query adicional. Se amplía el RETURNS TABLE.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.docentes_con_cedula()
RETURNS TABLE (
  nombre_raw     TEXT,
  nombre_display TEXT,
  cedula         TEXT,
  cedula_fuente  TEXT,
  telefono       TEXT,
  email          TEXT,
  observaciones  TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    d.nombre_raw,
    d.nombre_display,
    COALESCE(
      d.cedula,
      (
        SELECT ad.cedula_docente
        FROM   asistencias_diarias ad
        WHERE  LOWER(TRIM(ad.nombre_docente)) = LOWER(TRIM(d.nombre_raw))
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
      ) THEN 'asistencia'
      ELSE NULL
    END AS cedula_fuente,
    d.telefono,
    d.email,
    d.observaciones
  FROM  public.docentes d
  ORDER BY d.nombre_display;
$$;

COMMENT ON FUNCTION public.docentes_con_cedula IS
  'Devuelve todos los docentes con cédula, origen de la cédula y campos de contacto '
  '(telefono, email, observaciones) importados desde el nuevo formato v2. '
  'Retrocompatible: si las columnas telefono/email/observaciones son NULL, '
  'los consumidores existentes siguen funcionando sin cambios.';

REVOKE ALL   ON FUNCTION public.docentes_con_cedula() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.docentes_con_cedula() TO authenticated;


-- ════════════════════════════════════════════════════════════
-- Verificación post-migración (ejecutar manualmente si quieres
-- confirmar antes de hacer deploy):
--
--   SELECT column_name, data_type
--   FROM   information_schema.columns
--   WHERE  table_schema = 'public'
--     AND  table_name   IN ('docentes', 'materias')
--     AND  column_name  IN (
--            'telefono','email','observaciones',
--            'trayecto','codigo_uc','horas_semanales','unidades_credito'
--          )
--   ORDER BY table_name, column_name;
--
--   Resultado esperado: 7 filas (3 en docentes, 4 en materias).
-- ════════════════════════════════════════════════════════════
