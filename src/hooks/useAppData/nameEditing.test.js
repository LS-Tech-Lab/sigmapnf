// nameEditing.test.js — SEDE-11 (auditoría 6 ago): cobertura de que el
// fallback legacy de unificación (unifyNameLegacy, disparado cuando
// renombrar_docente/renombrar_materia no está disponible) manda
// p_sede_id a replace_nombre_en_clases. Esa RPC pasó a exigirlo en la
// migración 0068 — sin este test, un futuro cambio en nameEditing.js
// podría dejar de mandarlo sin que ningún test lo note (la RPC real solo
// falla contra una BD viva, no en este mock).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import { createNameEditingActions } from "./nameEditing";

// Builder encadenable mínimo para supabase.from(...).select/upsert/delete/
// update/eq/ilike/neq/limit/maybeSingle — cada test ajusta la resolución
// final según lo que necesite.
function makeQueryBuilder(overrides = {}) {
  const builder = {
    select: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(overrides.limitResult ?? { data: [], error: null })),
    delete: vi.fn(() => builder),
    upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    maybeSingle: vi.fn(() => Promise.resolve(overrides.maybeSingleResult ?? { data: null, error: null })),
  };
  return builder;
}

function baseDeps(overrides = {}) {
  return {
    logAudit: vi.fn(),
    showToast: vi.fn(),
    selectedPrograma: "todos",
    setDocenteNames: vi.fn(),
    setMateriaNames: vi.fn(),
    fetchDocenteNames: vi.fn(),
    fetchMateriaNames: vi.fn(),
    fetchHorarios: vi.fn(),
    setConflictsRefreshKey: vi.fn(),
    sedeActiva: "cabimas",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nameEditing — unifyNameLegacy manda p_sede_id a replace_nombre_en_clases (SEDE-11)", () => {
  it("saveDocenteName: cuando renombrar_docente no existe y hay colisión de nombre_display, la RPC legacy recibe p_sede_id = sedeActiva", async () => {
    // 1º .from("docentes").select("id")... — no encuentra fila por
    // nombre_raw, así que cae al flujo legacy en vez de renombrar_docente.
    const findBuilder = makeQueryBuilder({ maybeSingleResult: { data: null, error: null } });
    // 2º .from("docentes").select("nombre_raw, nombre_display")... —
    // SÍ encuentra una colisión, dispara unifyNameLegacy.
    const collisionBuilder = makeQueryBuilder({
      limitResult: { data: [{ nombre_raw: "juan perez", nombre_display: "Juan Pérez" }], error: null },
    });
    // 3º .from("docentes").delete()... — limpia la fila huérfana.
    const deleteBuilder = makeQueryBuilder();
    deleteBuilder.eq = vi.fn(() => Promise.resolve({ error: null }));

    let call = 0;
    supabase.from.mockImplementation(() => {
      call += 1;
      if (call === 1) return findBuilder;
      if (call === 2) return collisionBuilder;
      return deleteBuilder;
    });
    supabase.rpc.mockResolvedValue({ error: null });

    const { saveDocenteName } = createNameEditingActions(baseDeps({ sedeActiva: "ciudad_ojeda" }));
    const result = await saveDocenteName("juan perez raw", "Juan Pérez");

    expect(result.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("replace_nombre_en_clases", {
      old_raw: "juan perez raw",
      new_raw: "juan perez",
      p_sede_id: "ciudad_ojeda",
    });
  });

  it("con sedeActiva null (rol con puedeVerTodasLasSedes sin sede elegida), manda p_sede_id: null en vez de omitir el parámetro", async () => {
    const findBuilder = makeQueryBuilder({ maybeSingleResult: { data: null, error: null } });
    const collisionBuilder = makeQueryBuilder({
      limitResult: { data: [{ nombre_raw: "ana ruiz", nombre_display: "Ana Ruiz" }], error: null },
    });
    const deleteBuilder = makeQueryBuilder();
    deleteBuilder.eq = vi.fn(() => Promise.resolve({ error: null }));

    let call = 0;
    supabase.from.mockImplementation(() => {
      call += 1;
      if (call === 1) return findBuilder;
      if (call === 2) return collisionBuilder;
      return deleteBuilder;
    });
    supabase.rpc.mockResolvedValue({ error: null });

    const { saveMateriaName } = createNameEditingActions(baseDeps({ sedeActiva: null }));
    await saveMateriaName("ana ruiz raw", "Ana Ruiz");

    expect(supabase.rpc).toHaveBeenCalledWith("replace_nombre_en_clases", {
      old_raw: "ana ruiz raw",
      new_raw: "ana ruiz",
      p_sede_id: null,
    });
  });
});
