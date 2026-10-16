-- Migración: 0104_unificar_docente_conserva_cedula.sql
--
-- PROBLEMA: renombrar_docente() unifica con otro docente cuando el nombre
-- nuevo coincide (sin distinguir mayúsculas) con el nombre_display o el
-- nombre_raw de OTRA fila. unificar_docente() repunta los horarios y BORRA
-- la fila vieja, pero no copiaba su cédula/teléfono/email/observaciones a la
-- fila que se conserva. Si la vieja tenía cédula y la nueva no, la cédula se
-- perdía en silencio (ej.: FRANCISCO JAVIER VÍLCHEZ RUÍZ -> FRANCISCO
-- VILCHEZ). Además la búsqueda de duplicado no filtraba por sede.
--
-- FIX 1: unificar_docente() traslada cédula/teléfono/email/observaciones a
--        la fila destino (el destino manda si ya tiene valor). Si AMBAS
--        tienen cédula y son distintas, aborta con error: no decide por el
--        usuario ni descarta una cédula.
-- FIX 2: renombrar_docente() busca duplicados solo dentro de la sede del
--        docente que se renombra.
-- FIX 3 (dato puntual): restaura la cédula del docente id 2 (respaldo
--        bak_0103_docentes) en la fila a la que se unificó (id 251), solo si
--        sigue sin cédula y nadie más la usa.

CREATE OR REPLACE FUNCTION public.unificar_docente(p_old_id bigint, p_new_id bigint)
RETURNS TABLE(target_id bigint, nombre_display text)
LANGUAGE plpgsql
AS $function$
declare
  v_display text;
  v_old     public.docentes%rowtype;
  v_new     public.docentes%rowtype;
begin
  if p_old_id = p_new_id then
    select d.nombre_display into v_display from public.docentes d where d.id = p_new_id;
    return query select p_new_id, v_display;
    return;
  end if;

  select * into v_new from public.docentes where id = p_new_id;
  if not found then
    raise exception 'Docente destino % no existe', p_new_id;
  end if;
  select * into v_old from public.docentes where id = p_old_id;
  if not found then
    raise exception 'Docente origen % no existe', p_old_id;
  end if;

  if v_old.cedula is not null and v_new.cedula is not null
     and v_old.cedula <> v_new.cedula then
    raise exception 'No se pueden unificar: ambos docentes tienen cédula distinta (% y %). Corrige una de las dos primero.',
      v_old.cedula, v_new.cedula;
  end if;

  -- SEC-41: fusión de identidad, no edición de contenido -- debe alcanzar
  -- también las clases de trimestres cerrados para no dejar FK huérfanas.
  perform set_config('app.bypass_lapso_cerrado', 'true', true);

  update public.horarios
  set docente_id = p_new_id
  where docente_id = p_old_id;

  -- Conservar los datos de contacto del duplicado. La cédula se libera
  -- primero en la fila vieja por el índice único (sede_id, cedula).
  if v_old.cedula is not null then
    update public.docentes set cedula = null where id = p_old_id;
  end if;
  update public.docentes d
  set cedula        = coalesce(d.cedula, v_old.cedula),
      telefono      = coalesce(d.telefono, v_old.telefono),
      email         = coalesce(d.email, v_old.email),
      observaciones = coalesce(d.observaciones, v_old.observaciones)
  where d.id = p_new_id;

  delete from public.docentes where id = p_old_id;

  select d.nombre_display into v_display from public.docentes d where d.id = p_new_id;
  return query select p_new_id, v_display;
end;
$function$;

CREATE OR REPLACE FUNCTION public.renombrar_docente(p_id bigint, p_nuevo_nombre text)
RETURNS TABLE(id bigint, nombre_display text, unificado_con bigint)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing_id bigint;
  v_nombre_trim text := btrim(p_nuevo_nombre);
  v_sede        text;
BEGIN
  SELECT d.sede_id INTO v_sede FROM public.docentes d WHERE d.id = p_id;

  SELECT d.id INTO v_existing_id
  FROM public.docentes d
  WHERE lower(d.nombre_display) = lower(v_nombre_trim)
    AND d.id <> p_id
    AND d.sede_id = v_sede
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    SELECT d.id INTO v_existing_id
    FROM public.docentes d
    WHERE lower(d.nombre_raw) = lower(v_nombre_trim)
      AND d.id <> p_id
      AND d.sede_id = v_sede
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT u.target_id, u.nombre_display, v_existing_id
    FROM public.unificar_docente(p_id, v_existing_id) u;
  ELSE
    UPDATE public.docentes SET nombre_display = v_nombre_trim WHERE docentes.id = p_id;
    RETURN QUERY SELECT d.id, d.nombre_display, null::bigint
    FROM public.docentes d WHERE d.id = p_id;
  END IF;
END;
$function$;

-- Restauración puntual (ver FIX 3).
UPDATE public.docentes
SET cedula = '18218241'
WHERE id = 251 AND sede_id = 'cabimas' AND cedula IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.docentes x WHERE x.sede_id = 'cabimas' AND x.cedula = '18218241');
