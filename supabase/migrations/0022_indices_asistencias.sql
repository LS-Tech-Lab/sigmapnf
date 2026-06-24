-- ============================================================
-- Migración: 0022_indices_asistencias.sql
--
-- Agrega índices a asistencias_diarias para optimizar las
-- consultas más frecuentes del módulo QR:
--
--   · ReporteAsistencias filtra por fecha + turno + programa
--   · AdminQRPanel consulta asistencias por qr_session_id
--   · VistaAusentes y ReporteRango filtran por cedula_docente
--   · Conteo rápido de escaneos para rotación del token QR
--
-- Sin estos índices, cualquier consulta a asistencias_diarias
-- hace un full table scan. Con un semestre completo (~150 días
-- × N docentes por turno), los reportes en tiempo real sufren
-- latencia visible en conexiones lentas (VE).
-- ============================================================

-- ── Índice principal: filtro por fecha (consulta más común) ─
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha
  ON asistencias_diarias(fecha);

-- ── Índice compuesto: fecha + turno (ReporteAsistencias) ────
-- Cubre el filtro combinado más usado en el reporte diario.
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha_turno
  ON asistencias_diarias(fecha, turno);

-- ── Índice compuesto: fecha + programa ──────────────────────
-- Cubre el filtro de programa en ReporteAsistencias/ReporteRango.
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha_programa
  ON asistencias_diarias(fecha, programa);

-- ── Índice por cédula docente ────────────────────────────────
-- Usado por VistaAusentes, exportCSV y búsquedas nominales.
CREATE INDEX IF NOT EXISTS idx_asistencias_cedula
  ON asistencias_diarias(cedula_docente);

-- ── Índice por sesión QR ─────────────────────────────────────
-- Usado por AdminQRPanel para contar y listar asistencias de
-- la sesión activa (widget de contador en tiempo real).
CREATE INDEX IF NOT EXISTS idx_asistencias_qr_session
  ON asistencias_diarias(qr_session_id);

-- ── Índice por tipo (ENTRADA / SALIDA) ───────────────────────
-- Usado por el conteo de "solo_entrada" vs "completo" en el
-- reporte y en VistaAusentes.
CREATE INDEX IF NOT EXISTS idx_asistencias_tipo
  ON asistencias_diarias(tipo);


-- ── Verificación post-migración ──────────────────────────────
-- Ejecutar para confirmar que los índices existen:
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'asistencias_diarias'
--   AND indexname LIKE 'idx_asistencias_%'
-- ORDER BY indexname;
--
-- Resultado esperado: 6 filas.
