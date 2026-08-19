-- Migration: 0102_arch46_rpc_cerrar_trimestre_idempotente
-- Fecha: 2026-08-18
--
-- Fix ARCH-46 (auditoría E2E, 18 ago): el cierre de trimestre
-- (HistorialView.jsx::handleCerrar) hacía un upsert client-side directo
-- sobre `trimestres` (RLS ya exige 'puedeGestionarTrimestres', eso sigue
-- igual), sin ningún guard de idempotencia server-side. Simulación de
-- concurrencia: dos coordinadores pulsan "Cerrar" para el mismo lapso casi
-- al mismo tiempo -- ninguno de los dos upserts falla, el segundo pisa en
-- silencio cerrado_en/cerrado_por del primero sin que ninguno de los dos
-- lo note. No corrompe datos (el resultado final es igual de válido), pero
-- deja al segundo coordinador creyendo que fue él quien cerró el
-- trimestre, y pierde el rastro de auditoría de quién lo cerró realmente
-- primero.
--
-- Fix: RPC `cerrar_trimestre()` que hace el mismo upsert pero atómicamente
-- (SELECT ... FOR UPDATE antes de escribir, dentro de la misma
-- transacción) y devuelve si el trimestre YA estaba cerrado antes de esta
-- llamada -- así el cliente puede avisar en vez de sobreescribir en
-- silencio. Mismo patrón de permiso/estructura que el resto de RPCs
-- administrativos del proyecto (ver 0086/0089).

CREATE OR REPLACE FUNCTION public.cerrar_trimestre(
  p_lapso        text,
  p_fecha_inicio date DEFAULT NULL::date,
  p_fecha_fin    date DEFAULT NULL::date,
  p_notas        text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_numero          SMALLINT;
  v_anio            SMALLINT;
  v_email_actor     TEXT;
  v_ya_cerrado      BOOLEAN := false;
  v_cerrado_por_ant TEXT;
  v_cerrado_en_ant  TIMESTAMPTZ;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarTrimestres') THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'SIN_PERMISO',
      'mensaje', 'No tienes permiso para cerrar trimestres.'
    );
  END IF;

  IF p_lapso !~ '^[0-9]+-[0-9]{4}$' THEN
    RETURN json_build_object(
      'ok',      false,
      'codigo',  'LAPSO_INVALIDO',
      'mensaje', 'Formato de lapso inválido (esperado NUMERO-AÑO, ej. 2-2026).'
    );
  END IF;

  v_numero := split_part(p_lapso, '-', 1)::smallint;
  v_anio   := split_part(p_lapso, '-', 2)::smallint;

  SELECT email INTO v_email_actor FROM user_profiles WHERE id = auth.uid();

  -- SELECT ... FOR UPDATE: si dos llamadas llegan casi juntas, Postgres
  -- serializa -- la segunda espera a que la primera termine (COMMIT) antes
  -- de leer, así "v_ya_cerrado" refleja el estado real post-primera
  -- llamada, no una lectura sucia de antes de que la primera escribiera.
  SELECT estado = 'cerrado', cerrado_por, cerrado_en
    INTO v_ya_cerrado, v_cerrado_por_ant, v_cerrado_en_ant
  FROM trimestres
  WHERE lapso = p_lapso
  FOR UPDATE;

  INSERT INTO trimestres (lapso, numero, anio, estado, fecha_inicio, fecha_fin, notas, cerrado_en, cerrado_por)
  VALUES (p_lapso, v_numero, v_anio, 'cerrado', p_fecha_inicio, p_fecha_fin, p_notas, now(), v_email_actor)
  ON CONFLICT (lapso) DO UPDATE SET
    estado       = 'cerrado',
    fecha_inicio = EXCLUDED.fecha_inicio,
    fecha_fin    = EXCLUDED.fecha_fin,
    notas        = EXCLUDED.notas,
    cerrado_en   = now(),
    cerrado_por  = v_email_actor;

  RETURN json_build_object(
    'ok',                   true,
    'ya_estaba_cerrado',    COALESCE(v_ya_cerrado, false),
    'cerrado_por_anterior', v_cerrado_por_ant,
    'cerrado_en_anterior',  v_cerrado_en_ant
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cerrar_trimestre(text, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_trimestre(text, date, date, text) TO authenticated;

-- ── Verificación manual sugerida tras aplicar (SQL Editor) ─────────────────
-- 1. Confirmar grants:
--    SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name = 'cerrar_trimestre';
--    -- Esperado: solo authenticated (y postgres/service_role implícitos).
-- 2. Simular la carrera con dos sesiones SQL abriendo transacciones
--    manuales (BEGIN; SELECT cerrar_trimestre('X-2099', ...);) sin COMMIT
--    en la primera, y confirmar que la segunda bloquea hasta el COMMIT/
--    ROLLBACK de la primera en vez de devolver de inmediato.
