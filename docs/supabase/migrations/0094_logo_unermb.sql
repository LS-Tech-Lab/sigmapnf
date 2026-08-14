-- =============================================================================
-- Migración 0094 — tercer logo configurable: "logo de UNERMB"
--
-- Pedido de LS (14 ago): donde antes salía el texto del nombre de la
-- institución ("UNERMB", nombre_institucion) en el membrete impreso, ahora
-- va un logo -- igual que ya pasó con el logo institucional (logo_base64,
-- migración 0056) y el logo de la coordinación (logo_coordinacion_base64,
-- migración 0092). Con este ya son 3 logos configurables en el membrete;
-- reportePlantilla.js los mantiene todos con la misma proporción (mismo
-- alto/ancho máximo en reporte-print.css) a pedido explícito de LS.
--
-- A diferencia de logo_base64 (que si falta cae a un placeholder de letra,
-- porque el membrete SIEMPRE debe mostrar algo ahí) y de
-- logo_coordinacion_base64 (puramente opcional, no muestra nada si falta),
-- logo_unermb_base64 tiene un tercer comportamiento de fallback: si no
-- está configurado, el membrete sigue mostrando el <h1> de texto plano con
-- nombre_institucion -- exactamente el comportamiento que ya existía antes
-- de esta migración, para no romper el membrete de nadie que no suba este
-- logo nuevo. Ver reportePlantilla.js.
--
-- Mismo patrón exacto que logo_base64/logo_coordinacion_base64 (mismos
-- CHECK de tipo/tamaño, mismo criterio de data URI en vez de Storage — ver
-- el comentario de diseño completo en 0056_config_reportes_branding.sql,
-- no se repite acá).
-- =============================================================================

ALTER TABLE public.configuracion_reportes
  ADD COLUMN IF NOT EXISTS logo_unermb_base64 TEXT;

ALTER TABLE public.configuracion_reportes
  ADD CONSTRAINT logo_unermb_tipo_valido CHECK (
    logo_unermb_base64 IS NULL
    OR logo_unermb_base64 ~ '^data:image/(png|jpe?g|webp);base64,'
  );

ALTER TABLE public.configuracion_reportes
  ADD CONSTRAINT logo_unermb_tamano_maximo CHECK (
    logo_unermb_base64 IS NULL OR length(logo_unermb_base64) <= 2000000  -- ~1.5MB binario
  );

COMMENT ON COLUMN public.configuracion_reportes.logo_unermb_base64 IS
  'Tercer logo del membrete: reemplaza el <h1> de texto (nombre_institucion) '
  'cuando está configurado. Si es NULL, el membrete sigue mostrando el texto '
  'plano -- ver reportePlantilla.js. Mismo formato/límite que logo_base64 '
  '-- ver migración 0056.';

-- Sin cambios de RLS/GRANT: la tabla ya tiene sus políticas de SELECT
-- (cualquier autenticado activo) y UPDATE/INSERT (puedeConfigurarReportes)
-- desde la migración 0056, que cubren la tabla completa, columna nueva
-- incluida.

-- ────────────────────────────────────────────────────────────────────────
-- Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────
-- SELECT logo_unermb_base64 FROM configuracion_reportes;
-- -- Esperado: 1 fila, NULL hasta que un admin suba el logo desde
-- -- Sistema → Reportes → Membrete.
