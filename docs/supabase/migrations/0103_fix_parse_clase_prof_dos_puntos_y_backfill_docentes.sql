-- Migración: 0103_fix_parse_clase_prof_dos_puntos_y_backfill_docentes.sql
--
-- PROBLEMA: parse_clase() (SQL) solo separaba materia/docente con
-- "<espacio>Prof[es][.]<espacio>". Celdas como "INGLES II\nPROF: LIZ ARAUJO"
-- (formato v2, "Prof:" con dos puntos pegado al nombre) no se separaban:
-- devolvía docente = '' y el trigger horarios_resolver_docente_materia
-- dejaba docente_id = NULL sin crear la fila en `docentes`. El parser JS
-- (parseClase) sí las entiende, así que la vista Docentes las listaba y
-- guardar una cédula hacía un UPDATE sobre una fila inexistente (0 filas,
-- sin error) -> la cédula "se borraba" al refrescar.
--
-- FIX 1: el separador acepta también "Prof:" / "Profa:" / "PROF.:" (con
--        '.' o ':' obligatorio en esa variante, para no partir palabras
--        como "Profesional" sin signo). Case-insensitive.
-- FIX 2: backfill — re-dispara el trigger BEFORE UPDATE sobre horarios con
--        docente_id NULL para que cree las filas faltantes de `docentes`
--        (sede_id de la propia fila) y vincule docente_id. Se omiten los
--        lapsos `cerrado` en `trimestres` (solo lectura, SEC-40).
--
-- Verificado en solo lectura contra producción (cabimas): de 198 horarios
-- sin docente_id, 175 quedarían resueltos; 23 no traen docente en el texto.

CREATE OR REPLACE FUNCTION public.parse_clase(p_clase text)
RETURNS TABLE(materia text, docente text)
LANGUAGE plpgsql
IMMUTABLE
AS $function$
declare
  v_trimmed text;
  v_parts   text[];
begin
  if p_clase is null then
    return query select ''::text, ''::text;
    return;
  end if;

  v_trimmed := btrim(p_clase);
  if v_trimmed = '' then
    return query select ''::text, ''::text;
    return;
  end if;

  -- "Prof"/"Profes" [.] + espacio   (formato original)
  -- "Prof"/"Profa"/... + [.:] + espacios opcionales (formato v2: "PROF: NOMBRE")
  v_parts := regexp_split_to_array(
    v_trimmed,
    '(?i)\s+prof(?:e?s?\.?\s+|[a-z]*[.:]\s*)'
  );

  return query select
    btrim(v_parts[1])::text as materia,
    case when array_length(v_parts, 1) >= 2 then btrim(v_parts[2])::text else ''::text end as docente;
end;
$function$;

-- Backfill: toca solo filas sin docente_id y de lapsos no cerrados.
UPDATE public.horarios h
SET clase_raw = COALESCE(h.clase_raw, h.clase)
WHERE h.docente_id IS NULL
  AND h.clase IS NOT NULL
  AND btrim(h.clase) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.trimestres t
    WHERE t.lapso = h.lapso AND t.estado = 'cerrado'
  );
