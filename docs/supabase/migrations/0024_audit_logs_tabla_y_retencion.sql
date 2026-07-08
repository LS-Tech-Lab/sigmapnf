-- ============================================================
-- Migración: 0024_audit_logs_tabla_y_retencion.sql
--
-- CONTEXTO:
--   LogsView.jsx llama a supabase.rpc("get_audit_logs", {...})
--   y useAuth.js llama a supabase.rpc("log_audit_event", {...}).
--   Ambas RPCs y la tabla audit_logs existen en Supabase pero
--   NO estaban documentadas en ninguna migración del repositorio.
--   Un reset de BD desde cero las perdería.
--
-- CONTENIDO:
--   1. Tabla audit_logs (con columnas inferidas del frontend)
--   2. RPC log_audit_event()   — escribe un evento de auditoría
--   3. RPC get_audit_logs()    — lectura paginada con filtros
--   4. Política de retención   — función de limpieza automática
--      (180 días; ejecutar vía pg_cron o cron externo)
--   5. RLS: solo admins leen; escritura solo via RPC DEFINER
--
-- Todas las sentencias son idempotentes (CREATE IF NOT EXISTS /
-- CREATE OR REPLACE) para aplicarse sin riesgo sobre una BD
-- que ya tenga estos objetos.
-- ============================================================

SET search_path TO public;


-- ════════════════════════════════════════════════════════════
-- 1. TABLA: audit_logs
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Usuario que realizó la acción
  user_id           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  email             TEXT,
  nombre            TEXT,

  -- Qué acción se realizó (ej: CREAR_HORARIO, ELIMINAR_DOCENTE)
  accion            TEXT        NOT NULL,

  -- Sobre qué entidad (ej: 'horarios', 'docentes', 'qr_sessions')
  entidad           TEXT,
  entidad_id        TEXT,

  -- Contexto académico
  lapso             TEXT,
  programa_afectado TEXT,
  programa          TEXT,   -- alias usado en vistas de LogsView

  -- Resumen legible para humanos
  resumen           TEXT,

  -- Snapshot de datos antes/después del cambio (para rollback visual)
  datos_antes       JSONB,
  datos_despues     JSONB,

  -- Metadatos técnicos
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS
  'Registro de auditoría de acciones administrativas en SIGMA. '
  'Escrito exclusivamente via RPC log_audit_event() (SECURITY DEFINER). '
  'Retención: 180 días (ver función limpiar_audit_logs_antiguos).';

-- Índices para las consultas de LogsView (filtros + paginación)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_accion
  ON public.audit_logs(accion);

CREATE INDEX IF NOT EXISTS idx_audit_logs_email
  ON public.audit_logs(email);

CREATE INDEX IF NOT EXISTS idx_audit_logs_lapso
  ON public.audit_logs(lapso);

CREATE INDEX IF NOT EXISTS idx_audit_logs_programa
  ON public.audit_logs(programa_afectado);


-- ════════════════════════════════════════════════════════════
-- 2. RLS en audit_logs
--    · INSERT: bloqueado para todos (solo via RPC DEFINER)
--    · SELECT: solo roles con permiso 'ver_logs' o 'superadmin'
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Los admins pueden leer todos los logs
DROP POLICY IF EXISTS "Admins pueden leer audit_logs" ON public.audit_logs;
CREATE POLICY "Admins pueden leer audit_logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    tiene_permiso(auth.uid(), 'puedeVerLogs')
    OR tiene_permiso(auth.uid(), 'puedeVerAuditoria')
  );

-- Nadie puede insertar directamente (solo via log_audit_event)
DROP POLICY IF EXISTS "Sin INSERT directo en audit_logs" ON public.audit_logs;
CREATE POLICY "Sin INSERT directo en audit_logs"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (false);


-- ════════════════════════════════════════════════════════════
-- 3. RPC: log_audit_event()
--    Escribe un evento en audit_logs resolviendo el perfil
--    del usuario autenticado automáticamente.
--    Usada por useAuth.js → logAudit().
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_accion            TEXT,
  p_entidad           TEXT    DEFAULT NULL,
  p_entidad_id        TEXT    DEFAULT NULL,
  p_lapso             TEXT    DEFAULT NULL,
  p_programa_afectado TEXT    DEFAULT NULL,
  p_resumen           TEXT    DEFAULT NULL,
  p_datos_antes       JSONB   DEFAULT NULL,
  p_datos_despues     JSONB   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_email   TEXT;
  v_nombre  TEXT;
BEGIN
  -- Obtener identidad del usuario autenticado
  v_user_id := auth.uid();

  SELECT au.email, up.nombre
    INTO v_email, v_nombre
    FROM auth.users     au
    LEFT JOIN user_profiles up ON up.id = au.id
   WHERE au.id = v_user_id;

  INSERT INTO public.audit_logs (
    user_id, email, nombre,
    accion, entidad, entidad_id,
    lapso, programa_afectado, programa,
    resumen, datos_antes, datos_despues
  ) VALUES (
    v_user_id, v_email, v_nombre,
    p_accion, p_entidad, p_entidad_id,
    p_lapso, p_programa_afectado, p_programa_afectado,
    p_resumen, p_datos_antes, p_datos_despues
  );
END;
$$;

COMMENT ON FUNCTION public.log_audit_event IS
  'Inserta un evento en audit_logs resolviendo automáticamente el perfil '
  'del usuario autenticado. SECURITY DEFINER para bypassear RLS de INSERT. '
  'Llamada por useAuth.js → logAudit() en cada acción administrativa.';

REVOKE ALL    ON FUNCTION public.log_audit_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_event TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 4. RPC: get_audit_logs()
--    Lectura paginada con filtros opcionales.
--    Usada por LogsView.jsx.
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_audit_logs(integer,integer,text,text,text,text);

CREATE OR REPLACE FUNCTION public.get_audit_logs(
  p_limit    INTEGER DEFAULT 50,
  p_offset   INTEGER DEFAULT 0,
  p_email    TEXT    DEFAULT NULL,
  p_accion   TEXT    DEFAULT NULL,
  p_lapso    TEXT    DEFAULT NULL,
  p_programa TEXT    DEFAULT NULL
)
RETURNS SETOF public.audit_logs
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM   public.audit_logs
  WHERE  (p_email    IS NULL OR email             ILIKE '%' || p_email    || '%')
    AND  (p_accion   IS NULL OR accion            =           p_accion)
    AND  (p_lapso    IS NULL OR lapso             =           p_lapso)
    AND  (p_programa IS NULL OR programa_afectado ILIKE '%' || p_programa || '%')
  ORDER  BY created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

COMMENT ON FUNCTION public.get_audit_logs IS
  'Devuelve audit_logs paginados con filtros opcionales por email, acción, '
  'lapso y programa. Usada por LogsView.jsx. SECURITY DEFINER para que '
  'solo usuarios con RLS permitida puedan leer.';

REVOKE ALL    ON FUNCTION public.get_audit_logs FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_logs TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 5. RETENCIÓN: limpiar_audit_logs_antiguos()
--    Elimina registros con más de 180 días.
--
--    Opciones de ejecución:
--      A) pg_cron (si está habilitado en Supabase):
--         SELECT cron.schedule('limpiar-audit-logs',
--           '0 3 * * 0',  -- todos los domingos a las 3 AM UTC
--           $$ SELECT public.limpiar_audit_logs_antiguos(); $$
--         );
--
--      B) Cron externo (GitHub Actions, Vercel Cron, etc.)
--         llamando a la RPC via fetch con SERVICE_ROLE_KEY.
--
--      C) Invocación manual desde el Dashboard de Supabase.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.limpiar_audit_logs_antiguos(
  p_dias_retencion INTEGER DEFAULT 180
)
RETURNS INTEGER   -- cantidad de filas eliminadas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eliminadas INTEGER;
BEGIN
  DELETE FROM public.audit_logs
  WHERE created_at < NOW() - (p_dias_retencion || ' days')::INTERVAL;

  GET DIAGNOSTICS v_eliminadas = ROW_COUNT;

  -- Dejar traza de la limpieza en el propio log de auditoría
  INSERT INTO public.audit_logs (accion, resumen)
  VALUES (
    'LIMPIEZA_AUDIT_LOGS',
    format('Se eliminaron %s registros con más de %s días de antigüedad.',
           v_eliminadas, p_dias_retencion)
  );

  RETURN v_eliminadas;
END;
$$;

COMMENT ON FUNCTION public.limpiar_audit_logs_antiguos IS
  'Elimina registros de audit_logs más antiguos que p_dias_retencion días '
  '(default 180). Devuelve la cantidad de filas eliminadas. '
  'Diseñada para ejecución periódica via pg_cron o cron externo.';

-- Solo superadmins / service_role pueden invocarla
REVOKE ALL    ON FUNCTION public.limpiar_audit_logs_antiguos FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.limpiar_audit_logs_antiguos TO service_role;


-- ── Verificación post-migración ──────────────────────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'audit_logs';
--
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'log_audit_event',
--     'get_audit_logs',
--     'limpiar_audit_logs_antiguos'
--   )
-- ORDER BY routine_name;
--
-- Resultado esperado: tabla 1 fila + 3 funciones.
