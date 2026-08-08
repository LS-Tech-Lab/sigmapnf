-- ============================================================================
-- 0075_off10_registrar_asistencia_manual.sql
-- ============================================================================
-- FIX OFF-10 (opción C — respaldo manual): cuando un corte llega sin
-- ninguna sesión QR pre-generada disponible (ver opción A / OFF-10 en
-- AdminQRPanel.jsx + useQRSession.js), el admin/coordinador puede registrar
-- asistencia manualmente (cédula + nombre + tipo) sin depender de un token
-- QR. El registro se guarda en IndexedDB (asistencias_manuales_pendientes,
-- ver src/utils/manualAttendanceQueue.js) y se sincroniza al volver la
-- conexión llamando a este RPC.
--
-- Numerada 0075 (no 0071) porque, en el momento de escribirla, ese número
-- ya fue tomado por trabajo paralelo de LS (0071_cierre_politicas_zombi_
-- y_sede_qr_insert.sql, SEC-30/31/32) — detectado al revisar drift contra
-- origin/main antes de entregar, ver AUDITORIA_INDICE.md.
--
-- Diferencias deliberadas respecto a registrar_asistencia():
--   - Solo 'authenticated', nunca 'anon'. Quien sincroniza es el admin ya
--     autenticado (con su propia sesión, ya vencida o no según corresponda),
--     no un docente anónimo escaneando un QR. Esto es justamente lo que
--     evita reabrir la categoría de bypass de permiso/sede que se descartó
--     como "opción B" durante el diseño (ver docs/AUDITORIA_INDICE.md,
--     OFF-10): los permisos y la sede se validan en el momento de la
--     sincronización, contra la sesión real y vigente del admin — no se
--     "pre-autoriza" nada mientras estuvo offline.
--   - REVOKE explícito de 'anon' además de 'PUBLIC' (mismo patrón que
--     SEC-33/0073): SEC-34/0074 corrigió la regla de privilegios por
--     defecto de Postgres que otorgaba EXECUTE a anon automáticamente en
--     toda función nueva, pero esta migración no depende de esa
--     corrección quedando aplicada — el REVOKE es redundante a propósito.
--   - Sin rate-limit por device_fingerprint: no aplica a un flujo operado
--     por un admin autenticado, no a escaneos anónimos masivos.
--   - Permite backdatear la fecha dentro de una ventana corta (7 días),
--     porque el registro se está sincronizando DESPUÉS del corte, no en el
--     momento — a diferencia de crear_qr_session, que exige fecha = hoy.
--   - qr_session_id queda NULL (no hay sesión QR involucrada); se marca
--     device_fingerprint = 'MANUAL:<uuid del admin>' solo para trazabilidad
--     en reportes/auditoría, no para lógica de negocio.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_asistencia_manual(
  p_cedula_docente TEXT,
  p_nombre_docente TEXT,
  p_fecha          DATE,
  p_turno          TEXT,
  p_tipo           TEXT DEFAULT 'ENTRADA',
  p_programa       TEXT DEFAULT NULL,
  p_sede_id        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sede_efectiva TEXT;
  v_nuevo_id      UUID;
  v_tiene_entrada BOOLEAN;
  v_hoy           DATE := fecha_hoy_ve();
BEGIN

  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarQR') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SIN_PERMISO',
      'mensaje', 'Sin permiso para registrar asistencia manualmente.'
    );
  END IF;

  -- Misma resolución de sede que crear_qr_session (0064) — nunca confiar
  -- en p_sede_id salvo para roles con puedeVerTodasLasSedes.
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();

  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'SIN_SEDE',
        'mensaje', 'Tu usuario no tiene una sede asignada. Contacta a un administrador.'
      );
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'SEDE_REQUERIDA',
        'mensaje', 'Selecciona una sede antes de registrar asistencia manual.'
      );
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  IF p_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TIPO_INVALIDO',
      'mensaje', 'El tipo de registro debe ser ENTRADA o SALIDA.'
    );
  END IF;

  IF p_turno NOT IN ('DIURNO','VESPERTINO','MIXTO','NOCTURNO') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'TURNO_INVALIDO',
      'mensaje', 'El turno debe ser DIURNO, VESPERTINO, MIXTO o NOCTURNO.'
    );
  END IF;

  IF p_fecha > v_hoy OR p_fecha < v_hoy - INTERVAL '7 days' THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'FECHA_INVALIDA',
      'mensaje', 'La fecha del registro manual debe estar dentro de los últimos 7 días.'
    );
  END IF;

  -- Mismo requisito que registrar_asistencia: no se puede marcar SALIDA
  -- sin una ENTRADA previa el mismo día, en la misma sede.
  IF p_tipo = 'SALIDA' THEN
    SELECT EXISTS (
      SELECT 1 FROM asistencias_diarias
      WHERE cedula_docente = p_cedula_docente
        AND fecha          = p_fecha
        AND sede_id        = v_sede_efectiva
        AND tipo           = 'ENTRADA'
    ) INTO v_tiene_entrada;

    IF NOT v_tiene_entrada THEN
      RETURN json_build_object(
        'ok',      false,
        'codigo',  'SIN_ENTRADA_PREVIA',
        'mensaje', 'No se encontró un registro de entrada ese día para este docente. Registra primero la entrada.'
      );
    END IF;
  END IF;

  INSERT INTO asistencias_diarias (
    cedula_docente, nombre_docente, fecha, turno, programa,
    qr_session_id, device_fingerprint, tipo, sede_id
  )
  VALUES (
    p_cedula_docente, p_nombre_docente, p_fecha, p_turno, p_programa,
    NULL, 'MANUAL:' || auth.uid()::text, p_tipo, v_sede_efectiva
  )
  ON CONFLICT (cedula_docente, fecha, tipo) DO NOTHING
  RETURNING id INTO v_nuevo_id;

  IF v_nuevo_id IS NULL THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  CASE WHEN p_tipo = 'SALIDA' THEN 'YA_REGISTRADO_SALIDA' ELSE 'YA_REGISTRADO' END,
      'mensaje', CASE WHEN p_tipo = 'SALIDA'
                       THEN 'La salida de este docente ya estaba registrada ese día.'
                       ELSE 'La entrada de este docente ya estaba registrada ese día.' END
    );
  END IF;

  RETURN json_build_object(
    'ok',            true,
    'tipo',          p_tipo,
    'mensaje',       'Registro manual guardado correctamente.',
    'asistencia_id', v_nuevo_id
  );

END;
$$;

-- Solo 'authenticated' — nunca 'anon'. REVOKE explícito de anon además de
-- PUBLIC (patrón SEC-33/0073): no depender de que la corrección de
-- privilegios por defecto de SEC-34/0074 esté aplicada en el entorno
-- donde corra esta migración. Ver nota al inicio del archivo.
REVOKE ALL    ON FUNCTION public.registrar_asistencia_manual(TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.registrar_asistencia_manual(TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_asistencia_manual(TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.registrar_asistencia_manual(TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT) IS
  'OFF-10 (opción C): registro de asistencia sin token/sesión QR, para cuando '
  'un corte de red no deja ninguna sesión pre-generada disponible. Solo '
  'authenticated; permisos y sede se validan en el momento de sincronizar, '
  'contra la sesión real del admin — no hay bypass ni pre-autorización.';
