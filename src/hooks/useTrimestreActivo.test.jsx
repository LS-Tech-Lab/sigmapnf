// @vitest-environment jsdom
// =====================================================================
// useTrimestreActivo.test.jsx — ASIST-8 (auditoría 16 ago 2026):
// cobertura del caso real que motivó el fix -- un trimestre marcado
// `estado = 'activo'` en la BD cuyo `fecha_inicio` todavía no llegó (o
// cuyo `fecha_fin` ya pasó) deja un "hueco" donde hoy no cae dentro de
// ningún trimestre. Antes de este fix, el hook saltaba igual al activo
// (vacío de datos); ahora debe preferir el último `cerrado` mientras
// dure el hueco, y el usuario puede cambiar manualmente con el selector.
//
// Se mockea todo el módulo supabase (chain de trimestres) y
// utils/time#fechaHoyVE, para no depender del reloj real ni de una
// conexión real a la base -- mismo criterio que
// useQRSession.integration.test.js.
// =====================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

let mockRows = [];

vi.mock("../lib/supabase", () => {
  const chain = {
    select: vi.fn(function () { return this; }),
    in: vi.fn(function () { return this; }),
    order: vi.fn(function () { return this; }),
  };
  return {
    supabase: {
      from: vi.fn(() => ({
        ...chain,
        // El hook encadena .select().in().order().order() y espera el
        // resultado -- como es un thenable simulado, resolvemos al final
        // de la cadena devolviendo la promesa directamente.
        then: (resolve) => resolve({ data: mockRows, error: null }),
      })),
    },
  };
});

vi.mock("../utils/time", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fechaHoyVE: () => "2026-08-16" };
});

import useTrimestreActivo from "./useTrimestreActivo";

describe("useTrimestreActivo — ASIST-8: hueco entre trimestres", () => {
  beforeEach(() => {
    mockRows = [];
  });

  it("usa el activo cuando hoy cae dentro de su rango (caso normal)", async () => {
    mockRows = [
      { lapso: "3-2026", estado: "activo", fecha_inicio: "2026-08-01", fecha_fin: "2026-11-30" },
      { lapso: "2-2026", estado: "cerrado", fecha_inicio: "2026-05-11", fecha_fin: "2026-07-31" },
    ];
    const { result } = renderHook(() => useTrimestreActivo());
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.lapso).toBe("3-2026");
  });

  it("usa el último cerrado cuando el activo aún no empieza (caso real 16 ago 2026)", async () => {
    mockRows = [
      { lapso: "3-2026", estado: "activo", fecha_inicio: "2026-09-28", fecha_fin: "2026-12-11" },
      { lapso: "2-2026", estado: "cerrado", fecha_inicio: "2026-05-11", fecha_fin: "2026-07-31" },
    ];
    const { result } = renderHook(() => useTrimestreActivo());
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.lapso).toBe("2-2026");
  });

  it("elige el cerrado con fecha_fin más reciente si hay varios y el activo no cubre hoy", async () => {
    mockRows = [
      { lapso: "3-2026", estado: "activo", fecha_inicio: "2026-09-28", fecha_fin: "2026-12-11" },
      { lapso: "2-2026", estado: "cerrado", fecha_inicio: "2026-05-11", fecha_fin: "2026-07-31" },
      { lapso: "1-2026", estado: "cerrado", fecha_inicio: "2026-01-13", fecha_fin: "2026-04-24" },
    ];
    const { result } = renderHook(() => useTrimestreActivo());
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.lapso).toBe("2-2026");
  });

  it("el selector sigue permitiendo cambiar manualmente al activo vacío", async () => {
    mockRows = [
      { lapso: "3-2026", estado: "activo", fecha_inicio: "2026-09-28", fecha_fin: "2026-12-11" },
      { lapso: "2-2026", estado: "cerrado", fecha_inicio: "2026-05-11", fecha_fin: "2026-07-31" },
    ];
    const { result } = renderHook(() => useTrimestreActivo());
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.lapso).toBe("2-2026");

    result.current.setLapso("3-2026");
    await waitFor(() => expect(result.current.lapso).toBe("3-2026"));
  });
});
