-- =============================================================================
-- Migración 0036 — Corrección V-2: RLS de qr_sessions y asistencias_diarias
--
-- Las políticas SELECT de 0007 hardcodeaban roles ('admin', 'operador_qr'),
-- desconectando el sistema de permisos granulares de la tabla `roles`.
-- Un rol personalizado con puedeGestionarQR=true o puedeVerReporteAsistencias=true
-- era bloqueado en BD aunque tuviera los permisos correctos.
--
-- Fix: reemplazar la verificación de rol por tiene_permiso(), de modo que
-- cualquier rol con el permiso correspondiente pueda acceder.
-- Se mantiene AND activo=true como antes.
-- =============================================================================


-- ── qr_sessions: SELECT ──────────────────────────────────────────────────────
-- Antes: rol IN ('admin', 'operador_qr')
-- Ahora: tiene_permiso(..., 'puedeGestionarQR')
--        OR tiene_permiso(..., 'puedeVerReporteAsistencias')
--        (reporte también necesita ver la sesión para enlazar registros)

DROP POLICY IF EXISTS "admin_operador_lee_qr_sessions"    ON public.qr_sessions;
DROP POLICY IF EXISTS "admin_lee_qr_sessions"             ON public.qr_sessions;

CREATE POLICY "lee_qr_sessions_por_permiso"
  ON public.qr_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE  up.id     = auth.uid()
        AND  up.activo = true
    )
    AND (
      tiene_permiso(auth.uid(), 'puedeGestionarQR')
      OR tiene_permiso(auth.uid(), 'puedeVerReporteAsistencias')
    )
  );

COMMENT ON POLICY "lee_qr_sessions_por_permiso" ON public.qr_sessions IS
  'Permite SELECT a cualquier usuario activo con puedeGestionarQR '
  'o puedeVerReporteAsistencias. Corrige V-2 (auditoría Junio 2026): '
  'antes se hardcodeaban roles admin/operador_qr.';


-- ── asistencias_diarias: SELECT ──────────────────────────────────────────────
-- Antes: rol IN ('admin', 'operador_qr')
-- Ahora: tiene_permiso(..., 'puedeGestionarQR')
--        OR tiene_permiso(..., 'puedeVerReporteAsistencias')

DROP POLICY IF EXISTS "admin_operador_lee_asistencias" ON public.asistencias_diarias;
DROP POLICY IF EXISTS "admin_lee_asistencias"          ON public.asistencias_diarias;

CREATE POLICY "lee_asistencias_por_permiso"
  ON public.asistencias_diarias FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE  up.id     = auth.uid()
        AND  up.activo = true
    )
    AND (
      tiene_permiso(auth.uid(), 'puedeGestionarQR')
      OR tiene_permiso(auth.uid(), 'puedeVerReporteAsistencias')
    )
  );

COMMENT ON POLICY "lee_asistencias_por_permiso" ON public.asistencias_diarias IS
  'Permite SELECT a cualquier usuario activo con puedeGestionarQR '
  'o puedeVerReporteAsistencias. Corrige V-2 (auditoría Junio 2026): '
  'antes se hardcodeaban roles admin/operador_qr.';
