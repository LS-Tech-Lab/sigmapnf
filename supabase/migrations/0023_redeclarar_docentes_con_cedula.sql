-- ============================================================
-- Migración: 0023_redeclarar_docentes_con_cedula.sql
--
-- CONTEXTO:
--   La RPC docentes_con_cedula() fue definida originalmente en
--   0009_cedula_como_id_unico_docente.sql junto con un bloque
--   de lógica mayor (columna cédula, índices, constraints).
--   En useNombresCache.js el hook la llama con fallback defensivo:
--
--     const { data, error } = await supabase.rpc("docentes_con_cedula");
--     if (error) { /* fallback a query directa */ }
--
--   El problema: si la BD se reinicia desde cero y se re-aplican
--   migraciones, la función queda definida dentro de 0009 junto
--   a muchas otras sentencias. Un error previo en 0009 puede
--   hacer que la función no exista, y el fallback en el hook
--   oculta el problema silenciosamente.
--
-- PROPÓSITO DE ESTA MIGRACIÓN:
--   Re-declarar la función de forma aislada e idempotente
--   (CREATE OR REPLACE) para que cualquier reset de BD garantice
--   su existencia independientemente del estado de 0009.
--
--   Es seguro aplicarla aunque 0009 ya haya corrido: el
--   CREATE OR REPLACE simplemente actualiza la definición.
-- ============================================================

-- ── Asegurar search_path seguro ─────────────────────────────
SET search_path TO public;


-- ── Re-declaración idempotente ───────────────────────────────
CREATE OR REPLACE FUNCTION public.docentes_con_cedula()
RETURNS TABLE (
  nombre_raw     TEXT,
  nombre_display TEXT,
  cedula         TEXT,
  cedula_fuente  TEXT   -- 'vinculada' | 'asistencia' | NULL
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
      -- Si no tiene vínculo formal, tomar la cédula más reciente de asistencias
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
    END AS cedula_fuente
  FROM  docentes d
  ORDER BY d.nombre_display;
$$;

COMMENT ON FUNCTION public.docentes_con_cedula IS
  'Devuelve todos los docentes con su cédula, priorizando la vinculada en '
  'docentes.cedula. Si no tiene vínculo formal, cruza con asistencias_diarias '
  'para mostrar la cédula con la que ese docente marcó asistencia. '
  'cedula_fuente indica el origen: "vinculada" | "asistencia" | NULL. '
  'Re-declarada en 0023 para garantizar existencia en resets de BD.';

-- Permisos: solo usuarios autenticados (operadores y admins)
REVOKE ALL  ON FUNCTION public.docentes_con_cedula() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.docentes_con_cedula() TO authenticated;


-- ── Verificación post-migración ──────────────────────────────
-- SELECT routine_name, routine_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name   = 'docentes_con_cedula';
--
-- Resultado esperado: 1 fila con routine_type = 'FUNCTION'.
