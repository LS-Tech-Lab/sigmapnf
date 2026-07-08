-- =====================================================================
-- 0030_renombrar_docente_busca_por_raw.sql
-- Proyecto: horariospnf — UNERMB
-- Fecha: Junio 2026
--
-- Problema: renombrar_docente buscaba duplicados solo por nombre_display.
-- Primera edición: cambia el display pero no unifica (no hay match aún).
-- Segunda edición: ahora sí encuentra el match y unifica. Dos pasos.
--
-- Fix: buscar duplicado también por nombre_raw (ILIKE), que es el nombre
-- canónico importado del Excel. Si el texto que escribe el usuario
-- coincide con algún nombre_raw existente (case-insensitive, sin tildes),
-- unificar en un solo paso.
--
-- Aplica igual para renombrar_materia.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.renombrar_docente(p_id bigint, p_nuevo_nombre text)
RETURNS TABLE(id bigint, nombre_display text, unificado_con bigint)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing_id bigint;
  v_nombre_trim text := btrim(p_nuevo_nombre);
BEGIN
  -- Buscar duplicado por nombre_display (coincidencia exacta case-insensitive)
  SELECT d.id INTO v_existing_id
  FROM public.docentes d
  WHERE lower(d.nombre_display) = lower(v_nombre_trim)
    AND d.id <> p_id
  LIMIT 1;

  -- Si no encontró por display, buscar por nombre_raw (el nombre canónico del Excel)
  IF v_existing_id IS NULL THEN
    SELECT d.id INTO v_existing_id
    FROM public.docentes d
    WHERE lower(d.nombre_raw) = lower(v_nombre_trim)
      AND d.id <> p_id
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    -- Ya existe otro docente con ese nombre → unificar
    RETURN QUERY SELECT u.target_id, u.nombre_display, v_existing_id
    FROM public.unificar_docente(p_id, v_existing_id) u;
  ELSE
    -- Nombre nuevo, solo actualizar display
    UPDATE public.docentes SET nombre_display = v_nombre_trim WHERE docentes.id = p_id;
    RETURN QUERY SELECT d.id, d.nombre_display, null::bigint
    FROM public.docentes d WHERE d.id = p_id;
  END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION public.renombrar_materia(p_id bigint, p_nuevo_nombre text)
RETURNS TABLE(id bigint, nombre_display text, unificado_con bigint)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing_id bigint;
  v_nombre_trim text := btrim(p_nuevo_nombre);
BEGIN
  -- Buscar duplicado por nombre_display
  SELECT m.id INTO v_existing_id
  FROM public.materias m
  WHERE lower(m.nombre_display) = lower(v_nombre_trim)
    AND m.id <> p_id
  LIMIT 1;

  -- Si no encontró por display, buscar por nombre_raw
  IF v_existing_id IS NULL THEN
    SELECT m.id INTO v_existing_id
    FROM public.materias m
    WHERE lower(m.nombre_raw) = lower(v_nombre_trim)
      AND m.id <> p_id
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT u.target_id, u.nombre_display, v_existing_id
    FROM public.unificar_materia(p_id, v_existing_id) u;
  ELSE
    UPDATE public.materias SET nombre_display = v_nombre_trim WHERE materias.id = p_id;
    RETURN QUERY SELECT m.id, m.nombre_display, null::bigint
    FROM public.materias m WHERE m.id = p_id;
  END IF;
END;
$function$;
