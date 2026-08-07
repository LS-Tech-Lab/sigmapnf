-- ============================================================================
-- Migración: 0070_gestion_sedes_permiso_y_rls.sql
-- Fecha: 6 de agosto de 2026
--
-- CONTEXTO
-- --------
-- SEDE-17. La migración 0061 dejó el catálogo `sedes` como solo-lectura
-- a propósito ("altas/bajas de sedes quedan para una RPC futura si hace
-- falta, no son parte de SEDE-1"). A pedido de LS, se agrega esa RPC/RLS
-- ahora: un panel de administración (Sistema → Sedes, `GestionSedes.jsx`)
-- para crear sedes nuevas, renombrarlas, reordenarlas y activar/
-- desactivarlas sin tocar la base de datos a mano.
--
-- DISEÑO
-- ------
-- - Mismo patrón que `puedeConfigurarReportes`/`0056`: permiso granular
--   nuevo (`puedeGestionarSedes`), gateado con `tiene_permiso()`, sin
--   asignación automática a ningún rol — se asigna desde el panel de
--   Usuarios y Roles cuando LS decida a quién. No se asume que sea lo
--   mismo que `puedeVerTodasLasSedes` (0062): una cosa es VER todas las
--   sedes en los reportes, otra ADMINISTRAR el catálogo de sedes en sí.
-- - Solo INSERT/UPDATE, NO DELETE. `sedes.id` tiene FKs entrantes desde
--   `docentes`/`materias`/`horarios`/`qr_sessions`/`asistencias_diarias`/
--   `user_profiles` (0061) — borrar una sede con datos reales rompería
--   esas referencias o requeriría un ON DELETE CASCADE destructivo que
--   nadie pidió. "Dar de baja" una sede es desactivarla (`activa =
--   false`), que ya existe como columna desde 0061 y ya filtra
--   `useSedes.js` -- no hace falta DELETE real para el caso de uso.
-- - `id` (slug) es inmutable una vez creado: se genera en el frontend a
--   partir del nombre (mismo criterio que `roles.nombre`/`sedes.id`
--   existentes: "ciudad_ojeda", "san_francisco") y no se expone campo de
--   edición para no romper las FKs que ya referencian ese id.
-- ============================================================================

-- ── 1. Permiso nuevo (catálogo de frontend, ver GRUPOS_PERMISOS en
--       src/components/usuarios/shared.jsx) — sin asignación automática
--       a ningún rol; se asigna a mano desde Usuarios y Roles ──────────────
-- (No hay UPDATE de public.roles acá — a diferencia de 0062 con
-- puedeVerTodasLasSedes, este permiso NO se otorga por defecto a admin
-- ni a nadie; queda en manos de LS decidir quién lo tiene.)

-- ── 2. RLS de escritura sobre `sedes` ────────────────────────────────────────
CREATE POLICY "sedes_insert_gestion"
  ON public.sedes FOR INSERT
  TO authenticated
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarSedes'));

CREATE POLICY "sedes_update_gestion"
  ON public.sedes FOR UPDATE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeGestionarSedes'))
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarSedes'));

-- A propósito, sin política de DELETE — ver nota de diseño arriba.
-- Sin política de DELETE, RLS deniega cualquier DELETE por defecto
-- (fail-closed, mismo comportamiento que cualquier tabla con RLS
-- habilitado y sin policy para una operación dada).

GRANT INSERT, UPDATE ON public.sedes TO authenticated;

-- ── 3. Validación de `id` (slug) a nivel de constraint ───────────────────────
-- Defensa en profundidad: aunque el frontend genera el slug, un INSERT
-- directo (o un bug futuro) no debería poder colar un id con mayúsculas,
-- espacios o caracteres fuera de [a-z0-9_] -- mismo criterio que
-- `roles.nombre` en su momento.
ALTER TABLE public.sedes
  ADD CONSTRAINT sedes_id_formato_valido
  CHECK (id ~ '^[a-z0-9_]+$');

-- `orden` no puede ser negativo ni nulo -- ya es NOT NULL desde 0061, se
-- suma el CHECK de rango que faltaba.
ALTER TABLE public.sedes
  ADD CONSTRAINT sedes_orden_no_negativo
  CHECK (orden >= 0);


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Confirmar que un usuario SIN puedeGestionarSedes no puede insertar
--    ni actualizar (0 filas afectadas o error, según el cliente):
--    INSERT INTO sedes (id, nombre, orden) VALUES ('test_sede', 'Test', 99);
--    -- Esperado: denegado por RLS.
-- 2. Con un usuario CON el permiso, confirmar que sí puede:
--    - Crear una sede nueva con id en minúsculas/guion_bajo.
--    - Renombrarla y cambiar su orden.
--    - Desactivarla (activa = false) y confirmar que desaparece de
--      useSedes.js (que ya filtra por activa=true) sin romper los datos
--      existentes que la referencian (docentes/horarios de esa sede
--      siguen intactos, solo deja de aparecer en el selector).
-- 3. Confirmar que sigue sin existir política de DELETE:
--    SELECT policyname FROM pg_policies WHERE tablename = 'sedes';
--    -- Esperado: solo sedes_select_authenticated, sedes_insert_gestion,
--    -- sedes_update_gestion. Un DELETE de cualquier usuario debe fallar.
-- 4. Confirmar el CHECK de formato de id:
--    INSERT INTO sedes (id, nombre, orden) VALUES ('Sede Nueva', 'X', 1);
--    -- Esperado: rechazado por sedes_id_formato_valido (mayúscula y
--    -- espacio no permitidos).
-- ============================================================================
