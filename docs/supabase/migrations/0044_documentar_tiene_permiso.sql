-- ============================================================
-- Migración: 0044_documentar_tiene_permiso.sql
-- Documentar función faltante: tiene_permiso(uuid, text)
-- Detectada durante el fix CRÍTICO de RLS en user_profiles (0043).
-- Igual que _aplicar_rls_horarios y conflictos_horario (0034),
-- esta función existía en producción sin respaldo en el
-- repositorio. Es la función central usada por las políticas
-- RLS de user_profiles (0016) y por numerosas RPCs de gestión
-- de usuarios, roles, logs y horarios.
--
-- CREATE OR REPLACE con la definición exacta tomada de la BD
-- real (verificada via pg_get_functiondef) -> no cambia
-- comportamiento, solo deja la función versionada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tiene_permiso(p_user_id uuid, p_permiso text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT (r.permisos ->> p_permiso) = 'true'
     FROM user_profiles up
     JOIN roles r ON r.nombre = up.rol
     WHERE up.id = p_user_id AND up.activo = true),
    false
  );
$function$;

-- ── Verificación post-migración ──────────────────────────────
-- 1. Confirmar que la definición en el repo coincide con la BD:
--
-- SELECT pg_get_functiondef(oid)
-- FROM pg_proc
-- WHERE proname = 'tiene_permiso' AND pronamespace = 'public'::regnamespace;
--
-- 2. Smoke test (no debe arrojar error, debe devolver true/false):
--
-- SELECT tiene_permiso(auth.uid(), 'puedeGestionarUsuarios');
