-- ============================================================================
-- 0095 — DIAG-1: tabla de logs para detectar consultas/RPCs colgadas
-- ============================================================================
-- Contexto: reporte de que la app se congela sin patrón de menú fijo, y
-- que recargar (F5) NO libera el colgado (solo cerrar la pestaña). Como
-- no es reproducible a demanda, en vez de adivinar se instrumenta el
-- cliente (src/utils/diagnosticoColgadas.js): toda consulta/RPC que
-- tarde más de 8s sin resolver queda registrada acá, vía fetch directo
-- al REST (no a través del cliente supabase ya envuelto, para no
-- depender de la misma conexión que podría estar colgada).
--
-- Es diagnóstico temporal: una vez identificada la causa raíz de los
-- colgados, esta tabla (y la instrumentación que la alimenta) se puede
-- eliminar.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.logs_diagnostico (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo        TEXT NOT NULL,   -- 'query_colgada' | 'rpc_colgada' | 'sw_controllerchange' | 'sw_register_error'
  detalle     JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.logs_diagnostico IS
  'DIAG-1: eventos de diagnóstico de colgados (consultas/RPCs sin '
  'resolver, cambios de Service Worker). Temporal -- eliminar una vez '
  'identificada la causa raíz de los colgados reportados.';

CREATE INDEX IF NOT EXISTS logs_diagnostico_created_at_idx
  ON public.logs_diagnostico (created_at DESC);

ALTER TABLE public.logs_diagnostico ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede insertar sus propios eventos
-- (no hay nada sensible en tipo/detalle -- son nombres de tabla/RPC,
-- ms transcurridos y la ruta actual).
CREATE POLICY logs_diagnostico_insert_propio
  ON public.logs_diagnostico
  FOR INSERT
  TO authenticated
  WITH CHECK (usuario_id = auth.uid() OR usuario_id IS NULL);

-- Solo admins pueden leer (mismo criterio que el resto de tablas
-- administrativas: admin_caller_es_admin, ver migración 0050).
CREATE POLICY logs_diagnostico_select_admin
  ON public.logs_diagnostico
  FOR SELECT
  TO authenticated
  USING (public.admin_caller_es_admin(auth.uid()));

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Como usuario no-admin autenticado: insertar una fila propia debe
--    funcionar; SELECT debe devolver 0 filas (no ve ni las propias).
-- 2. Como admin: SELECT * FROM logs_diagnostico debe devolver todo.
-- 3. Revisar periódicamente con:
--      SELECT tipo, detalle, created_at
--      FROM logs_diagnostico
--      ORDER BY created_at DESC
--      LIMIT 50;
--    Buscar clusters de 'sw_controllerchange' justo antes de un
--    'query_colgada'/'rpc_colgada' -- confirmaría la hipótesis del
--    Service Worker.
-- ============================================================================
