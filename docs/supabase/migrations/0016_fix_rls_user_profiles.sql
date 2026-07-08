-- ============================================================
-- Migración: 0016_fix_rls_user_profiles.sql
-- Fix #2 — Políticas RLS up_insert / up_update / up_delete
--           asignadas a {public} → corregir a {authenticated}
-- Fix #4 — get_auth_role() causa recursión en RLS de
--           up_update y up_delete → reemplazar por
--           tiene_permiso(auth.uid(), 'puedeGestionarUsuarios')
-- ============================================================

-- ── Eliminar políticas con roles/lógica incorrectos ─────────
DROP POLICY IF EXISTS up_insert ON user_profiles;
DROP POLICY IF EXISTS up_update ON user_profiles;
DROP POLICY IF EXISTS up_delete ON user_profiles;

-- ── up_insert ───────────────────────────────────────────────
-- Solo usuarios autenticados con permiso de gestión pueden
-- insertar perfiles. La restricción va en WITH CHECK.
CREATE POLICY up_insert ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tiene_permiso(auth.uid(), 'puedeGestionarUsuarios')
  );

-- ── up_update ───────────────────────────────────────────────
-- Un usuario puede editar su propio perfil (campos básicos),
-- o un admin puede editar cualquier perfil.
-- get_auth_role() reemplazado por tiene_permiso() para evitar
-- recursión infinita al consultar user_profiles desde RLS.
CREATE POLICY up_update ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = id)
    OR tiene_permiso(auth.uid(), 'puedeGestionarUsuarios')
  );

-- ── up_delete ───────────────────────────────────────────────
-- Solo admins pueden borrar perfiles.
-- get_auth_role() reemplazado por tiene_permiso() por la
-- misma razón que up_update.
CREATE POLICY up_delete ON user_profiles
  FOR DELETE
  TO authenticated
  USING (
    tiene_permiso(auth.uid(), 'puedeGestionarUsuarios')
  );

-- ── Verificación post-migración ─────────────────────────────
-- Ejecutar luego para confirmar que los roles cambiaron:
--
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'user_profiles'
-- ORDER BY policyname;
--
-- Resultado esperado: las 4 políticas deben mostrar
-- {authenticated} en la columna roles.
