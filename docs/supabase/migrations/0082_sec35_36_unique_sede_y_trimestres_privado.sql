-- ============================================================================
-- Migración: 0082_sec35_36_unique_sede_y_trimestres_privado.sql
-- Fecha: 9 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Aplicada a mano por LS en el SQL Editor durante la auditoría completa de
-- BD en curso; se versiona acá para que quede en el historial reproducible
-- (mismo criterio que 0071 para SEC-30/31/32).
--
-- SEC-35: `uq_asistencia_docente_dia_tipo` (0008, previo al sistema de
-- sedes) es UNIQUE (cedula_docente, fecha, tipo) sin sede_id. Como 0061
-- estableció catálogos de docentes INDEPENDIENTES por sede
-- (docentes_sede_cedula_unique es (sede_id, cedula), no global), este
-- constraint quedó desalineado: nunca se actualizó cuando se introdujo el
-- aislamiento multi-sede. Se reemplaza por la versión con sede_id.
--
-- SEC-36: política "Lectura publica trimestres" con roles={public}
-- (incluye anon), a diferencia de toda otra tabla de catálogo (sedes,
-- roles), que están correctamente en {authenticated}. Sin migración que la
-- haya creado -- mismo patrón de objeto "fantasma" que SEC-9/SEC-17/
-- SEC-30/31. Verificado contra el código real (grep en src/): trimestres
-- solo se consulta desde App.jsx y HistorialView.jsx, ambos contextos
-- autenticados -- el flujo anónimo de /scan (DocenteScan/) no la toca.
-- Sin necesidad funcional de que sea pública.
-- ============================================================================

-- ── SEC-35: UNIQUE de asistencias_diarias aislado por sede ──────────────────
ALTER TABLE public.asistencias_diarias
  DROP CONSTRAINT IF EXISTS uq_asistencia_docente_dia_tipo;

ALTER TABLE public.asistencias_diarias
  ADD CONSTRAINT uq_asistencia_docente_dia_tipo_sede
  UNIQUE (sede_id, cedula_docente, fecha, tipo);


-- ── SEC-36: trimestres solo para authenticated ───────────────────────────────
DROP POLICY IF EXISTS "Lectura publica trimestres" ON public.trimestres;

CREATE POLICY "trimestres_select_authenticated" ON public.trimestres
  FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Confirmar el nuevo constraint:
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.asistencias_diarias'::regclass AND contype = 'u';
--    -- Esperado: uq_asistencia_docente_dia_tipo_sede (sede_id, cedula_docente, fecha, tipo).
-- 2. Confirmar que no quedan filas con sede_id NULL antes de depender del
--    aislamiento (UNIQUE permite múltiples NULL en Postgres):
--    SELECT count(*) FROM asistencias_diarias WHERE sede_id IS NULL; -- 0
-- 3. Confirmar la política de trimestres:
--    SELECT policyname, roles FROM pg_policies
--    WHERE tablename = 'trimestres' AND cmd = 'SELECT';
--    -- Esperado: solo trimestres_select_authenticated, roles = {authenticated}.
-- 4. Confirmar que un cliente anónimo (sin sesión) ya no puede leer
--    trimestres vía PostgREST.
-- ============================================================================
