-- ============================================================
-- Migración: 0043_enable_rls_user_profiles_y_proteger_columnas.sql
-- Fix CRÍTICO detectado por Supabase Advisor: "Policy Exists RLS
--           Disabled" en public.user_profiles. Las políticas
--           (up_select, up_insert, up_update, up_delete) existen
--           desde la migración 0016, pero RLS nunca fue activado
--           en la tabla -> las políticas no se aplicaban.
--
-- Antes de activar RLS, se agrega un trigger que impide que un
-- usuario sin permiso de gestión modifique columnas sensibles
-- (rol, activo, creado_por) en su propia fila vía up_update,
-- ya que esa política no tiene WITH CHECK por columna.
-- ============================================================

-- ── 1. Trigger de protección de columnas sensibles ──────────
CREATE OR REPLACE FUNCTION public.proteger_columnas_sensibles_user_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios') THEN
    IF NEW.rol IS DISTINCT FROM OLD.rol
       OR NEW.activo IS DISTINCT FROM OLD.activo
       OR NEW.creado_por IS DISTINCT FROM OLD.creado_por THEN
      RAISE EXCEPTION
        'No tienes permiso para modificar los campos rol, activo o creado_por.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_columnas_sensibles_user_profiles ON public.user_profiles;

CREATE TRIGGER trg_proteger_columnas_sensibles_user_profiles
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_columnas_sensibles_user_profiles();

-- ── 2. Activar RLS (las 4 políticas ya existen desde 0016) ──
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- ── Verificación post-migración ──────────────────────────────
-- 1. Confirmar que RLS está activo:
--
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relname = 'user_profiles';
--
-- Resultado esperado: relrowsecurity = true
--
-- 2. Confirmar que el trigger existe:
--
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'user_profiles'
--   AND trigger_name = 'trg_proteger_columnas_sensibles_user_profiles';
--
-- Resultado esperado: 1 fila con UPDATE / BEFORE.
--
-- 3. Probar como usuario normal (no admin) que SÍ puede editar
--    su nombre/programa, pero NO puede cambiar su rol:
--
-- UPDATE user_profiles SET nombre = 'Prueba' WHERE id = auth.uid();
-- -- debe funcionar
--
-- UPDATE user_profiles SET rol = 'admin' WHERE id = auth.uid();
-- -- debe lanzar ERROR — No tienes permiso para modificar...
--
-- 4. Probar como admin (con permiso puedeGestionarUsuarios) que
--    sigue pudiendo crear/editar/borrar perfiles de otros usuarios
--    con normalidad desde UsuariosView.jsx.
