-- ============================================================
-- Migración: 0022_indices_asistencias.sql
--
-- Índices sobre asistencias_diarias para optimizar consultas
-- frecuentes del módulo QR (ReporteAsistencias, AdminQRPanel,
-- VistaAusentes, cruce nombre→cédula).
--
-- NOTA: Estos índices fueron creados manualmente en Supabase
-- antes de documentarse aquí. Esta migración es idempotente
-- (IF NOT EXISTS) y puede aplicarse sin riesgo aunque ya existan.
-- ============================================================

SET search_path TO public;

-- Filtro por fecha (consulta más común en reportes)
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha
  ON public.asistencias_diarias(fecha DESC);

-- Filtro compuesto fecha + turno (ReporteAsistencias diario)
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha_turno
  ON public.asistencias_diarias(fecha, turno);

-- Filtro compuesto fecha + programa (ReporteRango por programa)
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha_programa
  ON public.asistencias_diarias(fecha, programa);

-- Búsqueda por cédula (VistaAusentes, exportCSV)
CREATE INDEX IF NOT EXISTS idx_asistencias_cedula
  ON public.asistencias_diarias(cedula_docente);

-- Compuesto cédula + fecha + tipo (historial por docente)
CREATE INDEX IF NOT EXISTS idx_asistencias_cedula_fecha_tipo
  ON public.asistencias_diarias(cedula_docente, fecha, tipo);

-- Sesión QR activa (contador en tiempo real de AdminQRPanel)
CREATE INDEX IF NOT EXISTS idx_asistencias_qr_session
  ON public.asistencias_diarias(qr_session_id);

-- Tipo ENTRADA/SALIDA (conteo en reporte y VistaAusentes)
CREATE INDEX IF NOT EXISTS idx_asistencias_tipo
  ON public.asistencias_diarias(tipo);

-- Cruce nombre_docente → docentes.nombre_raw (docentes_con_cedula RPC)
-- Creado originalmente en 0009; se re-declara aquí para documentar
-- el conjunto completo de índices de asistencias_diarias.
CREATE INDEX IF NOT EXISTS idx_asistencias_nombre_docente
  ON public.asistencias_diarias(LOWER(nombre_docente));
