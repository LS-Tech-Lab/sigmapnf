-- ============================================================================
-- Migración: 0063_rls_aislamiento_docentes_materias_horarios.sql
-- Fecha: 5 de agosto de 2026
--
-- CONTEXTO
-- --------
-- SEDE-3. Hasta 0061/0062 las columnas `sede_id` existen pero no se
-- exigían — cualquier usuario autenticado seguía viendo/editando el
-- catálogo completo de todas las sedes. Esta migración cierra ese hueco
-- para `docentes`, `materias` y `horarios`.
--
-- DECISIÓN DE DISEÑO — por qué un TRIGGER y no solo RLS en el INSERT
-- --------------------------------------------------------------------
-- El catálogo `docentes`/`materias` se llena hoy desde varios puntos del
-- frontend (edición manual, importación de Excel, restauración de
-- backup, creación inline desde TurnoGrid — UX-14) y NINGUNO de esos
-- puntos manda `sede_id` todavía porque no existía hasta 0061. Si esta
-- migración exigiera `sede_id` correcto en el `WITH CHECK` del INSERT
-- sin más, cada INSERT que no lo mande fallaría en cuanto se aplique —
-- Excel import, edición de docentes/materias y creación inline
-- quedarían rotos hasta reescribir cada call site (eso es SEDE-5,
-- deliberadamente no resuelto en este mismo paso, ver 0061).
--
-- La salida elegida: un trigger BEFORE INSERT que autocompleta
-- `NEW.sede_id` con la sede del usuario que hace el INSERT cuando el
-- cliente no la mandó explícitamente. En Postgres los triggers BEFORE
-- ROW corren antes de evaluarse el WITH CHECK de RLS para ese INSERT,
-- así que el `WITH CHECK (usuario_puede_ver_sede(sede_id))` de más abajo
-- ve la fila ya con `sede_id` resuelto. Con esto:
--   - Todo el código de escritura existente (que no manda sede_id) sigue
--     funcionando exactamente igual, ahora quedando la fila
--     automáticamente en la sede de quien la creó.
--   - Si el actor no tiene sede fija y tampoco mandó una explícita
--     (caso admin/coordinador general sin sede en el perfil), el INSERT
--     falla con un mensaje claro en vez de insertar con sede_id NULL.
--
-- UPDATE no necesita este trigger: `sede_id` ya quedó fijado al crear
-- la fila, y una edición normal (renombrar, corregir cédula, etc.) no
-- debe poder mover una fila a otra sede — por eso el `WITH CHECK` de
-- UPDATE exige que la sede de la fila (antes Y después del cambio) sea
-- una que el actor puede ver, sin autocompletar nada.
-- ============================================================================


-- ── 1. Helper: ¿el usuario actual puede ver/operar sobre esta sede? ─────────
-- Mismo estilo que tiene_permiso() (0044): SQL, STABLE, SECURITY DEFINER,
-- exige perfil activo. true si tiene puedeVerTodasLasSedes, o si la sede
-- de la fila coincide con la sede fija de su perfil.
CREATE OR REPLACE FUNCTION public.usuario_puede_ver_sede(p_sede_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT
       (r.permisos ->> 'puedeVerTodasLasSedes') = 'true'
       OR up.sede_id = p_sede_id
     FROM user_profiles up
     JOIN roles r ON r.nombre = up.rol
     WHERE up.id = auth.uid() AND up.activo = true),
    false
  );
$$;

COMMENT ON FUNCTION public.usuario_puede_ver_sede IS
  'SEDE-3. true si el usuario autenticado actual tiene puedeVerTodasLasSedes '
  'o si p_sede_id coincide con la sede fija de su perfil (user_profiles.sede_id). '
  'Mismo patrón que tiene_permiso(): SQL/STABLE/SECURITY DEFINER, exige activo=true.';


-- ── 2. Trigger: autocompletar sede_id en INSERT si el cliente no la manda ───
CREATE OR REPLACE FUNCTION public._autocompletar_sede_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sede_perfil text;
BEGIN
  IF NEW.sede_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT sede_id INTO v_sede_perfil FROM user_profiles WHERE id = auth.uid();

  IF v_sede_perfil IS NULL THEN
    RAISE EXCEPTION
      'No se pudo determinar la sede para esta fila: tu perfil no tiene una '
      'sede fija asignada. Si tu rol ve todas las sedes, manda sede_id explícito.';
  END IF;

  NEW.sede_id := v_sede_perfil;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._autocompletar_sede_id IS
  'SEDE-3. BEFORE INSERT: si el INSERT no trae sede_id, lo completa con la '
  'sede fija del perfil de quien inserta. Corre antes del WITH CHECK de RLS. '
  'Aplicado a docentes, materias y horarios (padre + particiones).';

DROP TRIGGER IF EXISTS trg_autocompletar_sede_docentes ON public.docentes;
CREATE TRIGGER trg_autocompletar_sede_docentes
  BEFORE INSERT ON public.docentes
  FOR EACH ROW EXECUTE FUNCTION public._autocompletar_sede_id();

DROP TRIGGER IF EXISTS trg_autocompletar_sede_materias ON public.materias;
CREATE TRIGGER trg_autocompletar_sede_materias
  BEFORE INSERT ON public.materias
  FOR EACH ROW EXECUTE FUNCTION public._autocompletar_sede_id();


-- ── 3. docentes — RLS sede-aware ─────────────────────────────────────────────
-- SELECT deja de ser público: el autocompletado anónimo de /scan pasa a
-- una RPC nueva (buscar_docente_scan, ver 0064) que resuelve la sede
-- desde el token en vez de leer la tabla directo. Sin ese cambio en el
-- mismo despliegue, /scan quedaría sin autocompletado (degradación
-- suave: el docente igual puede escribir su nombre a mano), pero aplicar
-- 0064 junto con esta migración es lo esperado.
DROP POLICY IF EXISTS "lectura_publica_docentes" ON public.docentes;

CREATE POLICY "lee_docentes_por_sede"
  ON public.docentes
  FOR SELECT
  TO authenticated
  USING (usuario_puede_ver_sede(sede_id));

DROP POLICY IF EXISTS "inserta_docentes_por_permiso" ON public.docentes;
CREATE POLICY "inserta_docentes_por_permiso"
  ON public.docentes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (tiene_permiso(auth.uid(), 'puedeEditarDocentes')
      OR tiene_permiso(auth.uid(), 'puedeImportarExcel'))
    AND usuario_puede_ver_sede(sede_id)
  );

DROP POLICY IF EXISTS "actualiza_docentes_por_permiso" ON public.docentes;
CREATE POLICY "actualiza_docentes_por_permiso"
  ON public.docentes
  FOR UPDATE
  TO authenticated
  USING (
    (tiene_permiso(auth.uid(), 'puedeEditarDocentes')
      OR tiene_permiso(auth.uid(), 'puedeImportarExcel'))
    AND usuario_puede_ver_sede(sede_id)
  )
  WITH CHECK (
    (tiene_permiso(auth.uid(), 'puedeEditarDocentes')
      OR tiene_permiso(auth.uid(), 'puedeImportarExcel'))
    AND usuario_puede_ver_sede(sede_id)
  );

DROP POLICY IF EXISTS "borra_docentes_por_permiso" ON public.docentes;
CREATE POLICY "borra_docentes_por_permiso"
  ON public.docentes
  FOR DELETE
  TO authenticated
  USING (
    (tiene_permiso(auth.uid(), 'puedeEditarDocentes')
      OR tiene_permiso(auth.uid(), 'puedeRestaurarBackup'))
    AND usuario_puede_ver_sede(sede_id)
  );


-- ── 4. materias — mismo patrón que docentes ──────────────────────────────────
DROP POLICY IF EXISTS "lectura_publica_materias" ON public.materias;

CREATE POLICY "lee_materias_por_sede"
  ON public.materias
  FOR SELECT
  TO authenticated
  USING (usuario_puede_ver_sede(sede_id));

DROP POLICY IF EXISTS "inserta_materias_por_permiso" ON public.materias;
CREATE POLICY "inserta_materias_por_permiso"
  ON public.materias
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (tiene_permiso(auth.uid(), 'puedeEditarMaterias')
      OR tiene_permiso(auth.uid(), 'puedeImportarExcel'))
    AND usuario_puede_ver_sede(sede_id)
  );

DROP POLICY IF EXISTS "actualiza_materias_por_permiso" ON public.materias;
CREATE POLICY "actualiza_materias_por_permiso"
  ON public.materias
  FOR UPDATE
  TO authenticated
  USING (
    (tiene_permiso(auth.uid(), 'puedeEditarMaterias')
      OR tiene_permiso(auth.uid(), 'puedeImportarExcel'))
    AND usuario_puede_ver_sede(sede_id)
  )
  WITH CHECK (
    (tiene_permiso(auth.uid(), 'puedeEditarMaterias')
      OR tiene_permiso(auth.uid(), 'puedeImportarExcel'))
    AND usuario_puede_ver_sede(sede_id)
  );

DROP POLICY IF EXISTS "borra_materias_por_permiso" ON public.materias;
CREATE POLICY "borra_materias_por_permiso"
  ON public.materias
  FOR DELETE
  TO authenticated
  USING (
    (tiene_permiso(auth.uid(), 'puedeEditarMaterias')
      OR tiene_permiso(auth.uid(), 'puedeRestaurarBackup'))
    AND usuario_puede_ver_sede(sede_id)
  );


-- ── 5. horarios — redefinir _aplicar_rls_horarios() y reaplicarla ───────────
-- Igual que 0045: esta función es la única fuente de verdad para las
-- políticas de `horarios` y se reinvoca sobre el padre y cada partición
-- (y automáticamente sobre cualquier partición nueva que cree
-- `_crear_particion_lapso` a futuro — no hace falta tocar esa función,
-- ya llama a `_aplicar_rls_horarios` internamente).
--
-- SELECT deja de ser público (`TO public`) y pasa a `TO authenticated`
-- con chequeo de sede — confirmado que ningún flujo anónimo lee
-- `horarios` directo (grep sobre src/: todos los callers están en
-- módulos que ya requieren sesión).
CREATE OR REPLACE FUNCTION public._aplicar_rls_horarios(p_table_name text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table_name);

  -- SELECT: SEDE-3 — ya no es público, exige sede
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Lectura pública', p_table_name
  );
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Lectura por sede', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
    'USING (usuario_puede_ver_sede(sede_id))',
    'Lectura por sede', p_table_name
  );

  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Escritura autenticada', p_table_name
  );

  -- INSERT: permiso + sede (sede_id se autocompleta vía trigger si el
  -- cliente no la manda — ver _autocompletar_sede_id más arriba)
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Permitir todo a horarios', p_table_name
  );
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Inserción con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id))',
    'Inserción con permiso', p_table_name
  );

  -- UPDATE: permiso + sede
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Actualización con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
    'USING (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id)) '
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id))',
    'Actualización con permiso', p_table_name
  );

  -- DELETE: permiso + sede
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Enable delete for all users', p_table_name
  );
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Borrado con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
    'USING (tiene_permiso(auth.uid(), ''puedeBorrarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id))',
    'Borrado con permiso', p_table_name
  );

  -- Trigger de autocompletado — igual que docentes/materias. Se dropea/
  -- recrea por nombre fijo en cada tabla (padre + cada partición).
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_autocompletar_sede ON public.%I', p_table_name
  );
  EXECUTE format(
    'CREATE TRIGGER trg_autocompletar_sede BEFORE INSERT ON public.%I '
    'FOR EACH ROW EXECUTE FUNCTION public._autocompletar_sede_id()',
    p_table_name
  );
END;
$function$;

COMMENT ON FUNCTION public._aplicar_rls_horarios IS
  'SEDE-3: SELECT/INSERT/UPDATE/DELETE exigen usuario_puede_ver_sede(sede_id) '
  'además del permiso granular correspondiente. INSERT autocompleta sede_id '
  'vía trigger si el cliente no la manda. Debe aplicarse tanto a la tabla '
  'padre como a cada partición — no se hereda solo.';

-- Reaplicar sobre el padre y las 7 particiones reales (mismo listado que
-- ESQUEMA_Y_MIGRACIONES.md §horarios).
SELECT public._aplicar_rls_horarios('horarios');
SELECT public._aplicar_rls_horarios('horarios_lapso_1_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_2_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_3_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_1_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_2_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_3_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_default');


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Como usuario de sede 'cabimas' (todo el dato actual): SELECT * FROM
--    docentes/materias/horarios debe seguir devolviendo exactamente lo
--    mismo que antes de esta migración (nada cambia visualmente hoy,
--    porque hoy solo existe la sede cabimas).
-- 2. Insertar manualmente una segunda sede de prueba y un docente con
--    sede_id de esa sede — un usuario de 'cabimas' NO debe poder verlo
--    ni editarlo; un usuario con puedeVerTodasLasSedes sí.
-- 3. Insertar un docente SIN mandar sede_id desde un usuario con sede
--    fija -> debe quedar con sede_id = la del usuario (trigger).
-- 4. Insertar un docente sin sede_id desde un usuario con
--    puedeVerTodasLasSedes y sin sede fija en el perfil -> debe
--    RECHAZAR con el mensaje del trigger, no insertar con NULL.
-- 5. SELECT policyname, cmd, roles FROM pg_policies WHERE tablename IN
--    ('docentes','materias','horarios', ...particiones...) — confirmar
--    que ya no queda ninguna política 'TO public'/'TO {public}' en
--    ninguna de estas tablas.
-- 6. Confirmar el trigger en las 8 tablas de horarios (padre + 7):
--    SELECT event_object_table FROM information_schema.triggers
--    WHERE trigger_name = 'trg_autocompletar_sede';
-- ============================================================================
