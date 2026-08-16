-- Migración: 0099_sec40_rls_horarios_bloquea_cerrado.sql
-- SEC-40 (auditoría 16 ago 2026)
--
-- PROBLEMA ORIGINAL: `modoConsulta` (frontend) solo pinta un banner de
-- "solo lectura" cuando el lapso está `cerrado` en `trimestres` -- no
-- bloquea nada. Confirmado contra las políticas RLS reales de `horarios`:
-- "Actualización con permiso" y "Borrado con permiso" solo exigían
-- tiene_permiso(...) + sede/programa, sin mirar `trimestres.estado` en
-- absoluto. Cualquier usuario con `puedeEditarHorarios`/`puedeBorrarHorarios`
-- podía modificar o borrar clases de un trimestre ya cerrado.
--
-- Ya existe el patrón correcto en Asistencias
-- (admin_borrar_asistencias_rango(), migración 0064) -- este fix lleva el
-- mismo criterio ("cerrado = solo lectura") a Horarios, pero SIN repetir
-- el bug relacionado de ASIST-8: en vez de comparar contra el trimestre
-- `estado = 'activo'` (que puede estar mal configurado y dejar un hueco),
-- acá se bloquea directamente si el propio `lapso` de la fila está
-- marcado `cerrado`. Así el guard no depende de cuál trimestre esté
-- marcado activo, solo de si ESTE lapso en particular ya se cerró.
--
-- BUG DETECTADO Y CORREGIDO EN LA MISMA SESIÓN (antes de que este archivo
-- se subiera al repo, pero SÍ llegó a aplicarse un momento en producción
-- -- ver nota abajo): la primera versión escribió el EXISTS como
-- `WHERE t.lapso = lapso` (columna sin calificar). Postgres resuelve un
-- nombre de columna sin calificar contra el scope MÁS CERCANO primero --
-- dentro de la subconsulta correlacionada, ese scope es `trimestres t`,
-- que también tiene una columna `lapso`. Resultado: la condición se
-- evaluó como `t.lapso = t.lapso` (siempre `true`), así que en cuanto
-- existe CUALQUIER trimestre cerrado en la tabla (como 2-2026 ahora
-- mismo), el guard bloqueaba INSERT/UPDATE/DELETE en TODA la tabla
-- `horarios`, sin importar el lapso de la fila -- no solo el cerrado.
-- Esto estuvo activo en producción unos minutos hasta corregirse.
--
-- FIX: calificar explícitamente la columna del lado de la fila externa
-- con el nombre real de la tabla objetivo (`%I.lapso`, sustituido por
-- `p_table_name` vía `format()`) -- en Postgres, el nombre de tabla sin
-- alias explícito ES el alias implícito de esa tabla en el scope de la
-- política, así que `horarios.lapso` (o `horarios_lapso_2_2026.lapso`
-- para cada partición) referencia sin ambigüedad la fila que se está
-- evaluando, no la subconsulta.
--
-- Se bloquean INSERT/UPDATE/DELETE cuando el `lapso` de la fila tiene una
-- fila en `trimestres` con `estado = 'cerrado'`. Un lapso sin fila en
-- `trimestres` (dato viejo previo a la tabla, o error de captura) NO se
-- bloquea -- ausencia de fila no es lo mismo que "cerrado".
--
-- Igual que 0063/0081: `horarios` es partición por lapso -- el guard se
-- agrega en `_aplicar_rls_horarios()` y se reaplica a la tabla padre y
-- a las 7 particiones, porque las políticas no se heredan solas.

CREATE OR REPLACE FUNCTION public._aplicar_rls_horarios(p_table_name text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table_name);

  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Lectura por sede', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
    'USING (usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa))',
    'Lectura por sede', p_table_name
  );

  -- SEC-40: INSERT también respeta "cerrado = solo lectura" -- una
  -- corrección de datos históricos legítima pasa por reabrir el
  -- trimestre (puedeGestionarTrimestres), no por saltarse el guard.
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Inserción con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa) '
    'AND NOT EXISTS (SELECT 1 FROM public.trimestres t WHERE t.lapso = %I.lapso AND t.estado = ''cerrado''))',
    'Inserción con permiso', p_table_name, p_table_name
  );

  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Actualización con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
    'USING (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa) '
    'AND NOT EXISTS (SELECT 1 FROM public.trimestres t WHERE t.lapso = %I.lapso AND t.estado = ''cerrado'')) '
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa) '
    'AND NOT EXISTS (SELECT 1 FROM public.trimestres t WHERE t.lapso = %I.lapso AND t.estado = ''cerrado''))',
    'Actualización con permiso', p_table_name, p_table_name, p_table_name
  );

  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Borrado con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
    'USING (tiene_permiso(auth.uid(), ''puedeBorrarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa) '
    'AND NOT EXISTS (SELECT 1 FROM public.trimestres t WHERE t.lapso = %I.lapso AND t.estado = ''cerrado''))',
    'Borrado con permiso', p_table_name, p_table_name
  );

  IF p_table_name = 'horarios' THEN
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_autocompletar_sede ON public.%I', p_table_name
    );
    EXECUTE format(
      'CREATE TRIGGER trg_autocompletar_sede BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public._autocompletar_sede_id()',
      p_table_name
    );
  END IF;
END;
$function$;

COMMENT ON FUNCTION public._aplicar_rls_horarios IS
  'SEC-40 (0099): además de SEDE-3/PROG-3 (permiso + sede + programa), '
  'INSERT/UPDATE/DELETE ahora exigen que el lapso de LA FILA (calificado '
  'como %I.lapso -- nombre real de la tabla, no un alias, para evitar que '
  'Postgres resuelva `lapso` sin calificar contra la subconsulta '
  '`trimestres t` en vez de la fila externa) NO esté marcado ''cerrado'' '
  'en `trimestres`. Debe aplicarse tanto a la tabla padre como a cada '
  'partición.';

SELECT public._aplicar_rls_horarios('horarios');
SELECT public._aplicar_rls_horarios('horarios_lapso_1_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_2_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_3_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_1_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_2_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_3_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_default');

-- ── Verificación manual sugerida (no ejecutar como parte del deploy) ──
-- 1. Confirmar que la condición quedó calificada contra la tabla, NO
--    contra sí misma (bug detectado en esta misma sesión):
--      SELECT policyname, cmd, qual FROM pg_policies
--      WHERE tablename = 'horarios' AND cmd = 'DELETE';
--    Debe leerse "t.lapso = horarios.lapso", nunca "t.lapso = t.lapso".
-- 2. Como usuario con puedeEditarHorarios, intentar UPDATE sobre una fila
--    de un lapso `cerrado` (ej. 2-2026 ahora mismo) -- debe fallar por
--    RLS (0 filas afectadas).
-- 3. El mismo UPDATE sobre el lapso `activo` (ej. 3-2026) o sobre un
--    lapso sin fila en `trimestres` (dato viejo) SIGUE funcionando.
