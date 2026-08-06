-- ============================================================================
-- Migración: 0067_conflictos_horario_por_sede.sql
-- Fecha: 6 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Bug reportado: "Conflictos detectados" (ConflictosView) muestra los
-- mismos conflictos sin importar la sede elegida en el selector (SEDE-2).
--
-- CAUSA RAÍZ
-- ----------
-- `conflictos_horario(p_lapso, p_programa)` (0034) y su wrapper
-- `conflictos_horario_detalle(p_lapso, p_programa)` (0032) son de junio
-- de 2026, antes de que existiera el sistema de Sedes (0061+). Ambas son
-- SECURITY DEFINER -- corren con los privilegios del dueño de la función,
-- así que NINGUNA política RLS (ni usuario_puede_ver_sede(sede_id) de
-- 0063) las alcanza. El CTE base de conflictos_horario() nunca tuvo
-- filtro de sede: lee `horarios` filtrando solo por lapso/programa, así
-- que siempre calcula conflictos sobre TODAS las sedes. Con una sola
-- sede en producción esto nunca se notó -- mismo patrón exacto que ya se
-- corrigió en 0065 (borrar_horarios/restaurar_backup) y 0066
-- (docentes_con_cedula).
--
-- FIX
-- ---
-- Se agrega p_sede_id a ambas funciones y se resuelve la sede efectiva
-- con el mismo patrón ya establecido en 0064/0065/0066: sede fija del
-- perfil, o p_sede_id explícito si el rol tiene puedeVerTodasLasSedes.
-- No se agrega ningún chequeo de permiso adicional -- ver conflictos no
-- requiere un permiso propio, cualquier usuario autenticado que puede ver
-- los horarios de su sede puede ver sus conflictos.
-- ============================================================================


-- ── 1. conflictos_horario — agrega p_sede_id, filtra el CTE base ────────────
-- FIX (mismo patrón que 0064/0065/0066): la firma cambia (se agrega
-- p_sede_id) -- se sueltan dinámicamente todos los overloads existentes
-- antes de recrearla, en vez de confiar en CREATE OR REPLACE (que no
-- reemplaza cuando cambia la firma y deja COMMENT/REVOKE/GRANT
-- ambiguos, error 42725). También cambia de LANGUAGE sql a plpgsql
-- porque ahora necesita resolver la sede efectiva con IF/RAISE antes de
-- construir el resultado.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'conflictos_horario'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.conflictos_horario(
  p_lapso    text,
  p_programa text DEFAULT NULL,
  p_sede_id  text DEFAULT NULL
)
RETURNS TABLE(
  docente_id     bigint,
  docente_nombre text,
  dia            text,
  horario_a_id   bigint,
  horario_b_id   bigint,
  hora_a         text,
  hora_b         text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sede_efectiva TEXT;
BEGIN
  -- Mismo criterio de resolución de sede que borrar_horarios/
  -- restaurar_backup/crear_qr_session/docentes_con_cedula (0064/0065/0066):
  -- sede fija del perfil primero; si no tiene, exige puedeVerTodasLasSedes
  -- + p_sede_id válido.
  SELECT sede_id INTO v_sede_efectiva FROM user_profiles WHERE id = auth.uid();

  IF v_sede_efectiva IS NULL THEN
    IF NOT tiene_permiso(auth.uid(), 'puedeVerTodasLasSedes') THEN
      RAISE EXCEPTION 'Tu usuario no tiene una sede asignada.';
    END IF;
    IF p_sede_id IS NULL OR NOT EXISTS (SELECT 1 FROM sedes WHERE id = p_sede_id) THEN
      RAISE EXCEPTION 'Selecciona una sede antes de ver conflictos.';
    END IF;
    v_sede_efectiva := p_sede_id;
  END IF;

  RETURN QUERY
  with base as (
    select
      h.id,
      h.docente_id,
      h.dia,
      h.hora,
      pr.inicio,
      pr.fin
    from public.horarios h
    cross join lateral public.parse_rango_hora(h.hora) pr
    where h.lapso = p_lapso
      and h.docente_id is not null
      and h.sede_id = v_sede_efectiva
      and (p_programa is null or h.programa = p_programa)
  )
  select
    a.docente_id,
    d.nombre_display,
    a.dia,
    a.id as horario_a_id,
    b.id as horario_b_id,
    a.hora as hora_a,
    b.hora as hora_b
  from base a
  join base b
    on a.docente_id = b.docente_id
   and a.dia = b.dia
   and a.id < b.id
  join public.docentes d on d.id = a.docente_id
  where
    (
      a.inicio is not null and b.inicio is not null
      and a.inicio < b.fin and b.inicio < a.fin
    )
    or
    (
      (a.inicio is null or b.inicio is null)
      and btrim(a.hora) = btrim(b.hora)
    )
  order by d.nombre_display, a.dia, a.id, b.id;
END;
$function$;

COMMENT ON FUNCTION public.conflictos_horario(text, text, text) IS
  'SEDE-9: agrega p_sede_id y filtra el CTE base por sede_id. Antes era '
  'SECURITY DEFINER sin NINGÚN filtro de sede -- bypassaba RLS (0063) por '
  'completo y calculaba conflictos sobre horarios de todas las sedes. '
  'Resuelve la sede efectiva igual que borrar_horarios/restaurar_backup/'
  'crear_qr_session/docentes_con_cedula (sede fija del perfil, o '
  'p_sede_id si el rol tiene puedeVerTodasLasSedes).';

REVOKE ALL    ON FUNCTION public.conflictos_horario(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conflictos_horario(text, text, text) TO authenticated;


-- ── 2. conflictos_horario_detalle — wrapper, agrega p_sede_id ───────────────
DROP FUNCTION IF EXISTS public.conflictos_horario_detalle(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.conflictos_horario_detalle(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.conflictos_horario_detalle(
  p_lapso    TEXT DEFAULT NULL,
  p_programa TEXT DEFAULT NULL,
  p_sede_id  TEXT DEFAULT NULL
)
RETURNS TABLE (
  docente_id     BIGINT,
  docente_nombre TEXT,
  dia            TEXT,
  hora           TEXT,
  horario_a      JSONB,
  horario_b      JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.docente_id,
    c.docente_nombre,
    c.dia,
    c.hora_a AS hora,
    to_jsonb(ha) - 'docente_id' - 'materia_id' - 'clase_raw' AS horario_a,
    to_jsonb(hb) - 'docente_id' - 'materia_id' - 'clase_raw' AS horario_b
  FROM public.conflictos_horario(p_lapso, p_programa, p_sede_id) c
  JOIN public.horarios ha ON ha.id = c.horario_a_id
  JOIN public.horarios hb ON hb.id = c.horario_b_id;
$$;

COMMENT ON FUNCTION public.conflictos_horario_detalle(text, text, text) IS
  'SEDE-9: wrapper de conflictos_horario() -- ahora recibe p_sede_id y lo '
  'reenvía. Usada por useConflictos.js con fallback local (que ya '
  'filtraba por sede correctamente vía SEDE-6, esta migración solo '
  'corrige el camino RPC primario).';

REVOKE ALL    ON FUNCTION public.conflictos_horario_detalle(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conflictos_horario_detalle(text, text, text) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. Con datos de prueba en dos sedes: SELECT * FROM
--    conflictos_horario_detalle('<lapso>', NULL, 'cabimas') -> solo
--    conflictos de Cabimas. Con la otra sede -> solo esa sede (vacío si
--    no tiene data solapada).
-- 2. Desde un usuario con sede fija: SELECT * FROM
--    conflictos_horario_detalle('<lapso>') (sin p_sede_id) -> solo su
--    sede, ignora cualquier otro dato.
-- 3. Desde un usuario con puedeVerTodasLasSedes y sin p_sede_id -> debe
--    rechazar pidiendo que seleccione una sede.
-- 4. Confirmar que el frontend (useConflictos.js / useAppData/index.js)
--    empieza a mandar sedeActiva como p_sede_id -- ver el cambio de
--    frontend correspondiente en el mismo despliegue; sin eso, esta
--    migración por sí sola no arregla el bug reportado, porque el
--    cliente actual llama la RPC sin ese argumento.
-- ============================================================================
