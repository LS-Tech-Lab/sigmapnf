-- ============================================================================
-- Migración: 0046_permisos_granulares_docentes_materias.sql
-- Fecha: 2 de julio de 2026
--
-- CONTEXTO
-- --------
-- La auditoría senior de julio 2026 reportó "docentes y materias sin RLS,
-- anon con escritura/borrado completo". Verificado contra la BD real
-- (pg_policies + pg_class), ese diagnóstico era un falso positivo: RLS SÍ
-- está activo en ambas tablas (relrowsecurity = true) y la política de
-- escritura ya exige auth.role() = 'authenticated', por lo que anon ya
-- estaba bloqueado. El auditor solo revisó los archivos de migración
-- versionados; el ENABLE ROW LEVEL SECURITY de estas dos tablas se hizo
-- directo en el dashboard de Supabase y nunca quedó respaldado en el repo
-- (mismo patrón de drift ya documentado en 0044 para tiene_permiso()).
--
-- El problema real, confirmado con:
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--   WHERE tablename IN ('docentes','materias');
-- es más angosto pero sigue siendo un hueco genuino: la política
-- "escritura_admin_docentes" / "escritura_admin_materias" (FOR ALL) solo
-- exige estar autenticado, sin verificar el permiso específico. Cualquier
-- usuario logueado —aunque su rol no tenga puedeEditarDocentes ni
-- puedeEditarMaterias marcado— puede hoy insertar, editar o borrar
-- cualquier docente o materia directo por la API REST, saltándose el
-- control que la UI sí aplica (permisos.puedeEditarDocentes /
-- permisos.puedeEditarMaterias / permisos.puedeImportarExcel /
-- permisos.puedeRestaurarBackup). Es el mismo tipo de hueco ya corregido
-- para horarios (0035/0036/0045) y user_profiles (0043).
--
-- QUÉ NO SE TOCA
-- ---------------
-- Las políticas de lectura ("lectura_publica_docentes" /
-- "lectura_publica_materias", FOR SELECT, USING (true)) se dejan
-- intactas. Son necesarias porque:
--   - src/components/asistencias/DocenteScan/index.jsx hace un SELECT
--     directo a "docentes" sin sesión (rol anon) para autocompletar el
--     nombre del docente por cédula al escanear el QR.
--   - useNombresCache.js y el resto de la app leen el catálogo completo
--     de docentes/materias desde el cliente autenticado.
-- Restringir el SELECT queda fuera del alcance de este fix (afecta
-- columnas visibles, no permisos de escritura) y se deja como mejora
-- separada si se decide en el futuro.
--
-- MAPEO DE PERMISOS USADO (confirmado en el código, no supuesto):
--   INSERT / UPDATE en docentes  -> puedeEditarDocentes  OR puedeImportarExcel
--     (edición manual: src/hooks/useAppData/nameEditing.js vía
--      HorariosLayout.jsx; carga masiva por Excel: useUpload.js)
--   INSERT / UPDATE en materias  -> puedeEditarMaterias  OR puedeImportarExcel
--   DELETE en docentes / materias -> puedeEditarDocentes/puedeEditarMaterias
--     OR puedeRestaurarBackup
--     (usado solo en el fallback de backupActions.js cuando la RPC
--      restaurar_backup no existe; la RPC en sí es SECURITY DEFINER y no
--      depende de estas políticas — ver 0045 y la nota en backupActions.js)
-- ============================================================================

-- ── docentes ────────────────────────────────────────────────────────────

-- Se reemplaza la política "FOR ALL / solo autenticado" por tres políticas
-- granulares por comando, cada una exigiendo el permiso correspondiente.
DROP POLICY IF EXISTS "escritura_admin_docentes" ON public.docentes;

CREATE POLICY "inserta_docentes_por_permiso"
  ON public.docentes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tiene_permiso(auth.uid(), 'puedeEditarDocentes')
    OR tiene_permiso(auth.uid(), 'puedeImportarExcel')
  );

CREATE POLICY "actualiza_docentes_por_permiso"
  ON public.docentes
  FOR UPDATE
  TO authenticated
  USING (
    tiene_permiso(auth.uid(), 'puedeEditarDocentes')
    OR tiene_permiso(auth.uid(), 'puedeImportarExcel')
  )
  WITH CHECK (
    tiene_permiso(auth.uid(), 'puedeEditarDocentes')
    OR tiene_permiso(auth.uid(), 'puedeImportarExcel')
  );

CREATE POLICY "borra_docentes_por_permiso"
  ON public.docentes
  FOR DELETE
  TO authenticated
  USING (
    tiene_permiso(auth.uid(), 'puedeEditarDocentes')
    OR tiene_permiso(auth.uid(), 'puedeRestaurarBackup')
  );

-- ── materias ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "escritura_admin_materias" ON public.materias;

CREATE POLICY "inserta_materias_por_permiso"
  ON public.materias
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tiene_permiso(auth.uid(), 'puedeEditarMaterias')
    OR tiene_permiso(auth.uid(), 'puedeImportarExcel')
  );

CREATE POLICY "actualiza_materias_por_permiso"
  ON public.materias
  FOR UPDATE
  TO authenticated
  USING (
    tiene_permiso(auth.uid(), 'puedeEditarMaterias')
    OR tiene_permiso(auth.uid(), 'puedeImportarExcel')
  )
  WITH CHECK (
    tiene_permiso(auth.uid(), 'puedeEditarMaterias')
    OR tiene_permiso(auth.uid(), 'puedeImportarExcel')
  );

CREATE POLICY "borra_materias_por_permiso"
  ON public.materias
  FOR DELETE
  TO authenticated
  USING (
    tiene_permiso(auth.uid(), 'puedeEditarMaterias')
    OR tiene_permiso(auth.uid(), 'puedeRestaurarBackup')
  );

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Confirmar que ya no queda la política "FOR ALL / solo autenticado" y
--    que las 3 nuevas por tabla están activas:
--
--    SELECT tablename, policyname, cmd, roles, qual, with_check
--    FROM pg_policies
--    WHERE tablename IN ('docentes','materias')
--    ORDER BY tablename, cmd;
--
--    Se esperan 4 filas por tabla: 1 SELECT (lectura_publica_*, sin tocar)
--    + 3 nuevas (INSERT/UPDATE/DELETE por permiso).
--
-- 2. Con la clave anon (sin sesión): el SELECT debe seguir funcionando
--    (necesario para DocenteScan) y cualquier INSERT/UPDATE/DELETE debe
--    seguir siendo rechazado (ya lo era antes de esta migración también).
--
-- 3. Con un usuario autenticado SIN puedeEditarDocentes/puedeEditarMaterias/
--    puedeImportarExcel/puedeRestaurarBackup: un INSERT/UPDATE/DELETE
--    directo a docentes o materias debe ser rechazado (0 rows / error de
--    política) — este es el comportamiento que cambia con esta migración.
--
-- 4. Con un usuario autenticado CON los permisos correspondientes, probar
--    en la app real que estos 3 flujos siguen funcionando sin errores:
--    a) Editar nombre/cédula de un docente y nombre de una materia
--       (permisos.puedeEditarDocentes / puedeEditarMaterias).
--    b) Subir un Excel de horarios (permisos.puedeImportarExcel).
--    c) Restaurar un backup (permisos.puedeRestaurarBackup).
-- ============================================================================
