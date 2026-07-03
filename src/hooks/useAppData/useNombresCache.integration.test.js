// @vitest-environment jsdom
// =====================================================================
// useNombresCache.integration.test.js — ARCH-5 (auditoría julio 2026):
// cobertura de FLUJO para la carga de nombres de docentes/materias que
// se usa en toda la vista de horarios (carga de horarios → resolución
// de nombres "display" a partir de los "raw" del Excel importado).
//
// Dos flujos de usuario reales:
//   1. La RPC docentes_con_cedula() existe y responde bien → se usa esa
//      fuente (incluye cédulas vinculadas automáticamente por QR).
//   2. La RPC no existe todavía (entorno sin migrar) → debe caer a una
//      consulta directa a la tabla `docentes` sin romper la pantalla,
//      aunque sin cédula_fuente (la RPC es la única que la calcula).
//
// Se mockea supabase — nunca se conecta a una base de datos real.
// =====================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

function makeSelectBuilder(result) {
  // supabase.from("docentes").select("*") — el camino de fallback encadena
  // .select() y luego se usa como thenable (await directo, sin .single()).
  const builder = {
    select: () => Promise.resolve(result),
  };
  return builder;
}

vi.mock("../../lib/supabase", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import useNombresCache from "./useNombresCache";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("useNombresCache — flujo con RPC disponible", () => {
  it("usa docentes_con_cedula() e incluye la fuente de la cédula", async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: [
        { nombre_raw: "PEREZ JUAN", nombre_display: "Juan Pérez", cedula: "12345678", cedula_fuente: "qr" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useNombresCache("user-1"));

    await result.current.fetchDocenteNames();

    await waitFor(() => expect(result.current.docenteNames["PEREZ JUAN"]).toBe("Juan Pérez"));

    expect(supabase.rpc).toHaveBeenCalledWith("docentes_con_cedula");
    expect(result.current.docenteCedulas["PEREZ JUAN"]).toBe("12345678");
    expect(result.current.docenteCedulaFuentes["PEREZ JUAN"]).toBe("qr");
    // No debe haber caído al fallback si la RPC respondió bien.
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("useNombresCache — flujo de fallback cuando la RPC no existe", () => {
  it("cae a la consulta directa de la tabla docentes sin romper la pantalla", async () => {
    supabase.rpc.mockRejectedValueOnce(new Error("function docentes_con_cedula() does not exist"));
    supabase.from.mockReturnValue(
      makeSelectBuilder({
        data: [{ nombre_raw: "GOMEZ ANA", nombre_display: "Ana Gómez", cedula: "87654321" }],
        error: null,
      })
    );

    const { result } = renderHook(() => useNombresCache("user-1"));

    await result.current.fetchDocenteNames();

    await waitFor(() => expect(result.current.docenteNames["GOMEZ ANA"]).toBe("Ana Gómez"));

    expect(supabase.from).toHaveBeenCalledWith("docentes");
    expect(result.current.docenteCedulas["GOMEZ ANA"]).toBe("87654321");
    // El fallback no calcula cedula_fuente — debe quedar vacío, no undefined
    // ni un valor inventado.
    expect(result.current.docenteCedulaFuentes).toEqual({});
  });
});
