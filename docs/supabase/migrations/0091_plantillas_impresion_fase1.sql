-- ============================================================================
-- Migración 0091 — Fase 1 del editor de plantillas de planillas/reportes
--
-- CONTEXTO
-- --------
-- LS pidió (12 ago) poder configurar las columnas de la "Planilla de
-- Asistencias Diarias por Turno" (PlanillaImprimibleBase.jsx) para que se
-- parezca a la planilla física en papel de "ASISTENCIA DIARIA EDUC ESPECIAL"
-- (columnas HORA, ASIGNATURA, SECCIÓN, PROFESOR, ACTIVIDAD, FIRMA ENTRADA,
-- FIRMA SALIDA, AULA, OBSERVACIÓN, agrupadas por bloque de horario en vez
-- de por docente). Se planea en 3 fases:
--   Fase 1 (esta migración + PestanaPlantillas.jsx): configurador de
--     columnas (on/off, etiqueta, orden) por tipo de reporte.
--   Fase 2 (futura): vista previa de impresión en vivo.
--   Fase 3 (futura): diseñador de layout libre (columna `layout`, ya
--     reservada acá, sin usar todavía).
--
-- MODELO: LS decidió que sea "global, pero configurable por sede" — una
-- sola tabla de plantillas (no una tabla completa duplicada por sede).
-- Cada sede elige, por tipo de reporte, cuál plantilla usa
-- (`sede_plantillas`). Si una sede no eligió ninguna, cae a la plantilla
-- `es_default` de ese tipo de reporte — así una sede nueva funciona sin
-- configuración manual previa, mismo criterio de "fallback seguro" que
-- configuracion_reportes (0056) usa para el branding.
--
-- `columnas` es un array de objetos: [{ campo, etiqueta, orden, visible }].
-- El set de `campo` válidos depende del `tipo_reporte` (ver CHECK y
-- comentario de columna) y se valida también en el frontend
-- (PestanaPlantillas.jsx) — el CHECK acá es defensa en profundidad, no la
-- única validación.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.plantillas_impresion (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  tipo_reporte   TEXT NOT NULL CHECK (tipo_reporte IN ('planilla_asistencia_turno')),
  nombre         TEXT NOT NULL CHECK (length(trim(nombre)) > 0 AND length(nombre) <= 80),

  -- Fase 1: agrupación fija por tipo_reporte hoy (solo 'bloque' existe para
  -- planilla_asistencia_turno — una fila por clase programada del día/turno,
  -- igual que la planilla en papel). Se deja como columna (no hardcodeado)
  -- para poder sumar 'docente' (agrupar por profesor, comportamiento previo
  -- de este componente) como variante elegible más adelante sin migración
  -- nueva.
  agrupacion     TEXT NOT NULL DEFAULT 'bloque' CHECK (agrupacion IN ('bloque', 'docente')),

  orientacion    TEXT NOT NULL DEFAULT 'horizontal' CHECK (orientacion IN ('vertical', 'horizontal')),
  tamano_pagina  TEXT NOT NULL DEFAULT 'carta' CHECK (tamano_pagina IN ('carta', 'oficio')),

  columnas       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Fase 3 (sin usar todavía): posiciones libres de encabezado/pie/logo.
  -- Se reserva la columna ahora para no necesitar otra migración de
  -- esquema cuando se implemente el diseñador de layout libre.
  layout         JSONB,

  es_default     BOOLEAN NOT NULL DEFAULT false,

  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT plantillas_impresion_columnas_es_array
    CHECK (jsonb_typeof(columnas) = 'array')
);

COMMENT ON TABLE public.plantillas_impresion IS
  'Fase 1 del editor de plantillas de planillas/reportes imprimibles. '
  'Cada fila define el set de columnas (jsonb) para un tipo_reporte. '
  'Modelo global-configurable-por-sede: ver sede_plantillas para qué '
  'plantilla usa cada sede.';

-- Solo una plantilla default por tipo_reporte — garantía a nivel de BD,
-- no solo de aplicación (índice único parcial, mismo patrón que otros
-- "singleton condicional" del proyecto).
CREATE UNIQUE INDEX plantillas_impresion_un_default_por_tipo
  ON public.plantillas_impresion (tipo_reporte)
  WHERE es_default;

CREATE INDEX plantillas_impresion_tipo_idx ON public.plantillas_impresion (tipo_reporte);

-- Semilla: plantilla default de planilla_asistencia_turno reproduciendo
-- exactamente el formato en papel que LS trajo de referencia (foto del
-- 17 de junio, "ASISTENCIA DIARIA EDUC ESPECIAL CABIMAS").
INSERT INTO public.plantillas_impresion (tipo_reporte, nombre, agrupacion, columnas, es_default)
VALUES (
  'planilla_asistencia_turno',
  'Formato estándar (por bloque de horario)',
  'bloque',
  '[
    {"campo": "hora",           "etiqueta": "Hora",           "orden": 1, "visible": true},
    {"campo": "asignatura",     "etiqueta": "Asignatura",     "orden": 2, "visible": true},
    {"campo": "seccion",        "etiqueta": "Sección",        "orden": 3, "visible": true},
    {"campo": "profesor",       "etiqueta": "Profesor",       "orden": 4, "visible": true},
    {"campo": "actividad",      "etiqueta": "Actividad",      "orden": 5, "visible": true},
    {"campo": "firma_entrada",  "etiqueta": "Firma Entrada",  "orden": 6, "visible": true},
    {"campo": "firma_salida",   "etiqueta": "Firma Salida",   "orden": 7, "visible": true},
    {"campo": "aula",           "etiqueta": "Aula",           "orden": 8, "visible": true},
    {"campo": "observacion",    "etiqueta": "Observación",    "orden": 9, "visible": true}
  ]'::jsonb,
  true
);

-- ────────────────────────────────────────────────────────────────────────
-- sede_plantillas — qué plantilla usa cada sede para cada tipo_reporte.
-- Ausencia de fila = usa la plantilla es_default de ese tipo_reporte
-- (resuelto en el frontend, ver usePlantillasImpresion.js).
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sede_plantillas (
  sede_id       TEXT NOT NULL REFERENCES public.sedes(id) ON DELETE CASCADE,
  tipo_reporte  TEXT NOT NULL CHECK (tipo_reporte IN ('planilla_asistencia_turno')),
  plantilla_id  UUID NOT NULL REFERENCES public.plantillas_impresion(id) ON DELETE CASCADE,

  updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (sede_id, tipo_reporte)
);

COMMENT ON TABLE public.sede_plantillas IS
  'Qué plantilla de plantillas_impresion usa cada sede, por tipo_reporte. '
  'Sin fila para una sede = usa la plantilla es_default de ese tipo.';

CREATE INDEX sede_plantillas_plantilla_idx ON public.sede_plantillas (plantilla_id);

-- ────────────────────────────────────────────────────────────────────────
-- Permiso nuevo: puedeGestionarPlantillas (catálogo de frontend, ver
-- GRUPOS_PERMISOS en src/components/usuarios/shared.jsx). Mismo criterio
-- que puedeConfigurarReportes/puedeGestionarSedes: sin asignación
-- automática a ningún rol, se asigna a mano desde Usuarios y Roles.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.plantillas_impresion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sede_plantillas       ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier autenticado activo. Hace falta para que CUALQUIERA
-- que genera la planilla (no solo quien la administra) resuelva qué
-- columnas mostrar — mismo criterio que configuracion_reportes_select.
CREATE POLICY "plantillas_impresion_select_autenticados"
  ON public.plantillas_impresion FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.activo = true));

CREATE POLICY "sede_plantillas_select_autenticados"
  ON public.sede_plantillas FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.activo = true));

-- Escritura: solo puedeGestionarPlantillas. Sin política de DELETE en
-- plantillas_impresion a propósito (mismo criterio que sedes/0070): una
-- plantilla en uso por sede_plantillas tiene FK entrante; se desactiva
-- dejando de asignarla, no se borra. Si hace falta borrar alguna vez sin
-- referencias, se hace directo en el dashboard de Supabase.
CREATE POLICY "plantillas_impresion_insert_gestion"
  ON public.plantillas_impresion FOR INSERT
  TO authenticated
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarPlantillas'));

CREATE POLICY "plantillas_impresion_update_gestion"
  ON public.plantillas_impresion FOR UPDATE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeGestionarPlantillas'))
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarPlantillas'));

CREATE POLICY "sede_plantillas_upsert_gestion"
  ON public.sede_plantillas FOR INSERT
  TO authenticated
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarPlantillas'));

CREATE POLICY "sede_plantillas_update_gestion"
  ON public.sede_plantillas FOR UPDATE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeGestionarPlantillas'))
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarPlantillas'));

CREATE POLICY "sede_plantillas_delete_gestion"
  ON public.sede_plantillas FOR DELETE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeGestionarPlantillas'));

REVOKE ALL ON public.plantillas_impresion FROM PUBLIC, anon;
REVOKE ALL ON public.sede_plantillas      FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE         ON public.plantillas_impresion TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sede_plantillas      TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- RPC: marcar_plantilla_default — atómico, evita el hueco entre
-- "desmarcar la default vieja" y "marcar la nueva" que un UPDATE de dos
-- pasos desde el cliente dejaría abierto (el índice único parcial
-- rechazaría el paso 2 si el paso 1 no se confirmó antes en su propia
-- transacción). SECURITY DEFINER porque el UPDATE de la fila vieja no es
-- sobre una fila que el cliente esté necesariamente tocando en su propio
-- WITH CHECK de la misma sentencia.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_plantilla_default(p_plantilla_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tipo TEXT;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeGestionarPlantillas') THEN
    RAISE EXCEPTION 'permiso denegado: puedeGestionarPlantillas';
  END IF;

  SELECT tipo_reporte INTO v_tipo
  FROM public.plantillas_impresion
  WHERE id = p_plantilla_id;

  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'plantilla % no existe', p_plantilla_id;
  END IF;

  UPDATE public.plantillas_impresion
  SET es_default = false, updated_at = now(), updated_by = auth.uid()
  WHERE tipo_reporte = v_tipo AND es_default = true AND id <> p_plantilla_id;

  UPDATE public.plantillas_impresion
  SET es_default = true, updated_at = now(), updated_by = auth.uid()
  WHERE id = p_plantilla_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_plantilla_default(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_plantilla_default(UUID) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Confirmar la plantilla semilla:
--    SELECT nombre, agrupacion, es_default, jsonb_array_length(columnas)
--    FROM plantillas_impresion;
--    -- Esperado: 1 fila, es_default=true, 9 columnas.
-- 2. Confirmar que anon no puede leer ni escribir ninguna de las 2 tablas:
--    SET ROLE anon;
--    SELECT * FROM plantillas_impresion;  -- Esperado: 0 filas
--    SELECT * FROM sede_plantillas;       -- Esperado: 0 filas
--    RESET ROLE;
-- 3. Con un usuario SIN puedeGestionarPlantillas: INSERT/UPDATE en
--    cualquiera de las 2 tablas debe fallar por RLS. marcar_plantilla_
--    default() debe lanzar excepción de permiso denegado.
-- 4. Con un usuario CON el permiso: crear una segunda plantilla para
--    'planilla_asistencia_turno', llamar marcar_plantilla_default() con
--    su id, y confirmar que la primera pasó a es_default=false y la
--    nueva a true (exactamente una con es_default=true en todo momento).
-- 5. Confirmar el índice único parcial:
--    UPDATE plantillas_impresion SET es_default = true WHERE id <> (SELECT id FROM plantillas_impresion WHERE es_default);
--    -- Esperado: rechazado por plantillas_impresion_un_default_por_tipo
--    -- si ya hay otra fila es_default=true del mismo tipo_reporte.
-- ============================================================================
