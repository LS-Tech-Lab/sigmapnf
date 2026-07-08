-- ============================================================
-- Migración: 0017_drop_fk_duplicada_rol.sql
-- Fix #3 — Eliminar FK duplicada user_profiles_rol_fkey
--
-- La migración 0015 creó user_profiles_rol_fk (correcta),
-- pero no eliminó la FK anterior user_profiles_rol_fkey.
-- La duplicación causó el error PGRST201 que bloqueó el login.
-- ============================================================

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_rol_fkey;

-- ── Verificación post-migración ─────────────────────────────
-- Ejecutar luego para confirmar que solo queda una FK a roles:
--
-- SELECT conname, contype
-- FROM pg_constraint
-- WHERE conrelid = 'user_profiles'::regclass
--   AND contype = 'f';
--
-- Resultado esperado: debe aparecer user_profiles_rol_fk
-- y NO debe aparecer user_profiles_rol_fkey.
