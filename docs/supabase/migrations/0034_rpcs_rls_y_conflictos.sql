-- =============================================================================
-- Migración 0034 — Documentar funciones faltantes: RLS y conflictos de horario
-- Detectadas en auditoría técnica Junio 2026 (pendiente indicado en 0032/0033).
-- Ambas funciones existían en producción sin respaldo en el repositorio.
-- =============================================================================

-- ── 1. _aplicar_rls_horarios ─────────────────────────────────────────────────
-- Aplica RLS estándar a una tabla de horarios dinámica (partición por lapso).
-- Llamada por: asegurar_particion_lapso (documentada en 0032).
-- Políticas que instala:
--   • "Lectura pública"         → SELECT para todos
--   • "Escritura autenticada"   → ALL para usuarios autenticados
--   • "Permitir todo a horarios"→ INSERT sin restricción (legacy, cubre casos edge)
--   • "Enable delete for all users" → DELETE sin restricción (legacy)

CREATE OR REPLACE FUNCTION public._aplicar_rls_horarios(p_table_name text)
RETURNS void
LANGUAGE plpgsql
AS $function$
begin
  execute format('alter table public.%I enable row level security', p_table_name);

  execute format(
    'drop policy if exists %I on public.%I', 'Lectura pública', p_table_name
  );
  execute format(
    'create policy %I on public.%I for select to public using (true)',
    'Lectura pública', p_table_name
  );

  execute format(
    'drop policy if exists %I on public.%I', 'Escritura autenticada', p_table_name
  );
  execute format(
    'create policy %I on public.%I for all to public using (auth.role() = ''authenticated'')',
    'Escritura autenticada', p_table_name
  );

  execute format(
    'drop policy if exists %I on public.%I', 'Permitir todo a horarios', p_table_name
  );
  execute format(
    'create policy %I on public.%I for insert to public with check (true)',
    'Permitir todo a horarios', p_table_name
  );

  execute format(
    'drop policy if exists %I on public.%I', 'Enable delete for all users', p_table_name
  );
  execute format(
    'create policy %I on public.%I for delete to public using (true)',
    'Enable delete for all users', p_table_name
  );
end;
$function$;


-- ── 2. conflictos_horario ────────────────────────────────────────────────────
-- Detecta conflictos de horario para un docente en un lapso dado.
-- Parámetros:
--   p_lapso    (obligatorio) — lapso a analizar, ej: '2025-I'
--   p_programa (opcional)   — filtrar por programa; NULL = todos los programas
-- Retorna pares de bloques solapados por docente/día.
-- Llamada por: conflictos_horario_detalle (documentada en 0032).
-- Depende de: public.parse_rango_hora (función existente en BD).

CREATE OR REPLACE FUNCTION public.conflictos_horario(
  p_lapso    text,
  p_programa text DEFAULT NULL
)
RETURNS TABLE(
  docente_id    bigint,
  docente_nombre text,
  dia           text,
  horario_a_id  bigint,
  horario_b_id  bigint,
  hora_a        text,
  hora_b        text
)
LANGUAGE sql
STABLE
AS $function$
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
$function$;
