-- =============================================================================
-- Migración 0057 — ARCH-29: bloqueo optimista en edición de horarios
--
-- `horarios.update(payload).eq("id", id)` (horarioEditing.js) no verificaba
-- si la fila había cambiado entre el momento en que el modal se abrió y el
-- momento del guardado. Dos coordinadores editando el mismo bloque al mismo
-- tiempo (cierre de periodo con varios operadores) terminaban en
-- last-write-wins silencioso: el segundo UPDATE pisaba al primero sin
-- ningún error ni registro del conflicto.
--
-- FIX
-- ---
-- Columna `updated_at` + trigger que la refresca server-side en cada
-- UPDATE. El frontend ahora condiciona su UPDATE a
-- `.eq("updated_at", <valor con el que se cargó el formulario>)`; si la
-- fila cambió mientras tanto, el UPDATE devuelve 0 filas afectadas y el
-- frontend lo detecta como conflicto en vez de sobreescribir (ver
-- horarioEditing.js y UX-24 para el aviso al usuario).
--
-- La columna se refresca por trigger, no por el cliente, a propósito: si
-- el cliente pudiera mandar `updated_at` en el payload, cualquiera podría
-- "ganar" la carrera enviando el valor que quisiera.
--
-- PROPAGACIÓN A PARTICIONES
-- --------------------------
-- `horarios` está particionada por `lapso` (7 particiones reales, ver
-- ESQUEMA_Y_MIGRACIONES.md). A diferencia de RLS —que si necesita
-- aplicarse partición por partición, ver `_aplicar_rls_horarios()`—,
-- tanto `ALTER TABLE ... ADD COLUMN` como un trigger `FOR EACH ROW`
-- creados sobre la tabla particionada PADRE se propagan automáticamente
-- a todas sus particiones (declarativas, `PARTITION OF`), existentes y
-- futuras — comportamiento estándar de Postgres 11+, no requiere loop
-- ni helper adicional. `asegurar_particion_lapso()` sigue creando
-- particiones nuevas con `CREATE TABLE ... PARTITION OF public.horarios`
-- (ver 0032), así que cualquier partición futura hereda columna y
-- trigger sin tocar esa función.
-- =============================================================================


-- ── 1. Columna updated_at ─────────────────────────────────────────────────
-- DEFAULT now() se evalúa UNA VEZ para las filas ya existentes (no por
-- fila) — todas las filas actuales quedan con el mismo timestamp de esta
-- migración, que es la semántica correcta: "sin ediciones registradas
-- desde que existe el bloqueo optimista".
ALTER TABLE public.horarios
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.horarios.updated_at IS
  'Se actualiza automáticamente en cada UPDATE via trigger '
  'trg_horarios_set_updated_at (función set_updated_at()) — nunca la '
  'escribe el cliente directamente. Usada por horarioEditing.js para '
  'bloqueo optimista (Fix ARCH-29): el UPDATE se condiciona a '
  '.eq("updated_at", <valor con el que se cargó el formulario>).';


-- ── 2. Función de trigger ─────────────────────────────────────────────────
-- Genérica a propósito (no hardcodea "horarios"): cualquier tabla futura
-- con el mismo problema puede reusarla en vez de duplicar la lógica.
-- SECURITY INVOKER (default) alcanza — solo lee/escribe la fila NEW del
-- propio statement, no necesita privilegios elevados.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at IS
  'Trigger genérico BEFORE UPDATE: fuerza updated_at = now() en cada '
  'fila modificada, ignorando cualquier valor que el cliente intente '
  'mandar en esa columna dentro del payload. Usada por horarios (ARCH-29).';


-- ── 3. Trigger sobre la tabla padre ───────────────────────────────────────
-- Se crea sobre el padre, NO sobre cada partición individual — Postgres
-- clona automáticamente los triggers FOR EACH ROW definidos en una tabla
-- particionada declarativa a todas sus particiones, existentes y futuras.
DROP TRIGGER IF EXISTS trg_horarios_set_updated_at ON public.horarios;

CREATE TRIGGER trg_horarios_set_updated_at
  BEFORE UPDATE ON public.horarios
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TRIGGER trg_horarios_set_updated_at ON public.horarios IS
  'Fix ARCH-29: refresca updated_at server-side en cada UPDATE, base '
  'del bloqueo optimista de horarioEditing.js.';


-- ── 4. Verificación manual post-despliegue (no ejecutar como parte de la
--       migración — dejar como referencia para confirmar propagación real
--       a las 7 particiones existentes) ───────────────────────────────────
-- SELECT tgrelid::regclass AS tabla, tgname
-- FROM pg_trigger
-- WHERE tgname = 'trg_horarios_set_updated_at'
-- ORDER BY tabla::text;
-- -- Debe listar: horarios (padre) + las 7 particiones reales
-- -- (horarios_lapso_1_2026 ... horarios_lapso_default)
