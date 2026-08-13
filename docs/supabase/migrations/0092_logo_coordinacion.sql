-- =============================================================================
-- Migración 0092 — segundo logo configurable: "logo de la coordinación"
--
-- Pedido de LS (13 ago): junto al ícono de la Planilla de Asistencia por
-- Turno, mostrar el logo de la coordinación (distinto del logo institucional
-- de UNERMB que ya existía en logo_base64 desde la migración 0056).
--
-- Mismo patrón exacto que logo_base64 (mismos CHECK de tipo/tamaño, mismo
-- criterio de guardarlo como data URI en vez de Storage — ver el comentario
-- de diseño completo en 0056_config_reportes_branding.sql, no se repite acá).
-- =============================================================================

ALTER TABLE public.configuracion_reportes
  ADD COLUMN IF NOT EXISTS logo_coordinacion_base64 TEXT;

ALTER TABLE public.configuracion_reportes
  ADD CONSTRAINT logo_coordinacion_tipo_valido CHECK (
    logo_coordinacion_base64 IS NULL
    OR logo_coordinacion_base64 ~ '^data:image/(png|jpe?g|webp);base64,'
  );

ALTER TABLE public.configuracion_reportes
  ADD CONSTRAINT logo_coordinacion_tamano_maximo CHECK (
    logo_coordinacion_base64 IS NULL OR length(logo_coordinacion_base64) <= 2000000  -- ~1.5MB binario
  );

COMMENT ON COLUMN public.configuracion_reportes.logo_coordinacion_base64 IS
  'Logo de la coordinación (distinto del logo institucional en logo_base64). '
  'Mismo formato/límite que logo_base64 -- ver migración 0056.';

-- Sin cambios de RLS/GRANT: la tabla ya tiene sus políticas de SELECT
-- (cualquier autenticado activo) y UPDATE/INSERT (puedeConfigurarReportes)
-- desde la migración 0056, que cubren la tabla completa, columna nueva
-- incluida.

-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────
-- SELECT logo_coordinacion_base64 FROM configuracion_reportes;
-- -- Esperado: 1 fila, NULL hasta que un admin suba el logo desde
-- -- Sistema → Reportes → Membrete.
