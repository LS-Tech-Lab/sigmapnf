// horarioEditing.test.js — ARCH-29 (auditoría 2 ago): cobertura de
// saveClase(), en particular el bloqueo optimista agregado sobre UX-14
// (edición in-line de horarios, sin tests dedicados hasta ahora).
//
// Estrategia de mocking: builder encadenable genérico para
// supabase.from("horarios").update(payload).eq(...).eq(...).select(...),
// con un spy sobre .eq() para poder verificar CON qué columnas se
// condicionó el UPDATE en cada escenario (id solo vs. id + updated_at) —
// es la parte del contrato que más importa para este fix: un guard mal
// armado (ej. que nunca se aplique, o que bloquee guardados legítimos)
// no se vería en un mock que solo verifica el resultado final.
//
// No se prueba deleteClase() acá — ARCH-29 es específicamente sobre el
// UPDATE de horarioEditing.js; deleteClase() queda fuera de alcance de
// este fix (ver AUDITORIA_INDICE.md, fila ARCH-29).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import { createHorarioEditingActions } from "./horarioEditing";

// Builder encadenable: .update() devuelve un objeto con .eq() (que se
// puede llamar más de una vez, como hace el código real cuando llega
// expectedUpdatedAt) y .select(), que es el punto donde se "ejecuta" la
// consulta y se resuelve con el resultado simulado.
function makeUpdateBuilder(result) {
  const eqCalls = [];
  const builder = {
    eq: (col, val) => {
      eqCalls.push([col, val]);
      return builder;
    },
    select: () => Promise.resolve(result),
  };
  return { builder, eqCalls };
}

describe("saveClase — bloqueo optimista (ARCH-29)", () => {
  let showToast, logAudit, fetchHorarios, actions;

  beforeEach(() => {
    vi.clearAllMocks();
    showToast = vi.fn();
    logAudit = vi.fn();
    fetchHorarios = vi.fn().mockResolvedValue(undefined);
    actions = createHorarioEditingActions({
      logAudit,
      showToast,
      fetchHorarios,
      selectedPrograma: "INFORMATICA",
    });
  });

  it("guarda normalmente cuando nadie más editó la fila (updated_at coincide)", async () => {
    const { builder, eqCalls } = makeUpdateBuilder({ data: [{ id: 42 }], error: null });
    const update = vi.fn().mockReturnValue(builder);
    supabase.from.mockReturnValue({ update });

    const payload = { dia: "LUNES", hora: "7:30AM-8:15AM", docente_id: 1, materia_id: 2, clase: "X\nProf. Y" };
    const res = await actions.saveClase(42, payload, "2026-08-01T10:00:00Z");

    expect(res).toEqual({ success: true });
    expect(supabase.from).toHaveBeenCalledWith("horarios");
    expect(update).toHaveBeenCalledWith(payload);
    // El guard se aplicó: se condicionó por id Y por updated_at.
    expect(eqCalls).toEqual([
      ["id", 42],
      ["updated_at", "2026-08-01T10:00:00Z"],
    ]);
    expect(showToast).toHaveBeenCalledWith("Clase actualizada.", "success");
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(fetchHorarios).toHaveBeenCalledWith("INFORMATICA");
  });

  it("detecta conflicto cuando otro usuario ya editó la fila (0 filas afectadas) y NO pisa el cambio ajeno", async () => {
    // El UPDATE con el updated_at viejo no matchea ninguna fila real —
    // Postgres/PostgREST no lo reporta como error, solo como 0 filas.
    const { builder } = makeUpdateBuilder({ data: [], error: null });
    const update = vi.fn().mockReturnValue(builder);
    supabase.from.mockReturnValue({ update });

    const payload = { dia: "MARTES", hora: "8:15AM-9:00AM", docente_id: 1, materia_id: 2, clase: "X\nProf. Y" };
    const res = await actions.saveClase(42, payload, "2026-08-01T10:00:00Z");

    expect(res).toEqual({ success: false, conflict: true });
    // Aviso explícito de conflicto, no el toast de éxito genérico.
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("Otro usuario modificó esta clase"),
      "warning"
    );
    expect(showToast).not.toHaveBeenCalledWith("Clase actualizada.", "success");
    // No se debe auditar como edición exitosa un guardado que no ocurrió.
    expect(logAudit).not.toHaveBeenCalled();
    // Se recarga igual, para que la UI muestre el estado real más reciente.
    expect(fetchHorarios).toHaveBeenCalledWith("INFORMATICA");
  });

  it("sin expectedUpdatedAt, no aplica el guard (retro-compatible con el comportamiento previo a ARCH-29)", async () => {
    const { builder, eqCalls } = makeUpdateBuilder({ data: [{ id: 42 }], error: null });
    const update = vi.fn().mockReturnValue(builder);
    supabase.from.mockReturnValue({ update });

    const payload = { dia: "LUNES", hora: "7:30AM-8:15AM", docente_id: 1, materia_id: 2, clase: "X\nProf. Y" };
    const res = await actions.saveClase(42, payload); // sin tercer argumento

    expect(res).toEqual({ success: true });
    // Solo se condiciona por id — nunca se agrega un .eq("updated_at", ...)
    // con un valor undefined/null que rompería el UPDATE.
    expect(eqCalls).toEqual([["id", 42]]);
    expect(showToast).toHaveBeenCalledWith("Clase actualizada.", "success");
  });

  it("propaga un error real de Supabase sin confundirlo con un conflicto de bloqueo optimista", async () => {
    const { builder } = makeUpdateBuilder({ data: null, error: { message: "permission denied" } });
    const update = vi.fn().mockReturnValue(builder);
    supabase.from.mockReturnValue({ update });

    const payload = { dia: "LUNES", hora: "7:30AM-8:15AM", docente_id: 1, materia_id: 2, clase: "X\nProf. Y" };
    const res = await actions.saveClase(42, payload, "2026-08-01T10:00:00Z");

    expect(res).toEqual({ success: false });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("permission denied"), "error");
    // Un error real no debe disparar el mensaje de conflicto ni recargar
    // como si el guardado hubiera sido superado por otro usuario.
    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringContaining("Otro usuario modificó"),
      "warning"
    );
    expect(fetchHorarios).not.toHaveBeenCalled();
  });
});
