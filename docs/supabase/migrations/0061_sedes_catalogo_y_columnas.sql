-- ============================================================================
-- Migración: 0061_sedes_catalogo_y_columnas.sql
-- Fecha: 4 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Primera fase (SEDE-1) de la independencia entre sedes de la institución.
-- Decisiones confirmadas con el usuario antes de escribir esto:
--   1. Catálogos de docentes y materias INDEPENDIENTES por sede (no
--      compartidos) — dos sedes pueden tener un docente/materia con el
--      mismo nombre sin chocar entre sí.
--   2. Cada usuario (user_profiles) queda fijo a UNA sede, salvo quien
--      tenga el permiso nuevo `puedeVerTodasLasSedes` (admin y
--      coordinador general).
--   3. Quien tenga `puedeVerTodasLasSedes` ve/gestiona todas las sedes.
--
-- Esta migración es SOLO esquema (tabla + columnas + backfill + unicidad).
-- A propósito NO toca políticas RLS de docentes/materias/horarios/
-- qr_sessions/asistencias_diarias todavía — eso es SEDE-3 (ver nota al
-- final). Aplicar RLS de aislamiento sin haber migrado antes el frontend
-- para que mande sede_id en cada query dejaría la app rota en el aire.
--
-- `sedes.id` es TEXT (slug), mismo patrón que `roles.nombre` (PK textual
-- legible, no un serial opaco) — precedente ya establecido en el esquema.
--
-- Todo el dato existente (todas las filas de docentes/materias/horarios/
-- qr_sessions/asistencias_diarias/user_profiles) se backfillea a
-- 'cabimas', que es la única sede que el sistema maneja hoy.
-- ============================================================================


-- ── 1. Catálogo de sedes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sedes (
  id         text PRIMARY KEY,
  nombre     text NOT NULL,
  activa     boolean NOT NULL DEFAULT true,
  orden      smallint NOT NULL,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sedes IS
  'Catálogo de sedes de la institución. id es un slug (mismo patrón que '
  'roles.nombre). orden controla el orden de aparición en el selector.';

INSERT INTO public.sedes (id, nombre, orden) VALUES
  ('bachaquero',     'Bachaquero',      1),
  ('bobures',        'Bobures',         2),
  ('cabimas',        'Cabimas',         3),
  ('ciudad_ojeda',   'Ciudad Ojeda',    4),
  ('coro',           'Coro',            5),
  ('lagunillas',     'Lagunillas',      6),
  ('los_puertos',    'Los Puertos',     7),
  ('mene_grande',    'Mene Grande',     8),
  ('san_francisco',  'San Francisco',   9),
  ('san_pedro',      'San Pedro',      10),
  ('trujillo',       'Trujillo',       11)
ON CONFLICT (id) DO NOTHING;

-- RLS: catálogo de lectura pública para cualquier autenticado (mismo
-- patrón que `roles`: sin acceso público anónimo, sin políticas de
-- escritura vía cliente — altas/bajas de sedes quedan para una RPC futura
-- si hace falta, no son parte de SEDE-1).
ALTER TABLE public.sedes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sedes_select_authenticated ON public.sedes;
CREATE POLICY sedes_select_authenticated ON public.sedes
  FOR SELECT
  TO authenticated
  USING (true);


-- ── 2. user_profiles.sede_id ─────────────────────────────────────────────────
-- Nullable a propósito: quien tenga `puedeVerTodasLasSedes` no necesita
-- una sede fija asignada (aunque puede tenerla como "sede de origen" si
-- se quiere en el futuro). La obligatoriedad para el resto de los roles
-- se valida en la RPC (0062), no acá con NOT NULL, porque NOT NULL
-- rompería el backfill de roles que sí califican para ver todas.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS sede_id text REFERENCES public.sedes(id);

UPDATE public.user_profiles SET sede_id = 'cabimas' WHERE sede_id IS NULL;


-- ── 3. docentes.sede_id — catálogo independiente por sede ───────────────────
ALTER TABLE public.docentes
  ADD COLUMN IF NOT EXISTS sede_id text REFERENCES public.sedes(id);

UPDATE public.docentes SET sede_id = 'cabimas' WHERE sede_id IS NULL;

ALTER TABLE public.docentes ALTER COLUMN sede_id SET NOT NULL;

-- Reemplaza la unicidad global por unicidad compuesta (sede_id, X).
-- ESQUEMA_Y_MIGRACIONES.md ya documentaba dos índices UNIQUE distintos
-- sobre cedula (uno total, uno parcial) — se limpian ambos acá de paso,
-- en vez de arrastrar la redundancia a la versión compuesta.
--
-- FIX (revisión previa a aplicar): `docentes_cedula_unique` NO es un
-- índice suelto — es el índice que respalda la UNIQUE CONSTRAINT del
-- mismo nombre (creada en 0028 vía `ADD CONSTRAINT ... UNIQUE`).
-- Postgres rechaza `DROP INDEX` sobre el índice de una constraint
-- ("cannot drop index ... because constraint ... requires it"); hay que
-- dropear la constraint. `uq_docentes_cedula` sí es un índice suelto
-- (CREATE UNIQUE INDEX en 0008), ese se mantiene como estaba.
ALTER TABLE public.docentes DROP CONSTRAINT IF EXISTS docentes_cedula_unique;
DROP INDEX IF EXISTS public.uq_docentes_cedula;
ALTER TABLE public.docentes DROP CONSTRAINT IF EXISTS docentes_nombre_raw_key;

CREATE UNIQUE INDEX IF NOT EXISTS docentes_sede_cedula_unique
  ON public.docentes (sede_id, cedula)
  WHERE cedula IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS docentes_sede_nombre_raw_unique
  ON public.docentes (sede_id, nombre_raw);


-- ── 4. materias.sede_id — catálogo independiente por sede ───────────────────
ALTER TABLE public.materias
  ADD COLUMN IF NOT EXISTS sede_id text REFERENCES public.sedes(id);

UPDATE public.materias SET sede_id = 'cabimas' WHERE sede_id IS NULL;

ALTER TABLE public.materias ALTER COLUMN sede_id SET NOT NULL;

ALTER TABLE public.materias DROP CONSTRAINT IF EXISTS materias_nombre_raw_key;

CREATE UNIQUE INDEX IF NOT EXISTS materias_sede_nombre_raw_unique
  ON public.materias (sede_id, nombre_raw);


-- ── 5. horarios.sede_id ──────────────────────────────────────────────────────
-- `horarios.sede` (texto libre, viene del Excel) se conserva tal cual —
-- sigue siendo el dato "crudo" de importación. `sede_id` es la columna
-- normalizada que va a usar el frontend/RLS para filtrar (SEDE-3).
-- Se agrega en la tabla padre Y se propaga a cada partición real, porque
-- (igual que RLS, ver ESQUEMA_Y_MIGRACIONES.md sobre 0045) Postgres no
-- hereda columnas nuevas automáticamente en particiones ya creadas.
ALTER TABLE public.horarios
  ADD COLUMN IF NOT EXISTS sede_id text REFERENCES public.sedes(id);

UPDATE public.horarios SET sede_id = 'cabimas' WHERE sede_id IS NULL;

DO $$
DECLARE
  particion text;
BEGIN
  FOR particion IN
    SELECT inhrelid::regclass::text
    FROM pg_inherits
    WHERE inhparent = 'public.horarios'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE %s ADD COLUMN IF NOT EXISTS sede_id text REFERENCES public.sedes(id);',
      particion
    );
    EXECUTE format(
      'UPDATE %s SET sede_id = ''cabimas'' WHERE sede_id IS NULL;',
      particion
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_horarios_sede_lapso ON public.horarios (sede_id, lapso);


-- ── 6. qr_sessions.sede_id y asistencias_diarias.sede_id ────────────────────
-- Necesarias para que, en SEDE-3/SEDE-4, el flujo anónimo de /scan pueda
-- filtrar docentes/materias por la sede de la sesión QR escaneada — sin
-- esta columna, `registrar_asistencia()` no tiene forma de saber a qué
-- sede pertenece un escaneo.
ALTER TABLE public.qr_sessions
  ADD COLUMN IF NOT EXISTS sede_id text REFERENCES public.sedes(id);

UPDATE public.qr_sessions SET sede_id = 'cabimas' WHERE sede_id IS NULL;

ALTER TABLE public.asistencias_diarias
  ADD COLUMN IF NOT EXISTS sede_id text REFERENCES public.sedes(id);

UPDATE public.asistencias_diarias SET sede_id = 'cabimas' WHERE sede_id IS NULL;


-- ============================================================================
-- PENDIENTE A PROPÓSITO (no es parte de esta migración)
-- ============================================================================
-- 1. `trimestres`: no se le agrega sede_id acá. Si cada sede debe poder
--    abrir/cerrar su propio lapso de forma independiente, `trimestres`
--    necesita (sede_id, lapso) UNIQUE en vez de solo `lapso` UNIQUE, y la
--    FK de `horarios.lapso -> trimestres.lapso` pasa a ser compuesta
--    (sede_id, lapso). Es una decisión de negocio que falta confirmar
--    (¿los lapsos son iguales en todas las sedes o cada una maneja el
--    suyo?) — queda para una migración aparte una vez se confirme.
-- 2. RLS de aislamiento real (docentes/materias/horarios/qr_sessions/
--    asistencias_diarias) — SEDE-3. Hoy estas tablas siguen con SELECT
--    público tal como estaban; sede_id existe pero todavía no se exige.
-- 3. RPCs que insertan/actualizan en estas tablas (importación de Excel,
--    `registrar_asistencia`, altas manuales) — deben empezar a mandar/
--    leer sede_id. Se revisa RPC por RPC en SEDE-3/SEDE-4, no en bloque,
--    porque `registrar_asistencia` es sensible (rate limiting, SEC-8/
--    SEC-11) y no se toca sin verificar cada camino.
--
-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT count(*) FROM sedes;                          -- debe dar 11
-- 2. SELECT count(*) FROM user_profiles WHERE sede_id IS NULL;  -- 0
-- 3. SELECT count(*) FROM docentes WHERE sede_id IS NULL;       -- 0
-- 4. SELECT count(*) FROM materias WHERE sede_id IS NULL;       -- 0
-- 5. SELECT count(*) FROM horarios WHERE sede_id IS NULL;       -- 0
--    (repetir contra cada partición si se quiere ser exhaustivo)
-- 6. Confirmar que las particiones de horarios tienen la columna:
--    SELECT table_name FROM information_schema.columns
--    WHERE column_name = 'sede_id' AND table_schema = 'public';
--    -- debe listar horarios + las 7 particiones + docentes + materias +
--    -- user_profiles + qr_sessions + asistencias_diarias
-- 7. Insertar dos docentes con el mismo nombre_raw en sedes distintas —
--    debe funcionar. Repetirlo en la misma sede — debe rechazar por
--    `docentes_sede_nombre_raw_unique`.
-- ============================================================================
