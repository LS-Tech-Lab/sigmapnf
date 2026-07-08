-- ============================================================
-- Migración: 0052_sec9_cerrar_grants_anon_utilitarias.sql
--
-- CONTEXTO
-- --------
-- Fix SEC-9. Señalado por transparencia en la sesión de SEC-6/7/8
-- (0049) y confirmado de nuevo al documentar el esquema completo
-- (ESQUEMA_Y_MIGRACIONES.md §4): `get_auth_role`, `get_my_role`,
-- `get_auth_programa` y `get_my_programa` aparecen ejecutables por
-- `anon` en la BD real, sin que ninguna migración les haya otorgado
-- ese acceso — mismo patrón que las 4 funciones cerradas en SEC-8
-- (0049): creadas directo en el SQL Editor de Supabase, nunca
-- versionadas, endurecimiento nunca aplicado.
--
-- Riesgo real: BAJO. Las 4 son de solo lectura, resuelven el rol/
-- programa del `auth.uid()` actual y devuelven NULL/vacío para un
-- caller anónimo (no delegan ninguna decisión de seguridad a su
-- resultado — a diferencia de SEC-8, ninguna es destructiva ni
-- expone datos de otros usuarios). Se cierra de todos modos por el
-- mismo principio de SEC-8: no depender de que `anon` "no tenga
-- motivo" para llamarlas — que no las necesite no significa que
-- deba poder ejecutarlas.
--
-- POR QUÉ ESTA MIGRACIÓN NO ESCRIBE `REVOKE ... ON FUNCTION nombre(...)`
-- CON TIPOS EXPLÍCITOS (a diferencia de 0049):
-- ninguna de las 4 funciones fue creada por una migración en este
-- repo (mismo origen "dashboard" que las de SEC-8), así que no hay
-- fuente versionada de su firma real (cantidad/tipo de argumentos).
-- Adivinar la firma arriesga un `REVOKE`/`GRANT` que no aplique a la
-- función real y falle en silencio o, peor, en un ambiente con una
-- sobrecarga (overload) inesperada, apunte a la función equivocada.
-- En vez de asumir, este bloque resuelve la firma real desde
-- `pg_proc` en el momento de aplicar la migración (mismo criterio
-- de "verificar contra la BD real, no contra lo asumido" que ya
-- rige el resto de este repo) y actúa sobre cada función que
-- efectivamente exista, sea cual sea su firma.
-- ============================================================

DO $$
DECLARE
  v_fn REGPROCEDURE;
  v_nombres TEXT[] := ARRAY['get_auth_role', 'get_my_role', 'get_auth_programa', 'get_my_programa'];
  v_nombre  TEXT;
BEGIN
  FOREACH v_nombre IN ARRAY v_nombres LOOP
    FOR v_fn IN
      SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_nombre
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_fn);
      -- Reafirmar explícitamente el estado correcto (defensa en
      -- profundidad, mismo criterio que 0049): siguen siendo
      -- utilitarias de sesión de uso interno, solo authenticated
      -- las necesita.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
      RAISE NOTICE 'SEC-9: revocado anon / confirmado authenticated en %', v_fn;
    END LOOP;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────
-- SELECT p.proname,
--        p.oid::regprocedure AS firma_real,
--        (SELECT array_agg(DISTINCT grantee::text)
--           FROM information_schema.routine_privileges
--          WHERE routine_name = p.proname AND privilege_type = 'EXECUTE') AS ejecutable_por
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('get_auth_role','get_my_role','get_auth_programa','get_my_programa')
-- ORDER BY p.proname;
-- -- anon NO debe aparecer en ninguna fila; authenticated sí.
-- --
-- -- Si alguna de las 4 no aparece en el resultado, esta migración no
-- -- encontró esa función en la BD (pudo haberse renombrado, eliminado,
-- -- o el nombre real difiere del documentado) — revisar antes de dar
-- -- SEC-9 por cerrado.
