-- =====================================================================
-- 0017_reset_y_cedula_obligatoria.sql
-- Proyecto: horariospnf — UNERMB
-- Fecha: Junio 2026
--
-- Limpieza total para entorno de pruebas:
--   1. Vaciar horarios (particiones + backup)
--   2. Vaciar docentes y materias
--   3. Hacer cedula NOT NULL y UNIQUE en docentes
--   4. Resetear secuencias de IDs
-- =====================================================================

BEGIN;

-- ── 1. Vaciar datos de horarios ──────────────────────────────────────
TRUNCATE TABLE _backup_horarios_pre_particion;
TRUNCATE TABLE horarios;          -- cascadea a todas las particiones

-- ── 2. Vaciar catálogos ──────────────────────────────────────────────
TRUNCATE TABLE docentes RESTART IDENTITY CASCADE;
TRUNCATE TABLE materias RESTART IDENTITY CASCADE;

-- ── 3. Cédula obligatoria y única ────────────────────────────────────
-- Quitar el constraint anterior si existe (de migración 0016)
ALTER TABLE docentes
  DROP CONSTRAINT IF EXISTS docentes_cedula_unique;

DROP INDEX IF EXISTS idx_docentes_cedula;

-- Normalizar formato (solo dígitos) y hacer NOT NULL + UNIQUE
ALTER TABLE docentes
  ALTER COLUMN cedula SET NOT NULL,
  ADD CONSTRAINT docentes_cedula_unique UNIQUE (cedula);

-- Índice para búsqueda rápida
CREATE INDEX idx_docentes_cedula ON docentes (cedula);

COMMIT;
