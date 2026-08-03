-- ============================================================
-- Migración: 0060_off9_rate_limit_persistente_csp_report.sql
-- Fix OFF-9 (auditoría de estrés operacional, 2 de agosto) —
--            api/csp-report.js (SEC-24) usaba un Map() en
--            memoria del proceso para el rate limit por IP.
--            Vercel escala horizontalmente bajo carga: cada
--            instancia nueva arranca con su propio contador en
--            cero, así que el límite nominal de 20/min por IP es
--            eludible repartiendo requests entre instancias — no
--            es una fuga de datos, pero permite inflar audit_logs
--            con ruido que dificulta detectar un incidente real.
--
-- Mismo patrón ya usado en admin_actions_rate_limit (SEC-11,
-- migración 0051) y scan_rate_limit (D-3, migración 0039): tabla
-- con contador + ventana deslizante, limpieza inline de ventanas
-- vencidas, sin infraestructura nueva (no requiere pg_cron: se
-- limpia sola en cada llamada).
--
-- Clave del límite: IP (texto, no `inet`) porque el header
-- `x-forwarded-for` que ya usa csp-report.js puede traer más de
-- una IP separada por coma o formatos no siempre parseables como
-- `inet` estricto — se guarda tal cual se usa hoy en el código
-- para no cambiar semántica, solo el lugar donde se cuenta.
-- ============================================================


-- ── 1. Tabla de rate limiting ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.csp_report_rate_limit (
  ip              TEXT        NOT NULL,
  intentos        INTEGER     NOT NULL DEFAULT 1,
  ventana_inicio  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ip)
);

COMMENT ON TABLE public.csp_report_rate_limit IS
  'Rate limiting persistente para api/csp-report.js (Fix OFF-9, reemplaza '
  'el Map() en memoria de SEC-24 que no sobrevivía entre instancias '
  'serverless). Un registro por IP con contador de intentos en la ventana '
  'activa. Mismo patrón que admin_actions_rate_limit (SEC-11) y '
  'scan_rate_limit (D-3).';

ALTER TABLE public.csp_report_rate_limit ENABLE ROW LEVEL SECURITY;
-- Sin políticas = todo denegado por RLS; el acceso es exclusivamente
-- a través de la RPC SECURITY DEFINER de abajo.


-- ── 2. RPC de verificación + conteo ──────────────────────────
-- Se llama una vez por request en api/csp-report.js, antes de aceptar
-- el reporte. Mantiene el mismo límite nominal que tenía la versión en
-- memoria (20 req/min por IP) para no cambiar comportamiento observable,
-- solo la persistencia del contador.
CREATE OR REPLACE FUNCTION public.registrar_csp_report_rate_limit(p_ip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  MAX_INTENTOS     CONSTANT INTEGER := 20;
  VENTANA_SEG      CONSTANT INTEGER := 60; -- 1 minuto
  v_intentos_act   INTEGER;
BEGIN
  -- Limpieza oportunista de ventanas vencidas (mantenimiento inline,
  -- sin cron adicional — mismo patrón que 0039/0051).
  DELETE FROM public.csp_report_rate_limit
  WHERE ventana_inicio < now() - (VENTANA_SEG || ' seconds')::INTERVAL;

  INSERT INTO public.csp_report_rate_limit (ip, intentos, ventana_inicio)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip) DO UPDATE
    SET intentos = CASE
          WHEN csp_report_rate_limit.ventana_inicio < now() - (VENTANA_SEG || ' seconds')::INTERVAL
          THEN 1
          ELSE csp_report_rate_limit.intentos + 1
        END,
        ventana_inicio = CASE
          WHEN csp_report_rate_limit.ventana_inicio < now() - (VENTANA_SEG || ' seconds')::INTERVAL
          THEN now()
          ELSE csp_report_rate_limit.ventana_inicio
        END
  RETURNING intentos INTO v_intentos_act;

  RETURN jsonb_build_object('permitido', v_intentos_act <= MAX_INTENTOS);
END;
$$;

COMMENT ON FUNCTION public.registrar_csp_report_rate_limit IS
  'Rate limiting persistente de api/csp-report.js (Fix OFF-9): máx. 20 '
  'reportes por minuto por IP, contador en tabla en vez de memoria del '
  'proceso — sobrevive a múltiples instancias serverless concurrentes. '
  'Se invoca una sola vez por request, antes de aceptar el reporte.';

-- Solo el propio endpoint (con la Service Role Key) debe poder
-- incrementar este contador; nunca el cliente ni anon.
REVOKE ALL    ON FUNCTION public.registrar_csp_report_rate_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_csp_report_rate_limit(text) TO service_role;

-- ── Verificación post-migración ──────────────────────────────
-- 1. Smoke test — primeras 20 llamadas seguidas con la misma IP deben
--    devolver permitido:true, la 21ª dentro del mismo minuto debe
--    devolver permitido:false:
--
--    SELECT registrar_csp_report_rate_limit('203.0.113.9');
--    -- repetir 21 veces
--
-- 2. Confirmar que IPs distintas no se bloquean entre sí.
--
-- 3. Limpiar datos de prueba:
--    DELETE FROM csp_report_rate_limit WHERE ip = '203.0.113.9';
