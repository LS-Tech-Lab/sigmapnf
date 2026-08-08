-- ============================================================================
-- Migración: 0074_sec34_default_privileges_anon_funciones.sql
-- Fecha: 7 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Fix SEC-34. Causa raíz de `SEC-8` (`0049`), `SEC-9` (`0052`) y `SEC-33`
-- (`0073`): el rol `postgres` (el que usa el SQL Editor de Supabase para
-- crear funciones) tiene configurada una regla de privilegios POR
-- DEFECTO que otorga `EXECUTE` a `anon` automáticamente en TODA función
-- nueva creada en el esquema `public` -- confirmado con:
--
--   SELECT defaclrole::regrole, defaclnamespace::regnamespace,
--          defaclobjtype, defaclacl
--   FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace;
--
--   postgres | public | f | {postgres=X/postgres, anon=X/postgres,
--                             authenticated=X/postgres, service_role=X/postgres}
--
-- Esto explica por qué el mismo patrón ("función nueva sale ejecutable
-- por anon sin que nadie se lo haya otorgado a mano") se ha repetido 3
-- veces en la historia del proyecto -- incluida `contar_docentes_
-- esperados` (`0072`, `UX-33`), cuya propia migración SÍ hace `REVOKE
-- ALL ... FROM PUBLIC` pero salió anon-ejecutable de todos modos: nunca
-- tuvo el privilegio vía `PUBLIC`, lo tenía directo por esta regla.
-- `REVOKE ... FROM PUBLIC` no toca un grant que un rol tiene por fuera
-- del pseudo-rol `PUBLIC`.
--
-- Mismo problema, mismo origen, para el rol `supabase_admin` (aparece
-- con la misma regla en el resultado de `pg_default_acl`).
--
-- IMPORTANTE -- ALCANCE DE ESTA MIGRACIÓN:
-- `ALTER DEFAULT PRIVILEGES` solo afecta objetos creados DESPUÉS de
-- correrla. No es retroactivo -- por eso además de corregir la regla,
-- este archivo revoca puntualmente el `EXECUTE` de `anon` en
-- `contar_docentes_esperados`, la única función ya creada que cayó en
-- este hueco después de `SEC-33` (todas las demás funciones existentes
-- ya se cerraron en `0049`/`0052`/`0071`/`0073`).
-- ============================================================================

-- ── Corrige la regla de raíz para objetos futuros ────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- supabase_admin es un rol interno de Supabase -- confirmado en vivo (7 ago)
-- que el SQL Editor conectado como `postgres` NO tiene permiso para
-- alterar sus privilegios por defecto ("permission denied to change
-- default privileges"). Sin impacto real: ninguna migración de este
-- repo crea funciones bajo ese rol, todas se crean como `postgres`. Se
-- envuelve en un bloque que absorbe ese error específico para que esta
-- migración siga siendo re-corrible de punta a punta sin intervención
-- manual si alguna vez se reconstruye la base desde cero.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'SEC-34: sin permiso para alterar privilegios por defecto de supabase_admin -- se omite (rol interno de Supabase, sin impacto real, ninguna migración crea funciones bajo ese rol)';
END $$;


-- ── Parche puntual: la única función ya creada que cayó en este hueco ───────
DO $$
DECLARE
  v_fn REGPROCEDURE;
BEGIN
  SELECT p.oid::regprocedure INTO v_fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'contar_docentes_esperados';

  IF v_fn IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    RAISE NOTICE 'SEC-34: revocado anon en %', v_fn;
  END IF;
END $$;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Confirmar que la regla de privilegios por defecto ya no incluye a
--    anon para funciones nuevas:
--    SELECT defaclrole::regrole, defaclobjtype, defaclacl
--    FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace;
--    -- Esperado: las filas con defaclobjtype = 'f' ya NO deben mostrar
--    -- "anon=X" en defaclacl (solo postgres/authenticated/service_role).
-- 2. Confirmar contar_docentes_esperados quedó sin anon:
--    SELECT (SELECT array_agg(DISTINCT grantee::text)
--              FROM information_schema.routine_privileges
--             WHERE routine_name = 'contar_docentes_esperados'
--               AND privilege_type = 'EXECUTE');
--    -- Esperado: solo authenticated/postgres/service_role.
-- 3. LA PRUEBA DEFINITIVA -- crear una función de prueba SIN ningún
--    GRANT/REVOKE explícito y confirmar que YA NO sale anon-ejecutable
--    (antes de esta migración, habría salido igual que
--    contar_docentes_esperados):
--    CREATE OR REPLACE FUNCTION public._test_sec34() RETURNS void
--    LANGUAGE sql AS $$ SELECT 1 $$;
--    SELECT (SELECT array_agg(DISTINCT grantee::text)
--              FROM information_schema.routine_privileges
--             WHERE routine_name = '_test_sec34');
--    -- Esperado: sin "anon" en el resultado.
--    DROP FUNCTION public._test_sec34();
-- 4. Confirmar que el flujo real de ContadorSesion (AdminQRPanel.jsx,
--    llama a contar_docentes_esperados ya autenticado como staff) sigue
--    funcionando -- el GRANT a authenticated no se tocó.
-- ============================================================================
