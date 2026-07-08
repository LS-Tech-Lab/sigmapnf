-- =============================================================================
-- Migración 0045 — Fix S1 (auditoría 2026-06-30): UPDATE de horarios sin
-- verificación de permiso a nivel de RLS.
--
-- Diagnóstico completo (más amplio que el hallazgo original del informe,
-- ampliado en dos etapas durante la validación de este fix con una PoC real
-- contra Postgres 16):
--
--   1. La migración 0035 (fix V-1) creó políticas granulares de INSERT y
--      DELETE exigiendo puedeEditarHorarios / puedeBorrarHorarios, pero dejó
--      viva la política "Escritura autenticada" (FOR ALL TO public USING
--      (auth.role() = 'authenticated')). En PostgreSQL, las políticas RLS
--      son PERMISSIVE por defecto y se combinan con OR: si CUALQUIER
--      política aplicable al comando se cumple, la acción se permite. Como
--      "Escritura autenticada" es FOR ALL y solo exige estar autenticado,
--      neutraliza silenciosamente las políticas granulares de INSERT y
--      DELETE (y no existía ninguna para UPDATE).
--
--   2. HALLAZGO CRÍTICO ADICIONAL: la tabla padre particionada
--      `public.horarios` nunca tuvo Row Level Security habilitado sobre sí
--      misma, ni políticas propias — solo se aplicaban en cada partición
--      individual (horarios_lapso_*) vía _aplicar_rls_horarios(). Cuando
--      una consulta se dirige a la tabla lógica padre (que es como
--      Supabase/PostgREST accede SIEMPRE — la app nunca referencia el
--      nombre físico de la partición), PostgreSQL exige que el PADRE
--      también tenga RLS habilitado Y sus propias políticas: las políticas
--      definidas solo en la partición NO se evalúan cuando se accede vía
--      el padre. Sin esto, ninguna política de escritura se aplicaba jamás
--      en producción, sin importar cuán bien escritas estuvieran en las
--      particiones.
--
--   Verificado con PoC contra Postgres 16 (esquema espejo, sin tocar datos
--   reales): un usuario sin puedeEditarHorarios lograba UPDATE/DELETE/
--   INSERT sobre horarios de cualquier programa. Tras el fix completo
--   (RLS + políticas en el padre, reaplicadas también en cada partición),
--   la misma prueba queda bloqueada (0 filas afectadas / error de
--   política), mientras que un usuario con el permiso correcto sigue
--   operando con éxito. La lectura pública (SELECT) no se ve afectada:
--   su política ya era "USING (true)" por diseño y se conserva igual.
--
-- Fix (tres partes, las tres necesarias):
--   1. _aplicar_rls_horarios() se reescribe para ELIMINAR la política
--      "Escritura autenticada" y crear una política de UPDATE granular
--      (puedeEditarHorarios) además de reforzar INSERT/DELETE.
--   2. Se invoca _aplicar_rls_horarios('horarios') sobre la TABLA PADRE
--      —además de las particiones—, algo que nunca se había hecho.
--   3. Se reaplica la función sobre TODAS las particiones existentes
--      (vía pg_inherits, sin hardcodear nombres) para que el fix cubra
--      de inmediato los datos ya cargados, no solo particiones futuras.
-- =============================================================================

-- ── 1. Redefinir _aplicar_rls_horarios ───────────────────────────────────────
-- Función genérica: se usa igual para el padre `horarios` que para cada
-- partición `horarios_lapso_*` — el mismo código, aplicado dos veces.

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

  -- Fix S1: eliminar la política FOR ALL que neutralizaba las políticas
  -- granulares de INSERT/DELETE (ver cabecera de esta migración). Ya no
  -- se recrea bajo ningún nombre: cada comando tiene su propia política
  -- específica más abajo.
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Escritura autenticada', p_table_name
  );

  -- INSERT: requiere permiso granular puedeEditarHorarios
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
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios''))',
    'Inserción con permiso', p_table_name
  );

  -- UPDATE: requiere permiso granular puedeEditarHorarios (NUEVO — Fix S1)
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    'Actualización con permiso', p_table_name
  );
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
    'USING (tiene_permiso(auth.uid(), ''puedeEditarHorarios'')) '
    'WITH CHECK (tiene_permiso(auth.uid(), ''puedeEditarHorarios''))',
    'Actualización con permiso', p_table_name
  );

  -- DELETE: requiere permiso granular puedeBorrarHorarios
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
    'USING (tiene_permiso(auth.uid(), ''puedeBorrarHorarios''))',
    'Borrado con permiso', p_table_name
  );

END;
$function$;

COMMENT ON FUNCTION public._aplicar_rls_horarios IS
  'Aplica RLS estándar a `horarios` o a una de sus particiones por lapso. '
  'INSERT y UPDATE exigen puedeEditarHorarios; DELETE exige puedeBorrarHorarios. '
  'SELECT es público. Debe aplicarse tanto a la tabla padre como a cada '
  'partición: PostgreSQL no evalúa políticas de una partición cuando la '
  'consulta llega por el nombre lógico del padre (así accede siempre '
  'PostgREST) a menos que el padre tenga RLS y políticas propias. '
  'Corrige V-1 (0035) y S1 (0045).';


-- ── 2. Aplicar sobre la tabla PADRE `horarios` (nunca se había hecho) ───────
-- Esta es la corrección de la causa raíz: sin políticas propias en el
-- padre, todo lo que se haga en las particiones es invisible para
-- cualquier consulta hecha vía `horarios` (el único modo real de acceso).

SELECT public._aplicar_rls_horarios('horarios');


-- ── 3. Reaplicar sobre todas las particiones existentes ─────────────────────
-- Sin hardcodear nombres: recorre pg_inherits para cubrir tanto las
-- particiones ya creadas como cualquier lapso futuro, sin mantenimiento
-- manual de esta migración.

DO $$
DECLARE
  v_partition_name text;
BEGIN
  FOR v_partition_name IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'horarios'
      AND p.relnamespace = 'public'::regnamespace
  LOOP
    PERFORM public._aplicar_rls_horarios(v_partition_name);
  END LOOP;
END;
$$;

-- ── Verificación post-migración ──────────────────────────────────────────────
--
-- 1. Confirmar que RLS está habilitado y con políticas propias en el padre:
--
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'horarios';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'horarios' ORDER BY cmd;
-- -- Esperado: relrowsecurity = t, y las 4 políticas
--
-- 2. Confirmar que "Escritura autenticada" ya no existe en ningún nivel:
--
-- SELECT tablename, policyname FROM pg_policies
-- WHERE (tablename = 'horarios' OR tablename LIKE 'horarios_lapso_%')
--   AND policyname = 'Escritura autenticada';
-- -- Resultado esperado: 0 filas
--
-- 3. Confirmar que cada partición tiene exactamente 4 políticas:
--
-- SELECT tablename, cmd, policyname FROM pg_policies
-- WHERE tablename LIKE 'horarios_lapso_%' ORDER BY tablename, cmd;
--
-- 4. Confirmar en vivo, autenticado como un usuario SIN puedeEditarHorarios,
--    consultando por la tabla padre (como hace siempre la app):
--
-- UPDATE horarios SET seccion = 'X' WHERE id = <id_existente>;
-- -- Resultado esperado: 0 rows affected
