-- Migration: 0084_fix_horarios_resolver_docente_materia_sede_id
-- Fecha: 2026-08-10
--
-- Bug distinto pero de la misma familia (encontrado en la auditoria
-- posterior al post-mortem de registrar_asistencia): el trigger
-- horarios_resolver_docente_materia() -- BEFORE INSERT OR UPDATE en
-- horarios y todas sus particiones -- inserta filas nuevas en materias
-- y docentes cuando el Excel trae un nombre que aun no existe en el
-- catalogo de esa sede. El INSERT no incluia sede_id (columna NOT NULL
-- en ambas tablas) y el ON CONFLICT apuntaba solo a nombre_raw, cuando
-- la unique constraint real es (sede_id, nombre_raw)
-- (docentes_sede_nombre_raw_unique / materias_sede_nombre_raw_unique).
-- Cualquier carga de horarios con un docente o materia nuevo para esa
-- sede fallaba.
--
-- Ya aplicado en produccion (Supabase project fcrrtpujuncxruwxpckq) el
-- 2026-08-10. Esta migracion sincroniza el repo.

CREATE OR REPLACE FUNCTION public.horarios_resolver_docente_materia()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_materia text;
  v_docente text;
  v_materia_id bigint;
  v_docente_id bigint;
begin
  if new.clase_raw is null then
    new.clase_raw := new.clase;
  end if;

  if new.materia_id is null or new.docente_id is null then
    select pc.materia, pc.docente into v_materia, v_docente
    from public.parse_clase(new.clase_raw) pc;

    if v_materia is not null and v_materia <> '' and new.materia_id is null then
      insert into public.materias (nombre_raw, nombre_display, sede_id)
      values (v_materia, v_materia, new.sede_id)
      on conflict (sede_id, nombre_raw) do nothing;

      select id into v_materia_id from public.materias
      where nombre_raw = v_materia and sede_id = new.sede_id;
      new.materia_id := v_materia_id;
    end if;

    if v_docente is not null and v_docente <> '' and new.docente_id is null then
      insert into public.docentes (nombre_raw, nombre_display, sede_id)
      values (v_docente, v_docente, new.sede_id)
      on conflict (sede_id, nombre_raw) do nothing;

      select id into v_docente_id from public.docentes
      where nombre_raw = v_docente and sede_id = new.sede_id;
      new.docente_id := v_docente_id;
    end if;
  end if;

  return new;
end;
$function$;
