-- =====================================================================
-- 0029_cedula_nullable.sql
-- Proyecto: horariospnf — UNERMB
-- Fecha: Junio 2026
--
-- La cédula es clave de negocio pero no siempre se tiene al momento
-- de cargar el Excel. Los docentes sin cédula se insertan igual y
-- quedan pendientes de completar desde el menú Docentes.
--
-- Cambio: quitar NOT NULL de docentes.cedula.
-- El constraint UNIQUE se mantiene (null-safe: múltiples null OK).
-- =====================================================================

ALTER TABLE docentes
  ALTER COLUMN cedula DROP NOT NULL;
