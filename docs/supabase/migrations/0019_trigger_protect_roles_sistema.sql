-- ============================================================
-- Migración: 0019_trigger_protect_roles_sistema.sql
-- Fix #10 — Agregar trigger BEFORE DELETE en tabla `roles`
--            que impide borrar filas con es_sistema = true,
--            independientemente de si el intento viene desde
--            la UI, la API de Supabase, o SQL directo.
-- ============================================================


-- ── Función del trigger ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proteger_roles_sistema()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.es_sistema = true THEN
    RAISE EXCEPTION
      'El rol "%" es un rol del sistema y no puede eliminarse. Solo se pueden editar sus permisos.',
      OLD.nombre;
  END IF;
  RETURN OLD;
END;
$$;


-- ── Trigger ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_protect_roles_sistema ON roles;

CREATE TRIGGER trg_protect_roles_sistema
  BEFORE DELETE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION proteger_roles_sistema();


-- ── Verificación post-migración ─────────────────────────────
-- 1. Confirmar que el trigger existe:
--
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'roles'
--   AND trigger_name = 'trg_protect_roles_sistema';
--
-- Resultado esperado: 1 fila con DELETE / BEFORE.
--
-- 2. Probar que bloquea (debe lanzar error):
--
-- DELETE FROM roles WHERE es_sistema = true LIMIT 1;
--
-- Resultado esperado: ERROR — El rol "..." es un rol del
-- sistema y no puede eliminarse.
