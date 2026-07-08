-- ============================================================
-- Migración: 0042_fix_default_id_horarios.sql
--
-- Bug: la tabla particionada public.horarios tiene la columna
-- id (INTEGER, PRIMARY KEY, NOT NULL) SIN ningún default
-- (ni SERIAL ni IDENTITY). Nunca se aplicó en ninguna migración
-- previa (creada directamente en Supabase, igual que otros
-- objetos documentados en 0032).
--
-- Efecto: useUpload.js inserta filas sin especificar "id"
-- (correcto, espera que la BD lo genere). Sin DEFAULT, Postgres
-- intenta insertar NULL -> viola la constraint NOT NULL ->
-- "Error al guardar: null value in column "id" of relation
-- "horarios_lapso_2_2026" violates not-null constraint".
--
-- Fix: convertir id en GENERATED ALWAYS AS IDENTITY. Esto crea
-- una secuencia interna y la asigna como generador del valor.
-- En PostgreSQL 11+, esto se propaga automáticamente a TODAS las
-- particiones existentes y futuras (no se puede tener un default
-- distinto por partición en partitioning declarativo).
--
-- NOTA: si la verificación previa encontró una secuencia
-- huérfana (p.ej. horarios_id_seq) con valores ya usados,
-- AJUSTAR el RESTART WITH abajo antes de correr esta migración,
-- o usar esa secuencia existente en vez de crear una identity
-- nueva (avisar para regenerar este archivo).
-- ============================================================

SET search_path TO public;

ALTER TABLE public.horarios
  ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

-- Ajusta el contador para que arranque después del id máximo
-- ya existente en la tabla (evita colisiones con filas viejas).
DO $$
DECLARE
  v_max_id INTEGER;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO v_max_id FROM public.horarios;
  EXECUTE format(
    'ALTER TABLE public.horarios ALTER COLUMN id RESTART WITH %s',
    v_max_id + 1
  );
END $$;

-- Verificación de seguridad: confirma que el default quedó
-- aplicado tanto en la tabla padre como en todas sus particiones.
DO $$
DECLARE
  v_sin_default TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ')
  INTO v_sin_default
  FROM pg_inherits i
  JOIN pg_class c ON c.oid = i.inhrelid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'id'
  WHERE i.inhparent = 'public.horarios'::regclass
    AND a.atthasdef = false;

  IF v_sin_default IS NOT NULL THEN
    RAISE WARNING 'Particiones sin DEFAULT en id tras la migración: %', v_sin_default;
  END IF;
END $$;
