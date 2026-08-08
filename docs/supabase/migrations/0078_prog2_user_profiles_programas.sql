-- ============================================================================
-- Migración: 0078_prog2_user_profiles_programas.sql
-- Fecha: 8 de agosto de 2026
--
-- CONTEXTO
-- --------
-- Primera fase (PROG-2) de la serie PROG-N (aislamiento por programa,
-- análoga a SEDE-N). Mapeo previo (PROG-1, ver AUDITORIA_INDICE.md)
-- confirmó que `puedeVerTodo`/`puedeVerSoloSuPrograma` es hoy un filtro
-- puramente de cliente, sin ningún respaldo en RLS.
--
-- DIFERENCIA CLAVE CON SEDE, decidida antes de escribir esto:
--   Sede es 1:1 por usuario (user_profiles.sede_id, columna escalar).
--   Programa NO puede modelarse igual: un coordinador puede tener más de
--   un programa a cargo. Copiar el patrón de sede_id escalar dejaría sin
--   forma de representar ese caso real.
--
-- DISEÑO — esta migración es SOLO esquema, igual que 0061 (SEDE-1) lo fue
-- para sede. A propósito NO toca RLS de horarios/docentes/materias/
-- asistencias_diarias todavía (eso es PROG-3) ni cambios en el frontend —
-- aplicar aislamiento antes de que la UI mande/use esto dejaría la app
-- rota en el aire, mismo razonamiento que en 0061.
--
--   1. Tabla nueva `user_profiles_programas`: relación N:N entre un
--      usuario y los programas que puede ver, independiente de la
--      columna escalar `user_profiles.programa` que YA EXISTE y que se
--      deja intacta (sigue siendo el "programa principal" que hoy usa
--      la UI para preseleccionar el filtro y para `restringe_programa`
--      en altas de un solo programa vía ModalUsuario). Los dos conviven:
--      `programa` = default/legado de un-solo-programa, la tabla nueva =
--      la fuente real para el chequeo de acceso cuando alguien tiene más
--      de uno. Reconciliar/deprecar la columna escalar queda para una
--      migración aparte una vez el frontend soporte asignar varios
--      programas a un coordinador (hoy `ModalUsuario.jsx` solo permite
--      uno) — no es parte de PROG-2.
--   2. Backfill: cada fila de `user_profiles` con `programa` no nulo
--      genera su fila correspondiente en la tabla nueva, para que nadie
--      pierda acceso el día que PROG-3 empiece a exigir esto.
--   3. Helper `usuario_puede_ver_programa(p_programa)`, mismo patrón
--      exacto que `usuario_puede_ver_sede()` (0063): true si el usuario
--      tiene `puedeVerTodo`, o si `p_programa` está entre los suyos en la
--      tabla nueva.
--
-- PENDIENTE A PROPÓSITO (no es parte de esta migración, igual que 0061
-- documentó sus propios pendientes):
--   - No existe un catálogo `programas` con FK, a diferencia de `sedes`.
--     `programa` es texto libre ya canonicalizado del lado del cliente
--     (normalizarPrograma() en src/utils/parsing.js, 4 valores conocidos
--     hoy: Informática, Contaduría Pública, Agroalimentación, Educación
--     Especial). El chequeo de acceso es por igualdad de texto exacto
--     contra ese valor ya canonicalizado -- funciona, pero sin un
--     catálogo no hay forma de detectar un typo al asignarle a un
--     coordinador un programa que no existe. Si esto se vuelve un
--     problema real (no lo es hoy, con 4 valores estables), un catálogo
--     `programas` + FK es la fase siguiente natural, análoga a `sedes`.
--   - RLS de aislamiento real sobre horarios/docentes/materias/
--     asistencias_diarias -- PROG-3. Hoy esas tablas solo tienen
--     aislamiento por sede (SEDE-3); programa sigue sin exigirse ahí.
--   - UI para asignar más de un programa a un coordinador
--     (`ModalUsuario.jsx` hoy es de-uno-solo) -- necesaria antes de que
--     PROG-2 tenga utilidad real más allá del backfill 1:1 actual.
-- ============================================================================


-- ── 1. Tabla de relación N:N usuario ↔ programa ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles_programas (
  user_id    uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  programa   text NOT NULL,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, programa)
);

COMMENT ON TABLE public.user_profiles_programas IS
  'PROG-2. Relación N:N entre un usuario y los programas que puede ver -- '
  'a diferencia de sede (1:1, user_profiles.sede_id), un coordinador puede '
  'tener más de un programa a cargo. user_profiles.programa (columna '
  'escalar) sigue existiendo como "programa principal/legado" para la UI; '
  'esta tabla es la fuente real para el chequeo de acceso vía '
  'usuario_puede_ver_programa().';

CREATE INDEX IF NOT EXISTS idx_user_profiles_programas_user
  ON public.user_profiles_programas (user_id);


-- ── 2. Backfill desde la columna escalar existente ───────────────────────────
INSERT INTO public.user_profiles_programas (user_id, programa)
SELECT id, programa
FROM public.user_profiles
WHERE programa IS NOT NULL
ON CONFLICT (user_id, programa) DO NOTHING;


-- ── 3. RLS de la tabla nueva ──────────────────────────────────────────────
-- Mismo criterio que user_profiles (0016/0025/0043): cada quien ve sus
-- propias filas; quien tiene puedeGestionarUsuarios ve/gestiona todas
-- (necesario para ModalUsuario cuando ese módulo empiece a permitir
-- asignar varios programas). Escritura (insert/update/delete) reservada
-- a puedeGestionarUsuarios -- esto se gestiona desde el módulo de
-- usuarios, no es autoservicio.
ALTER TABLE public.user_profiles_programas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upp_select ON public.user_profiles_programas;
CREATE POLICY upp_select ON public.user_profiles_programas
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR tiene_permiso(auth.uid(), 'puedeGestionarUsuarios')
  );

DROP POLICY IF EXISTS upp_insert ON public.user_profiles_programas;
CREATE POLICY upp_insert ON public.user_profiles_programas
  FOR INSERT
  TO authenticated
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarUsuarios'));

DROP POLICY IF EXISTS upp_update ON public.user_profiles_programas;
CREATE POLICY upp_update ON public.user_profiles_programas
  FOR UPDATE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeGestionarUsuarios'))
  WITH CHECK (tiene_permiso(auth.uid(), 'puedeGestionarUsuarios'));

DROP POLICY IF EXISTS upp_delete ON public.user_profiles_programas;
CREATE POLICY upp_delete ON public.user_profiles_programas
  FOR DELETE
  TO authenticated
  USING (tiene_permiso(auth.uid(), 'puedeGestionarUsuarios'));


-- ── 4. Helper: usuario_puede_ver_programa ────────────────────────────────────
-- Mismo patrón exacto que usuario_puede_ver_sede() (0063).
CREATE OR REPLACE FUNCTION public.usuario_puede_ver_programa(p_programa text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT
       (r.permisos ->> 'puedeVerTodo') = 'true'
       OR EXISTS (
         SELECT 1 FROM user_profiles_programas upp
         WHERE upp.user_id = up.id AND upp.programa = p_programa
       )
     FROM user_profiles up
     JOIN roles r ON r.nombre = up.rol
     WHERE up.id = auth.uid() AND up.activo = true),
    false
  );
$$;

COMMENT ON FUNCTION public.usuario_puede_ver_programa IS
  'PROG-2. true si el usuario autenticado actual tiene puedeVerTodo, o si '
  'p_programa está entre los suyos en user_profiles_programas. Mismo '
  'patrón que usuario_puede_ver_sede() (0063): SQL/STABLE/SECURITY '
  'DEFINER, exige activo=true. Todavía sin usar en ninguna política RLS '
  'de datos (horarios/docentes/materias/asistencias_diarias) -- eso es '
  'PROG-3.';

REVOKE ALL    ON FUNCTION public.usuario_puede_ver_programa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_puede_ver_programa(text) TO authenticated;


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT count(*) FROM user_profiles_programas;
--    -- debe coincidir con count(*) FROM user_profiles WHERE programa IS NOT NULL
-- 2. Como usuario normal: SELECT * FROM user_profiles_programas;
--    -- debe devolver solo sus propias filas
-- 3. Como usuario con puedeGestionarUsuarios: mismo SELECT
--    -- debe devolver TODAS las filas
-- 4. SELECT usuario_puede_ver_programa('PNF Informática');
--    -- true si es el programa del usuario actual (o tiene puedeVerTodo),
--    -- false si no
-- ============================================================================
