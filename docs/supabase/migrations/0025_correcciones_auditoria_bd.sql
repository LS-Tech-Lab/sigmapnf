-- ============================================================
-- Migración: 0025_correcciones_auditoria_bd.sql
--
-- Correcciones derivadas de la auditoría de BD (Junio 2026).
-- Todas son idempotentes (DROP IF EXISTS / CREATE OR REPLACE).
--
-- ORDEN DE APLICACIÓN (de más a menos seguro):
--   Bloque 1 — C2: audit_logs al_insert             (seguro)
--   Bloque 2 — C3: políticas zombi get_auth_role()  (seguro)
--   Bloque 3 — A3: índices redundantes              (seguro)
--   Bloque 4 — C1: escritura anónima horarios/docs  (seguro)
--   Bloque 5 — A2: log_audit_event + rol/programa   (seguro)
--   Bloque 6 — M1: up_select para admins            (seguro)
--   Bloque 7 — M2: trimestres write con permiso     (seguro)
--   Bloque 8 — M3: qr_sessions INSERT con permiso   (seguro)
--
-- ⚠️  BLOQUE 9 — A1: horario_docente_hoy con lapso
--   VERIFICAR ANTES DE APLICAR:
--   SELECT lapso, estado FROM trimestres;
--   Debe haber al menos una fila con estado = 'activo'.
--   Si no hay, esta corrección devolvería [] para todos los
--   docentes al escanear QR. Aplicar por separado.
-- ============================================================

SET search_path TO public;


-- ════════════════════════════════════════════════════════════
-- BLOQUE 1 — C2
-- audit_logs: eliminar política que permite inserción directa
-- ════════════════════════════════════════════════════════════

-- Cualquier usuario autenticado podía insertar filas con su
-- propio user_id, falsificando el historial de auditoría.
-- La política correcta "Sin INSERT directo en audit_logs"
-- (WITH CHECK false) ya existe y se mantiene.
DROP POLICY IF EXISTS "al_insert" ON public.audit_logs;


-- ════════════════════════════════════════════════════════════
-- BLOQUE 2 — C3
-- Eliminar políticas que usan get_auth_role() (sistema viejo)
-- ════════════════════════════════════════════════════════════

-- audit_logs: 3 SELECT policies activas = OR entre las 3.
-- al_select y ver_auditoria usan el sistema antiguo de roles.
-- Se mantiene solo "Admins pueden leer audit_logs" (tiene_permiso).
DROP POLICY IF EXISTS "al_select"     ON public.audit_logs;
DROP POLICY IF EXISTS "ver_auditoria" ON public.audit_logs;

-- session_logs: sl_select usa get_auth_role() hardcodeado.
-- Se mantiene "ver_logs_sesion" (tiene_permiso).
DROP POLICY IF EXISTS "sl_select" ON public.session_logs;

-- login_attempts: la_select usa get_auth_role() hardcodeado.
-- Se reemplaza por política con tiene_permiso().
DROP POLICY IF EXISTS "la_select"       ON public.login_attempts;
DROP POLICY IF EXISTS "la_select_nuevo" ON public.login_attempts;
CREATE POLICY "la_select_nuevo" ON public.login_attempts
  FOR SELECT TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeVerLogs'));


-- ════════════════════════════════════════════════════════════
-- BLOQUE 3 — A3
-- Eliminar índices redundantes
-- ════════════════════════════════════════════════════════════

-- docentes: dos UNIQUE sobre nombre_raw + un no-unique encima
-- Un UNIQUE ya actúa como índice; los otros son peso muerto.
DROP INDEX IF EXISTS public.docentes_nombre_raw_uq;   -- duplicado de docentes_nombre_raw_key
DROP INDEX IF EXISTS public.idx_docentes_nombre_raw;  -- redundante con cualquier UNIQUE

-- materias: igual que docentes
DROP INDEX IF EXISTS public.materias_nombre_raw_uq;   -- duplicado de materias_nombre_raw_key

-- session_logs: dos índices idénticos en user_id
DROP INDEX IF EXISTS public.idx_session_logs_user;    -- duplicado de idx_session_logs_user_id


-- ════════════════════════════════════════════════════════════
-- BLOQUE 4 — C1
-- Eliminar políticas de escritura/borrado anónimo en horarios
-- y docentes. La escritura autenticada ya existe y se mantiene.
-- ════════════════════════════════════════════════════════════

-- horarios (tabla padre + todas las particiones)
DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios;

DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios_lapso_1_2026;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios_lapso_1_2026;

DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios_lapso_2_2026;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios_lapso_2_2026;

DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios_lapso_3_2026;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios_lapso_3_2026;

DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios_lapso_1_2027;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios_lapso_1_2027;

DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios_lapso_2_2027;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios_lapso_2_2027;

DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios_lapso_3_2027;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios_lapso_3_2027;

DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios_lapso_default;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios_lapso_default;

DROP POLICY IF EXISTS "Enable delete for all users" ON public.horarios_old;
DROP POLICY IF EXISTS "Permitir todo a horarios"    ON public.horarios_old;

-- docentes: dos políticas duplicadas de lectura + escritura abierta
DROP POLICY IF EXISTS "Enable read access for all users"  ON public.docentes;
DROP POLICY IF EXISTS "Enable write access for all users" ON public.docentes;
-- Se mantienen: "lectura_publica_docentes" y "escritura_admin_docentes"


-- ════════════════════════════════════════════════════════════
-- BLOQUE 5 — A2
-- log_audit_event: agregar rol y programa del usuario
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
  v_user_id  UUID;
  v_email    TEXT;
  v_nombre   TEXT;
  v_rol      TEXT;
  v_programa TEXT;
BEGIN
  v_user_id := auth.uid();

  SELECT au.email, up.nombre, up.rol, up.programa
    INTO v_email, v_nombre, v_rol, v_programa
    FROM auth.users      au
    LEFT JOIN user_profiles up ON up.id = au.id
   WHERE au.id = v_user_id;

  INSERT INTO public.audit_logs (
    user_id, email, nombre, rol, programa,
    accion, entidad, entidad_id,
    lapso, programa_afectado,
    resumen, datos_antes, datos_despues
  ) VALUES (
    v_user_id, v_email, v_nombre, v_rol, v_programa,
    p_accion, p_entidad, p_entidad_id,
    p_lapso, p_programa_afectado,
    p_resumen, p_datos_antes, p_datos_despues
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.log_audit_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_event TO authenticated;


-- ════════════════════════════════════════════════════════════
-- BLOQUE 6 — M1
-- user_profiles: agregar SELECT para gestores de usuarios
-- ════════════════════════════════════════════════════════════

-- up_select actual solo permite ver el propio perfil.
-- Reemplazar por versión que también permite a gestores ver todos.
DROP POLICY IF EXISTS "up_select"       ON public.user_profiles;
DROP POLICY IF EXISTS "up_select_admin" ON public.user_profiles;

CREATE POLICY "up_select" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = id)
    OR tiene_permiso(auth.uid(), 'puedeGestionarUsuarios')
  );


-- ════════════════════════════════════════════════════════════
-- BLOQUE 7 — M2
-- trimestres: requerir permiso específico para escritura
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Actualizacion autenticada trimestres" ON public.trimestres;
DROP POLICY IF EXISTS "Insercion autenticada trimestres"     ON public.trimestres;
DROP POLICY IF EXISTS "trimestres_write"                     ON public.trimestres;

CREATE POLICY "trimestres_write" ON public.trimestres
  FOR ALL TO authenticated
  USING     (tiene_permiso(auth.uid(), 'puedeGestionarTrimestres'))
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarTrimestres'));


-- ════════════════════════════════════════════════════════════
-- BLOQUE 8 — M3
-- qr_sessions INSERT: reemplazar roles hardcodeados por permiso
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "solo_hoy_insert_qr_sessions" ON public.qr_sessions;

CREATE POLICY "solo_hoy_insert_qr_sessions" ON public.qr_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    fecha = fecha_hoy_ve()
    AND tiene_permiso(auth.uid(), 'puedeGestionarQR')
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND activo = true
    )
  );


-- ════════════════════════════════════════════════════════════
-- ⚠️  BLOQUE 9 — A1  ← APLICAR POR SEPARADO
-- horario_docente_hoy: filtrar por lapso activo
--
-- ANTES DE EJECUTAR ESTE BLOQUE:
--   SELECT lapso, estado FROM trimestres;
--   → Debe existir al menos una fila con estado = 'activo'
--   → Si no hay, comentar este bloque y aplicarlo después
--      de activar el trimestre correspondiente.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.horario_docente_hoy(p_cedula text, p_dia text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'materia',  h.clase,
        'sheet',    h.sheet,
        'hora',     h.hora,
        'trayecto', h.trayecto,
        'programa', h.programa,
        'aula',     h.aula
      )
      ORDER BY h.hora
    ),
    '[]'::json
  )
  FROM   horarios h
  JOIN   docentes  d ON d.id    = h.docente_id
  JOIN   trimestres t ON t.lapso = h.lapso AND t.estado = 'activo'
  WHERE  d.cedula = p_cedula
    AND  h.dia    = p_dia;
$$;


-- ════════════════════════════════════════════════════════════
-- Verificación post-migración (ejecutar luego, por separado)
-- ════════════════════════════════════════════════════════════
--
-- 1. Confirmar que no quedan políticas peligrosas:
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND policyname IN (
--     'al_insert', 'al_select', 'ver_auditoria',
--     'sl_select', 'la_select',
--     'Enable delete for all users',
--     'Enable write access for all users',
--     'Permitir todo a horarios',
--     'Enable read access for all users'
--   );
-- → Debe devolver 0 filas.
--
-- 2. Confirmar índices eliminados:
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname IN (
--     'docentes_nombre_raw_uq', 'idx_docentes_nombre_raw',
--     'materias_nombre_raw_uq', 'idx_session_logs_user'
--   );
-- → Debe devolver 0 filas.
