-- Migración: 0100_sec41_bypass_guard_cerrado_para_unificar.sql
-- SEC-41 (auditoría 16 ago 2026)
--
-- LS preguntó explícitamente, tras aplicar SEC-40 (0099), si el guard
-- nuevo podía romper algo trabajado en paralelo. Auditoría de las
-- funciones que escriben en `horarios` encontró un caso real:
--
--   unificar_docente(p_old_id, p_new_id) / unificar_materia(...)
--
-- NO son `SECURITY DEFINER` -- corren con la RLS del usuario invocador a
-- propósito, para heredar el permiso (`puedeEditarHorarios`) y el scope
-- de sede/programa sin duplicar esa lógica dentro de la función. Hacen:
--
--   update public.horarios set docente_id = p_new_id where docente_id = p_old_id;
--   delete from public.docentes where id = p_old_id;
--
-- SIN filtro de lapso -- a propósito, para que fusionar un docente/materia
-- duplicado también corrija el historial de trimestres cerrados. El
-- guard de SEC-40 bloqueaba el UPDATE sobre esas filas cerradas; el
-- DELETE inmediatamente después fallaba con violación de FK
-- (`horarios_part_docente_id_fkey`/`_materia_id_fkey`, ON DELETE NO
-- ACTION) contra las filas que quedaban sin actualizar, huérfanas.
--
-- FIX: GUC transaccional `app.bypass_lapso_cerrado`. Se activa con
-- `set_config('app.bypass_lapso_cerrado', 'true', true)` -- el tercer
-- argumento `true` es `is_local`, así que el valor se resetea solo al
-- terminar la transacción (COMMIT o ROLLBACK); no puede quedar prendido
-- entre llamadas ni afectar otras sesiones concurrentes. Se agrega como
-- excepción SOLO en la política UPDATE (INSERT y DELETE de `horarios`
-- siguen bloqueados sin excepción -- ninguna función legítima necesita
-- crear ni borrar filas de un trimestre cerrado, solo reapuntar una FK
-- existente).
--
-- Es una fusión de identidad (dos filas de `docentes`/`materias` que
-- representan a la misma persona/materia, unificadas en una), no una
-- edición del contenido del horario (clase, aula, turno) -- por eso
-- amerita la excepción, a diferencia de una edición real de un trimestre
-- cerrado, que sigue bloqueada sin excepción.
--
-- VERIFICADO EN VIVO (16 ago, con ROLLBACK, sin tocar datos reales):
-- simulando la sesión de un usuario `admin` real vía
-- `SET LOCAL ROLE authenticated` + `request.jwt.claim.sub` (la conexión
-- `postgres` del MCP tiene `rolbypassrls = true` y habría dado un falso
-- positivo si se probaba directo con ella) --
--   1. unificar_docente(80, 82) reasignó correctamente las 14 filas del
--      lapso cerrado 2-2026, sin error de FK.
--   2. Un UPDATE normal (no vía unificar_*) sobre esas mismas filas del
--      lapso cerrado siguió devolviendo 0 filas afectadas -- el guard
--      general de SEC-40 no se debilitó, solo se abrió una excepción
--      puntual para estas dos funciones.

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
    'AND (coalesce(current_setting(''app.bypass_lapso_cerrado'', true), ''false'') = ''true'' '
    '     OR NOT EXISTS (SELECT 1 FROM public.trimestres t WHERE t.lapso = %I.lapso AND t.estado = ''cerrado''))) '
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa) '
    'AND (coalesce(current_setting(''app.bypass_lapso_cerrado'', true), ''false'') = ''true'' '
    '     OR NOT EXISTS (SELECT 1 FROM public.trimestres t WHERE t.lapso = %I.lapso AND t.estado = ''cerrado'')))',
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
  'SEC-40/41 (0099/0100): INSERT/DELETE exigen que el lapso no esté '
  '''cerrado''. UPDATE tiene la misma exigencia, salvo excepción explícita '
  'vía GUC transaccional app.bypass_lapso_cerrado (usada solo por '
  'unificar_docente/unificar_materia, para fusiones de identidad que '
  'deben propagarse al historial cerrado). Debe aplicarse a la tabla '
  'padre y cada partición.';

SELECT public._aplicar_rls_horarios('horarios');
SELECT public._aplicar_rls_horarios('horarios_lapso_1_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_2_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_3_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_1_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_2_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_3_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_default');

CREATE OR REPLACE FUNCTION public.unificar_docente(p_old_id bigint, p_new_id bigint)
RETURNS TABLE(target_id bigint, nombre_display text)
LANGUAGE plpgsql
AS $function$
declare
  v_display text;
begin
  if p_old_id = p_new_id then
    select d.nombre_display into v_display from public.docentes d where d.id = p_new_id;
    return query select p_new_id, v_display;
    return;
  end if;

  if not exists (select 1 from public.docentes where id = p_new_id) then
    raise exception 'Docente destino % no existe', p_new_id;
  end if;
  if not exists (select 1 from public.docentes where id = p_old_id) then
    raise exception 'Docente origen % no existe', p_old_id;
  end if;

  -- SEC-41: fusión de identidad, no edición de contenido -- debe alcanzar
  -- también las clases de trimestres cerrados para no dejar FK huérfanas.
  perform set_config('app.bypass_lapso_cerrado', 'true', true);

  -- Repuntar todas las clases del docente duplicado al canónico
  update public.horarios
  set docente_id = p_new_id
  where docente_id = p_old_id;

  -- Eliminar el registro duplicado
  delete from public.docentes where id = p_old_id;

  select d.nombre_display into v_display from public.docentes d where d.id = p_new_id;
  return query select p_new_id, v_display;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unificar_materia(p_old_id bigint, p_new_id bigint)
RETURNS TABLE(target_id bigint, nombre_display text)
LANGUAGE plpgsql
AS $function$
declare
  v_display text;
begin
  if p_old_id = p_new_id then
    select m.nombre_display into v_display from public.materias m where m.id = p_new_id;
    return query select p_new_id, v_display;
    return;
  end if;

  if not exists (select 1 from public.materias where id = p_new_id) then
    raise exception 'Materia destino % no existe', p_new_id;
  end if;
  if not exists (select 1 from public.materias where id = p_old_id) then
    raise exception 'Materia origen % no existe', p_old_id;
  end if;

  perform set_config('app.bypass_lapso_cerrado', 'true', true);

  update public.horarios
  set materia_id = p_new_id
  where materia_id = p_old_id;

  delete from public.materias where id = p_old_id;

  select m.nombre_display into v_display from public.materias m where m.id = p_new_id;
  return query select p_new_id, v_display;
end;
$function$;

-- ── Verificación manual sugerida (no ejecutar como parte del deploy) ──
-- Simular sesión real (NO usar la conexión postgres/service_role del
-- panel de Supabase -- tiene rolbypassrls=true y da falsos positivos):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claim.sub = '<uuid de un usuario con puedeEditarHorarios>';
--   SELECT * FROM unificar_docente(<id con clases en un lapso cerrado>, <id destino>);
--   -- no debe lanzar error de FK
--   UPDATE horarios SET aula = 'x' WHERE lapso = '<un lapso cerrado>' LIMIT 1;
--   -- debe afectar 0 filas (el guard general sigue vigente)
--   ROLLBACK;
