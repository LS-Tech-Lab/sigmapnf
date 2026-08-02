-- =============================================================================
-- Migración 0056 — ADMIN-6: módulo de personalización de reportes
--
-- Tabla singleton (una sola fila, id fijo en 1) con la identidad visual y
-- textos institucionales que se inyectan en el membrete de los 3 documentos
-- imprimibles del sistema: Reporte Diario, Reporte por Rango (exportPDF.js)
-- y Planilla Imprimible (PlanillaImprimibleBase.jsx) — antes cada uno tenía
-- "UNERMB" / una "U" de placeholder hardcodeados por separado.
--
-- DISEÑO
-- ------
-- - Singleton: `id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1)` — fuerza una
--   sola fila, sin necesitar tabla de "settings" genérica. El frontend hace
--   upsert sobre id=1.
-- - `logo_base64`: se guarda como data URI completa (`data:image/png;base64,...`)
--   en vez de usar Supabase Storage. Motivo: el CSP del proyecto
--   (`img-src 'self' data: blob:`, ver vercel.json) ya permite `data:` sin
--   ningún cambio; un bucket de Storage habría requerido además sumar el
--   dominio *.supabase.co a `img-src` (más superficie) y una política RLS
--   de storage.objects aparte. `CHECK` limita tipo (png/jpg/webp — SVG
--   excluido a propósito, ver nota abajo) y tamaño (~1.5MB binario).
-- - `color_clase`: NO es un hex libre. Guarda el NOMBRE de una clase CSS
--   preset ya definida en public/reporte-print.css (mismo criterio que
--   SEC-3/COLORES_PRESET para roles: el CSP `style-src 'self'` sin
--   `unsafe-inline` no permite inyectar `style="--rp-primario:#..."`
--   inline en la ventana de impresión). `CHECK` restringe a un enum fijo
--   de clases que existen en el CSS.
-- - Textos libres (nombre_institucion, subtitulo_1/2, pie_texto,
--   firma_label): SIEMPRE pasan por ESC() en reportePlantilla.js antes de
--   interpolarse en el HTML impreso — igual que cualquier otro dato de
--   usuario en la app (mismo criterio que SEC-25). No son de confianza
--   solo por venir de un formulario admin.
--
-- SVG explícitamente NO soportado como logo: aunque `<img src="data:image/
-- svg+xml...">` no ejecuta <script> embebido en navegadores modernos (el
-- contexto de imagen deshabilita scripting), se excluye el tipo por
-- completo para no depender de ese comportamiento — un CHECK a nivel de
-- tipo MIME es más simple y verificable que confiar en la mitigación del
-- navegador.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.configuracion_reportes (
  id                 INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  nombre_institucion TEXT NOT NULL DEFAULT 'UNERMB',
  subtitulo_1        TEXT NOT NULL DEFAULT 'Programas Nacionales de Formación',
  subtitulo_2        TEXT NOT NULL DEFAULT 'Control de Asistencia Docente',
  pie_texto          TEXT NOT NULL DEFAULT 'Documento generado automáticamente por el sistema SigmaPNF',
  firma_label        TEXT NOT NULL DEFAULT 'Firma y sello del Coordinador(a)',

  logo_base64        TEXT,
  CONSTRAINT logo_tipo_valido CHECK (
    logo_base64 IS NULL
    OR logo_base64 ~ '^data:image/(png|jpe?g|webp);base64,'
  ),
  CONSTRAINT logo_tamano_maximo CHECK (
    logo_base64 IS NULL OR length(logo_base64) <= 2000000  -- ~1.5MB binario
  ),

  color_clase        TEXT NOT NULL DEFAULT 'rp-color--azul'
    CHECK (color_clase IN (
      'rp-color--azul', 'rp-color--verde', 'rp-color--teal',
      'rp-color--morado', 'rp-color--rojo', 'rp-color--ambar'
    )),

  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.configuracion_reportes IS
  'ADMIN-6: fila única (singleton) con la identidad visual (logo, color) y '
  'textos institucionales inyectados en el membrete de los reportes '
  'imprimibles. Ver reportePlantilla.js para dónde se consume.';

-- Semilla: fila por defecto con los mismos valores que tenía hardcodeados
-- exportPDF.js antes de este cambio, para que los reportes se vean
-- exactamente igual hasta que un admin configure algo distinto.
INSERT INTO public.configuracion_reportes (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracion_reportes ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado y activo. No es información
-- sensible (logo/textos institucionales) y la necesita cualquiera con
-- acceso a generar un reporte o la planilla imprimible — igual de abierto
-- que otros catálogos de solo-lectura de la app (ej. `programas`).
CREATE POLICY "configuracion_reportes_select_autenticados"
  ON public.configuracion_reportes FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.activo = true)
  );

-- Escritura: solo con el permiso granular puedeConfigurarReportes (agregado
-- al catálogo de permisos del frontend, GRUPOS_PERMISOS en
-- src/components/usuarios/shared.jsx, grupo "Administración").
CREATE POLICY "configuracion_reportes_update_admin"
  ON public.configuracion_reportes FOR UPDATE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeConfigurarReportes'))
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeConfigurarReportes'));

-- INSERT normalmente no hace falta (la fila semilla ya existe y el
-- frontend hace UPDATE), pero se deja por si alguna vez se borra la fila
-- a mano y hay que recrearla — misma condición que UPDATE.
CREATE POLICY "configuracion_reportes_insert_admin"
  ON public.configuracion_reportes FOR INSERT
  TO authenticated
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeConfigurarReportes'));

REVOKE ALL ON public.configuracion_reportes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.configuracion_reportes TO authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────
-- 1. Confirmar la fila semilla:
--    SELECT id, nombre_institucion, color_clase FROM configuracion_reportes;
--    -- Esperado: exactamente 1 fila, id=1.
--
-- 2. Confirmar que anon NO puede leer ni escribir:
--    SET ROLE anon;
--    SELECT * FROM configuracion_reportes;  -- Esperado: 0 filas (RLS bloquea)
--    RESET ROLE;
--
-- 3. Confirmar que un usuario SIN puedeConfigurarReportes no puede
--    actualizar (debe fallar o afectar 0 filas por RLS), y uno CON el
--    permiso sí puede.
