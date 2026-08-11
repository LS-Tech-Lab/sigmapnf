-- Migration: 0086_fix_registrar_asistencia_manual_on_conflict_sede_id
-- Fecha: 2026-08-10
--
-- Renumerada de 0082b a 0086 (10 ago, auditoría de estrés operacional):
-- mismo motivo que 0085 (colisión de prefijo con 0082_sec35_36 y con
-- lo que hoy es 0085_fix_registrar_asistencia_on_conflict_sede_id,
-- ambas de sesiones distintas) — contenido sin cambios, ya aplicado en
-- producción bajo el nombre viejo.
--
-- Mismo bug que 0082 (registrar_asistencia), encontrado durante la
-- auditoria posterior: registrar_asistencia_manual() tenia el mismo
-- ON CONFLICT (cedula_docente, fecha, tipo) desactualizado. Se agrega
-- sede_id al target para que calce con uq_asistencia_docente_dia_tipo_sede.
--
-- Ya aplicado en produccion (Supabase project fcrrtpujuncxruwxpckq) el
-- 2026-08-10. Esta migracion sincroniza el repo.

CREATE OR REPLACE FUNCTION public.registrar_asistencia_manual(p_cedula_docente text, p_nombre_docente text, p_fecha date, p_turno text, p_tipo text DEFAULT 'ENTRADA'::text, p_programa text DEFAULT NULL::text, p_sede_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- FIX (post-mortem 2026-08-10): mismo bug que registrar_asistencia().
  INSERT INTO asistencias_diarias (
    cedula_docente, nombre_docente, fecha, turno, programa,
    qr_session_id, device_fingerprint, tipo, sede_id
  )
  VALUES (
    p_cedula_docente, p_nombre_docente, p_fecha, p_turno, p_programa,
    NULL, 'MANUAL:' || auth.uid()::text, p_tipo, v_sede_efectiva
  )
  ON CONFLICT (sede_id, cedula_docente, fecha, tipo) DO NOTHING
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
$function$;
