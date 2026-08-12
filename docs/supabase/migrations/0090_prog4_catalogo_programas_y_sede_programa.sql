-- ============================================================================
-- Migración: 0090_prog4_catalogo_programas_y_sede_programa.sql
-- Fecha: 12 de agosto de 2026
--
-- CONTEXTO
-- --------
-- A pedido de LS: ampliar el menú Sistema → Sedes para poder ajustar qué
-- programas están activos en cada sede (no todos los PNF se dictan en
-- todas las sedes) y propagar esa configuración al resto del sistema.
--
-- Hasta hoy "programa" era texto libre canonicalizado en el cliente
-- (normalizarPrograma(), src/utils/parsing.js) contra 4 alias conocidos
-- (DEFAULT_PROGRAMAS, src/constants/index.js) — nunca existió una tabla
-- `programas`, y mucho menos una relación con `sedes`.
--
-- DECISIONES CONFIRMADAS CON LS ANTES DE ESCRIBIR ESTO
-- ------------------------------------------------------
-- 1. "Eliminar" sedes/programas: NO. Se mantiene el mismo criterio que
--    0070 (solo desactivar, sin DELETE real) — incluso para el catálogo
--    nuevo de programas y para las filas de la relación sede-programa.
-- 2. Catálogo de programas: SÍ, formal (tabla `programas`, mismo patrón
--    exacto que `sedes`/0061), editable desde el mismo menú — no se deja
--    como constante fija.
-- 3. Alcance de "programas activos por sede": se aplica en todo el
--    sistema (selectores de programa en Usuarios, Panel QR, dropdowns de
--    Horarios) — no solo en la pantalla de administración. Esta
--    migración es la base de datos; el cableado en frontend es aparte
--    (mismo archivo de trabajo, commits siguientes).
--
-- DISEÑO
-- ------
-- - `programas` es una copia estructural de `sedes` (mismo id tipo slug,
--   mismas columnas activa/orden/creado_en, mismo CHECK de formato de
--   id, mismo criterio de RLS: SELECT authenticated true, INSERT/UPDATE
--   gateados por `puedeGestionarSedes` -- SE REUTILIZA el permiso
--   existente, no se crea uno nuevo, porque LS confirmó que la gestión
--   de programas vive en la MISMA pantalla (Sistema → Sedes), no en una
--   pantalla aparte con su propio permiso.
-- - `sedes_programas` es la relación N:N nueva: (sede_id, programa_id,
--   activo). PK compuesta. Por diseño se garantiza una fila por cada
--   combinación sede×programa que exista en el momento (ver backfill) --
--   así el resto del sistema puede preguntar "¿está activo el programa
--   X en la sede Y?" con una sola condición (activo = true), sin tener
--   que interpretar la AUSENCIA de fila como un estado implícito.
--   Consecuencia práctica para el frontend (GestionSedes.jsx): al crear
--   una sede nueva hay que insertar una fila por cada programa existente
--   (activo=true por defecto -- una sede nueva arranca ofreciendo todo
--   el catálogo activo, el admin desactiva lo que no aplique) y
--   viceversa al crear un programa nuevo.
-- - Backfill: como hasta hoy NINGUNA sede restringía programas, todas
--   las combinaciones sede×programa existentes se backfillean con
--   activo=true -- no cambia el comportamiento observable de la app el
--   día que se aplica esta migración. El admin ajusta desde la UI nueva
--   a partir de acá.
-- - Sin política de DELETE en ninguna de las dos tablas nuevas, mismo
--   razonamiento que 0070: `programas.id` puede tener FKs entrantes
--   futuras (horarios/docentes/materias no las tienen hoy porque
--   `programa` ahí sigue siendo texto libre, sin FK -- eso NO cambia en
--   esta migración, es deliberado para no romper la importación de
--   Excel existente) y `sedes_programas` es la fuente de verdad de "qué
--   estuvo activo cuándo": borrar una fila en vez de desactivarla
--   perdería ese historial sin necesidad.
-- ============================================================================


-- ── 1. Catálogo de programas ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.programas (
  id         text PRIMARY KEY,
  nombre     text NOT NULL,
  activa     boolean NOT NULL DEFAULT true,
  orden      smallint NOT NULL DEFAULT 0,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.programas IS
  'Catálogo de PNF (programas nacionales de formación). id es un slug '
  '(mismo patrón que sedes.id/roles.nombre). No tiene FK entrante desde '
  'horarios/docentes/materias -- ahí "programa" sigue siendo texto libre '
  'canonicalizado en el cliente (normalizarPrograma()).';

INSERT INTO public.programas (id, nombre, orden) VALUES
  ('informatica',         'PNF Informática',            1),
  ('contaduria_publica',  'PNF Contaduría Pública',     2),
  ('agroalimentacion',    'PNF Agroalimentación',       3),
  ('educacion_especial',  'PNF Educación Especial',     4)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.programas
  ADD CONSTRAINT programas_id_formato_valido
  CHECK (id ~ '^[a-z0-9_]+$');

ALTER TABLE public.programas
  ADD CONSTRAINT programas_orden_no_negativo
  CHECK (orden >= 0);

ALTER TABLE public.programas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "programas_select_authenticated"
  ON public.programas FOR SELECT
  TO authenticated
  USING (true);

-- Mismo permiso que la gestión de sedes (0070) -- una sola pantalla
-- admin, un solo permiso granular.
CREATE POLICY "programas_insert_gestion"
  ON public.programas FOR INSERT
  TO authenticated
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarSedes'));

CREATE POLICY "programas_update_gestion"
  ON public.programas FOR UPDATE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeGestionarSedes'))
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarSedes'));

-- Sin política de DELETE a propósito -- ver nota de diseño arriba.

GRANT SELECT ON public.programas TO authenticated;
GRANT INSERT, UPDATE ON public.programas TO authenticated;


-- ── 2. Relación sede × programa activo ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sedes_programas (
  sede_id     text NOT NULL REFERENCES public.sedes(id),
  programa_id text NOT NULL REFERENCES public.programas(id),
  activo      boolean NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sede_id, programa_id)
);

COMMENT ON TABLE public.sedes_programas IS
  'Qué programas están activos (ofrecidos) en cada sede. Se garantiza '
  'una fila por cada combinación sede×programa existente -- ausencia de '
  'fila no es un estado válido para el resto del sistema, siempre se '
  'consulta activo=true. Ver GestionSedes.jsx: crear una sede o un '
  'programa nuevo inserta las filas faltantes con activo=true.';

-- Backfill: todas las combinaciones existentes, activas por defecto --
-- no cambia el comportamiento observable de la app al aplicar esto.
INSERT INTO public.sedes_programas (sede_id, programa_id, activo)
SELECT s.id, p.id, true
FROM public.sedes s
CROSS JOIN public.programas p
ON CONFLICT (sede_id, programa_id) DO NOTHING;

ALTER TABLE public.sedes_programas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sedes_programas_select_authenticated"
  ON public.sedes_programas FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "sedes_programas_insert_gestion"
  ON public.sedes_programas FOR INSERT
  TO authenticated
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarSedes'));

CREATE POLICY "sedes_programas_update_gestion"
  ON public.sedes_programas FOR UPDATE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeGestionarSedes'))
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarSedes'));

-- Sin política de DELETE -- ver nota de diseño arriba (se desactiva con
-- activo=false, la fila se conserva).

GRANT SELECT ON public.sedes_programas TO authenticated;
GRANT INSERT, UPDATE ON public.sedes_programas TO authenticated;

CREATE INDEX IF NOT EXISTS idx_sedes_programas_sede_activo
  ON public.sedes_programas (sede_id)
  WHERE activo = true;


-- ============================================================================
-- PENDIENTE A PROPÓSITO (no es parte de esta migración)
-- ============================================================================
-- 1. `horarios.programa` / `docentes`/`materias` NO ganan una FK hacia
--    `programas.id` acá -- siguen siendo texto libre importado del Excel
--    (normalizarPrograma()). Ligar esa columna al catálogo formal es un
--    cambio aparte (afecta el parser y la importación existente) y no
--    fue parte de lo pedido.
-- 2. El cableado en frontend (GestionSedes.jsx con pestañas nuevas
--    "Programas" y "Asignación", ModalUsuario.jsx filtrando por sede
--    elegida, AdminQRPanel.jsx, useNombresCache.js) es un commit aparte
--    sobre este mismo esquema.
--
-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT count(*) FROM programas;                      -- 4
-- 2. SELECT count(*) FROM sedes_programas;                -- (# sedes) * (# programas)
-- 3. SELECT count(*) FROM sedes_programas WHERE NOT activo; -- 0 (todo arranca activo)
-- 4. Con un usuario SIN puedeGestionarSedes: intentar
--    UPDATE sedes_programas SET activo = false WHERE sede_id = 'cabimas'
--    AND programa_id = 'informatica'; -- 0 filas afectadas (RLS deniega).
-- 5. Con un usuario CON el permiso: mismo UPDATE -- debe afectar 1 fila.
-- 6. Confirmar que sigue sin existir política de DELETE en ninguna de
--    las dos tablas: SELECT policyname FROM pg_policies WHERE tablename
--    IN ('programas', 'sedes_programas'); -- solo select/insert/update.
-- ============================================================================
