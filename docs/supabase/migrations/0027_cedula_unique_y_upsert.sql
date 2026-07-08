-- =====================================================================
-- 0016_cedula_unique_y_upsert.sql
-- Proyecto: horariospnf — UNERMB
-- Fecha: Junio 2026
--
-- 1. Limpia el formato de cédulas existentes (quita "V-", espacios).
-- 2. Agrega constraint UNIQUE en docentes.cedula.
--    NULL está permitido — solo los valores no-null deben ser únicos.
-- 3. Agrega índice parcial para búsqueda rápida por cédula.
-- =====================================================================

BEGIN;

-- ── 1. Normalizar formato de cédulas ya en BD ────────────────────────
-- Algunos registros tienen "V-12345678" o "V-12345678" con espacios.
-- Dejar solo los dígitos numéricos para consistencia.
UPDATE docentes
SET cedula = regexp_replace(cedula, '[^0-9]', '', 'g')
WHERE cedula IS NOT NULL
  AND cedula ~ '[^0-9]';

-- Convertir strings vacíos a null por si acaso
UPDATE docentes
SET cedula = NULL
WHERE cedula = '';

-- ── 2. Constraint UNIQUE (null-safe: múltiples null permitidos) ──────
ALTER TABLE docentes
  ADD CONSTRAINT docentes_cedula_unique UNIQUE (cedula);

-- ── 3. Índice parcial para lookup rápido por cédula ──────────────────
CREATE INDEX IF NOT EXISTS idx_docentes_cedula
  ON docentes (cedula)
  WHERE cedula IS NOT NULL;

COMMIT;
