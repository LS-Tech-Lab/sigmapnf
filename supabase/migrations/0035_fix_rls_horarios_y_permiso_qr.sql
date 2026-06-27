-- =============================================================================
-- Migración 0035 — Correcciones críticas de seguridad (Auditoría Junio 2026)
--
-- V-1: _aplicar_rls_horarios() — INSERT y DELETE sin restricción de permiso.
--      Cualquier usuario autenticado podía borrar/insertar horarios de cualquier
--      programa saltando la RPC borrar_horarios() que sí verifica permisos.
--      Fix: INSERT requiere puedeEditarHorarios; DELETE requiere puedeBorrarHorarios.
--
-- V-4: crear_qr_session() — Solo validaba rol 'authenticated'.
--      Cualquier usuario autenticado podía crear sesiones QR desde la consola.
--      Fix: guard IF NOT tiene_permiso(..., 'puedeGestionarQR') al inicio.
-- =============================================================================


-- ── V-1 ── _aplicar_rls_horarios ─────────────────────────────────────────────
-- Reescribe la función para que INSERT y DELETE exijan permisos granulares
-- de la tabla `roles`, en lugar de permitir todo a cualquier autenticado.
-- SELECT sigue siendo público (lectura abierta).
-- ALL (UPDATE) sigue siendo para autenticados (sin cambio funcional).

CREATE OR REPLACE FUNCTION public._aplicar_rls_horarios(p_table_name text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table_name);

  -- SELECT: lectura pública sin cambios
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Lectura pública', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR SELECT TO public USING (true)',
    'Lectura pública', p_table_name
  );

  -- ALL (UPDATE): usuarios autenticados sin cambios
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Escritura autenticada', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO public USING (auth.role() = ''authenticated'')',
    'Escritura autenticada', p_table_name
  );

  -- INSERT: requiere permiso granular puedeEditarHorarios
  -- (antes: WITH CHECK (true) — cualquier autenticado podía insertar)
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Permitir todo a horarios', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios''))',
    'Inserción con permiso', p_table_name
  );

  -- DELETE: requiere permiso granular puedeBorrarHorarios
  -- (antes: USING (true) — cualquier autenticado podía borrar)
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Enable delete for all users', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
    'USING (tiene_permiso(auth.uid(), ''puedeBorrarHorarios''))',
    'Borrado con permiso', p_table_name
  );

END;
$function$;

COMMENT ON FUNCTION public._aplicar_rls_horarios IS
  'Aplica RLS estándar a una tabla de horarios dinámica (partición por lapso). '
  'INSERT exige puedeEditarHorarios; DELETE exige puedeBorrarHorarios. '
  'Corrige V-1 de auditoría de seguridad Junio 2026.';


-- ── V-4 ── crear_qr_session — guard de permiso puedeGestionarQR ──────────────
-- Versión anterior (0013) solo validaba turno y fecha.
-- Cualquier usuario autenticado podía invocar la RPC directamente.
-- Se añade el guard al inicio: si el usuario no tiene puedeGestionarQR → error.

CREATE OR REPLACE FUNCTION public.crear_qr_session(
  p_turno    TEXT,
  p_programa TEXT    DEFAULT NULL,
  p_fecha    DATE    DEFAULT CURRENT_DATE,
  p_ttl_min  INTEGER DEFAULT 5
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hoy          DATE := fecha_hoy_ve();
  v_nueva_sesion qr_sessions%ROWTYPE;
BEGIN

  -- ── NUEVO: Verificar permiso puedeGestionarQR ────────────────────
  -- Corrige V-4: antes solo GRANT EXECUTE TO authenticated protegía
  -- esta función, lo que permitía a cualquier usuario autenticado
  -- crear sesiones QR directamente desde consola/DevTools.
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarQR') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SIN_PERMISO',
      'mensaje', 'Sin permiso para gestionar sesiones QR.'
    );
  END IF;

  -- ── Validar turno ────────────────────────────────────────────────
  IF p_turno NOT IN ('DIURNO','VESPERTINO','NOCTURNO') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TURNO_INVALIDO',
      'mensaje', 'El turno debe ser DIURNO, VESPERTINO o NOCTURNO.'
    );
  END IF;

  -- ── Validar que la fecha sea hoy en Venezuela ────────────────────
  IF p_fecha <> v_hoy THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'FECHA_INVALIDA',
      'mensaje', 'Solo se puede crear una sesión QR para la fecha de hoy ('
                 || to_char(v_hoy, 'DD/MM/YYYY') || ').'
    );
  END IF;

  -- Desactivar sesiones previas activas del mismo contexto
  UPDATE qr_sessions
  SET    activa = false
  WHERE  fecha    = p_fecha
    AND  turno    = p_turno
    AND  (programa = p_programa OR (programa IS NULL AND p_programa IS NULL))
    AND  activa   = true;

  -- Crear nueva sesión
  INSERT INTO qr_sessions (fecha, turno, programa, creado_por, expires_at)
  VALUES (
    p_fecha,
    p_turno,
    p_programa,
    auth.uid(),
    now() + (p_ttl_min || ' minutes')::INTERVAL
  )
  RETURNING * INTO v_nueva_sesion;

  RETURN json_build_object(
    'ok',         true,
    'session_id', v_nueva_sesion.id,
    'token',      v_nueva_sesion.token,
    'expires_at', v_nueva_sesion.expires_at
  );

END;
$$;

COMMENT ON FUNCTION public.crear_qr_session IS
  'Crea una nueva sesión QR. '
  'Requiere permiso puedeGestionarQR (corrige V-4, auditoría Junio 2026). '
  'Invalida sesiones previas del mismo día/turno/programa. '
  'Rechaza si la fecha solicitada no es hoy en Venezuela (America/Caracas).';
