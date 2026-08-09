-- ============================================================================
-- Migración: 0081_prog3_rls_programa_horarios_asistencias.sql
-- Fecha: 8 de agosto de 2026
--
-- CONTEXTO
-- --------
-- PROG-3 (fase 3, cierre de la serie). Enforcement real en RLS de la
-- restricción por programa, mismo criterio que SEDE-3 (0063) ya aplicó
-- para sede: hasta ahora `puedeVerTodo`/`puedeVerSoloSuPrograma` era
-- pura confianza en el cliente (ver PROG-1, PROG-3 fase 2).
--
-- CORRECCIÓN DE ALCANCE respecto a como quedó anotado en PROG-1/PROG-3
-- fase 1 ("horarios/docentes/materias/asistencias_diarias"): al revisar
-- el esquema real para escribir esta migración, `docentes` y `materias`
-- NO TIENEN columna `programa` -- son catálogos compartidos dentro de
-- una sede, no atados a un programa (un mismo docente dicta en varios
-- programas; ver docs/ESQUEMA_Y_MIGRACIONES.md). Restringirlos por
-- programa no correspondería al modelo de datos real y rompería
-- referencias legítimas entre programas. El aislamiento por programa
-- solo aplica a `horarios` (columna `programa`, NOT NULL) y
-- `asistencias_diarias` (columna `programa`, nullable) -- las dos únicas
-- tablas donde el dato realmente pertenece a un programa concreto.
--
-- FIX 1 -- gap latente en usuario_puede_ver_programa() (PROG-2, 0078)
-- ---------------------------------------------------------------------
-- La función original solo bypasseaba con `puedeVerTodo`. Pero
-- `restringe_programa` (rol) y `puedeVerTodo` (permiso dentro de
-- `roles.permisos`) son campos INDEPENDIENTES en `ModalRol.jsx` -- nada
-- obliga a que un rol con `restringe_programa = false` tenga también
-- `puedeVerTodo = true` en su jsonb de permisos. Mientras
-- usuario_puede_ver_programa() solo se usaba dentro de un
-- `IF v_restringe THEN ... END IF` (PROG-1a, PROG-3 fase 2a), este hueco
-- nunca se manifestó -- ahí solo importaba el caso restringido. Pero
-- esta migración la usa DIRECTO en RLS, para TODAS las filas de
-- horarios/asistencias_diarias, leídas por CUALQUIER rol -- si un rol
-- no restringido tuviera `puedeVerTodo` sin marcar (config real hoy
-- desconocida, vive en la tabla `roles` de la BD, no en migraciones),
-- se quedaría sin ver nada. Se corrige el helper para bypassear también
-- cuando el rol simplemente no restringe programa (`NOT restringe_programa`),
-- sin importar el valor de `puedeVerTodo` -- superset estrictamente más
-- seguro que el original, no le quita acceso a nadie que ya lo tuviera.
--
-- FIX 2 -- RLS real en horarios y asistencias_diarias
-- ------------------------------------------------------
-- `horarios`: se extiende `_aplicar_rls_horarios()` (0063) -- misma
-- función reaplicada a la tabla padre + 7 particiones, mismo patrón que
-- ya usa la serie SEDE-N para no tener que tocar cada partición a mano.
-- SELECT/INSERT/UPDATE se les suma `usuario_puede_ver_programa(programa)`
-- AND'd con lo que ya exigían (permiso + usuario_puede_ver_sede(sede_id)).
-- DELETE también, por completitud (antes solo pedía permiso + sede).
--
-- `asistencias_diarias`: se reemplaza `lee_asistencias_por_permiso`
-- (0064) con el mismo AND agregado. Es SELECT-only por diseño (0036):
-- la única vía de escritura es `registrar_asistencia()`, SECURITY
-- DEFINER, no necesita política de INSERT propia.
-- ============================================================================


-- ── 1. Fix del gap latente en usuario_puede_ver_programa() ──────────────────
CREATE OR REPLACE FUNCTION public.usuario_puede_ver_programa(p_programa text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT
       NOT r.restringe_programa
       OR (r.permisos ->> 'puedeVerTodo') = 'true'
       OR EXISTS (
         SELECT 1 FROM user_profiles_programas upp
         WHERE upp.user_id = up.id AND upp.programa = p_programa
       )
     FROM user_profiles up
     JOIN roles r ON r.nombre = up.rol
     WHERE up.id = auth.uid() AND up.activo = true),
    false
  );
$$;

COMMENT ON FUNCTION public.usuario_puede_ver_programa IS
  'PROG-2/PROG-3. true si el rol del usuario NO restringe_programa, o '
  'tiene puedeVerTodo, o si p_programa está entre los suyos en '
  'user_profiles_programas. La condición NOT restringe_programa (0081) '
  'es la fuente principal de bypass -- puedeVerTodo se conserva por si '
  'algún rol restringido lo tuviera marcado, no como condición única, '
  'porque restringe_programa y puedeVerTodo son campos independientes en '
  'ModalRol.jsx y nada garantiza que vayan siempre de la mano.';


-- ── 2. horarios -- extender _aplicar_rls_horarios() con programa ────────────
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
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa))',
    'Inserción con permiso', p_table_name
  );

  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Actualización con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
    'USING (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa)) '
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa))',
    'Actualización con permiso', p_table_name
  );

  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Borrado con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
    'USING (tiene_permiso(auth.uid(), ''puedeBorrarHorarios'') '
    'AND usuario_puede_ver_sede(sede_id) AND usuario_puede_ver_programa(programa))',
    'Borrado con permiso', p_table_name
  );

  -- Trigger de autocompletado de sede -- sin cambios, solo se re-crea al
  -- reaplicar (mismo criterio que 0063: solo sobre la tabla padre).
  -- No existe (ni hace falta) un trigger equivalente para programa:
  -- a diferencia de sede_id, `programa` siempre viene explícito del
  -- cliente (Excel import / TurnoGrid) y es NOT NULL desde el diseño
  -- original de la tabla -- nunca hubo un valor implícito que autocompletar.
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
  'SEDE-3/PROG-3 (fase 3, 0081): SELECT/INSERT/UPDATE/DELETE exigen '
  'usuario_puede_ver_sede(sede_id) Y usuario_puede_ver_programa(programa), '
  'además del permiso granular correspondiente. Debe aplicarse tanto a la '
  'tabla padre como a cada partición -- no se heredan solas.';

SELECT public._aplicar_rls_horarios('horarios');
SELECT public._aplicar_rls_horarios('horarios_lapso_1_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_2_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_3_2026');
SELECT public._aplicar_rls_horarios('horarios_lapso_1_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_2_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_3_2027');
SELECT public._aplicar_rls_horarios('horarios_lapso_default');


-- ── 3. asistencias_diarias -- mismo AND en la única política (SELECT) ───────
DROP POLICY IF EXISTS "lee_asistencias_por_permiso" ON public.asistencias_diarias;

CREATE POLICY "lee_asistencias_por_permiso"
  ON public.asistencias_diarias FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE  up.id     = auth.uid()
        AND  up.activo = true
    )
    AND (
      tiene_permiso(auth.uid(), 'puedeGestionarQR')
      OR tiene_permiso(auth.uid(), 'puedeVerReporteAsistencias')
    )
    AND usuario_puede_ver_sede(sede_id)
    AND usuario_puede_ver_programa(programa)
  );

COMMENT ON POLICY "lee_asistencias_por_permiso" ON public.asistencias_diarias IS
  'SEDE-3/PROG-3 (fase 3, 0081): agrega usuario_puede_ver_programa(programa) '
  'al chequeo existente. programa es NULLABLE en esta tabla -- una fila con '
  'programa = NULL queda oculta para cualquier rol restringido (no se puede '
  'confirmar que le pertenezca), visible sin cambios para roles sin '
  'restricción.';


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Como usuario SIN restringe_programa (o con puedeVerTodo): SELECT *
--    FROM horarios/asistencias_diarias debe devolver exactamente lo mismo
--    que antes de esta migración (sede sigue siendo el único filtro real).
-- 2. Como usuario restringido a un programa: SELECT * FROM horarios --
--    solo filas de su(s) programa(s) asignado(s) en user_profiles_programas,
--    aunque existan horarios de otros programas en su misma sede.
-- 3. Mismo usuario: intentar INSERT/UPDATE un horario con `programa` fuera
--    de su lista -- debe rechazar (violates row-level security policy).
-- 4. SELECT usuario_puede_ver_programa('cualquier valor') como un rol con
--    restringe_programa = false y puedeVerTodo NO marcado en permisos --
--    debe devolver true (era el gap que corrige el FIX 1 de arriba).
-- 5. asistencias_diarias con programa = NULL: confirmar que un usuario
--    restringido NO la ve, y uno sin restricción sí.
-- ============================================================================
