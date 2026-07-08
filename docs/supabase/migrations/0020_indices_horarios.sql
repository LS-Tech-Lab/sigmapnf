-- ============================================================
-- Migración: 0020_indices_horarios.sql
-- Fix #16 — Agregar índices en columnas de búsqueda frecuente
--            de la tabla horarios para evitar full table scans
--            a medida que la tabla crece.
-- ============================================================

-- Índice compuesto principal: cubre los filtros más comunes
-- (por lapso y programa simultáneamente).
CREATE INDEX IF NOT EXISTS idx_horarios_lapso_programa
  ON horarios(lapso, programa);

-- Índice por lapso solo: cubre consultas que filtran solo por lapso
-- (ej: cargar todos los horarios del trimestre activo).
CREATE INDEX IF NOT EXISTS idx_horarios_lapso
  ON horarios(lapso);

-- Índice por dia y hora: cubre búsquedas de conflictos de horario
-- (mismo dia/hora en distintas secciones).
CREATE INDEX IF NOT EXISTS idx_horarios_dia_hora
  ON horarios(dia, hora);

-- Índice por sheet (sección): cubre filtros por sección en HorariosView.
CREATE INDEX IF NOT EXISTS idx_horarios_sheet
  ON horarios(sheet);

-- ── Verificación post-migración ─────────────────────────────
-- Ejecutar luego para confirmar que los índices existen:
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'horarios'
--   AND indexname LIKE 'idx_horarios_%'
-- ORDER BY indexname;
--
-- Resultado esperado: 4 filas con los índices creados arriba.
