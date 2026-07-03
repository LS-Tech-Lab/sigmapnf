// @vitest-environment jsdom
// =====================================================================
// useConflictos.integration.test.js — ARCH-5 (auditoría julio 2026):
// cobertura de FLUJO, no solo de función pura.
//
// conflictos.test.js ya cubre calcularConflictosLocal() como función
// aislada. Lo que faltaba cubrir es el hook completo: la orquestación
// real entre Supabase y el fallback, que es exactamente el camino que
// se ejecuta cuando un usuario abre la vista de horarios.
//
// Dos flujos de usuario reales:
//   1. La RPC conflictos_horario_detalle() existe y responde bien →
//      el hook debe adaptar las filas SQL al shape que consumen los
//      componentes y NO debe caer al cálculo local.
//   2. La RPC falla (entorno sin migrar, o error de red) → el hook
//      debe caer automáticamente al cálculo local con los mismos datos
//      que ya tiene en memoria, sin dejar la UI colgada ni sin datos.
//
// Se mockea supabase.rpc — nunca se conecta a una base de datos real.
// =====================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// El mock debe declararse antes del import del hook que lo consume.
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "../lib/supabase";
import useConflictos from "./useConflictos";

// Dataset mínimo para el cálculo local de fallback: dos clases del mismo
// docente, mismo día, con horarios solapados → un conflicto esperado.
// Formato idéntico al que ya usa conflictos.test.js para
// calcularConflictosLocal (DAYS en mayúsculas, hora "H:MMAM/PM - H:MMAM/PM").
const datosConSolape = [
  { id: 1, clase: "Cálculo I Prof. Ana Pérez", dia: "LUNES", hora: "7:00AM - 8:00AM" },
  { id: 2, clase: "Física I Prof. Ana Pérez",  dia: "LUNES", hora: "7:30AM - 8:30AM" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useConflictos — flujo con RPC disponible", () => {
  it("usa los datos de la RPC y NO activa el fallback local", async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: [
        {
          docente_id: 10,
          docente_nombre: "Ana Pérez",
          dia: "Lunes",
          hora: "07:00-09:00",
          horario_a: { id: 1, clase: "Prof. Ana Pérez - Cálculo I" },
          horario_b: { id: 2, clase: "Prof. Ana Pérez - Física I" },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() =>
      useConflictos({ lapso: "2026-1", selectedPrograma: "todos", data: datosConSolape })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(supabase.rpc).toHaveBeenCalledWith(
      "conflictos_horario_detalle",
      { p_lapso: "2026-1", p_programa: null }
    );
    expect(result.current.usingFallback).toBe(false);
    expect(result.current.conflicts).toHaveLength(1);
    expect(result.current.conflicts[0].docente).toBe("Ana Pérez");
    expect(result.current.conflicts[0].entries).toHaveLength(2);
  });
});

describe("useConflictos — flujo de fallback cuando la RPC falla", () => {
  it("cae al cálculo local y marca usingFallback=true sin dejar la UI sin datos", async () => {
    supabase.rpc.mockRejectedValueOnce(new Error("function conflictos_horario_detalle does not exist"));

    const { result } = renderHook(() =>
      useConflictos({ lapso: "2026-1", selectedPrograma: "todos", data: datosConSolape })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.usingFallback).toBe(true);
    // El cálculo local debe seguir encontrando el mismo conflicto real,
    // para que el usuario no pierda la detección de choques de horario
    // solo porque la RPC todavía no está desplegada en su entorno.
    expect(result.current.conflicts.length).toBeGreaterThan(0);
  });

  it("refetchConflictos() vuelve a intentar la RPC (permite recuperarse sin recargar la página)", async () => {
    supabase.rpc
      .mockRejectedValueOnce(new Error("RPC no disponible"))
      .mockResolvedValueOnce({ data: [], error: null });

    const { result } = renderHook(() =>
      useConflictos({ lapso: "2026-1", selectedPrograma: "todos", data: datosConSolape })
    );

    await waitFor(() => expect(result.current.usingFallback).toBe(true));

    await result.current.refetchConflictos();

    await waitFor(() => expect(result.current.usingFallback).toBe(false));
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });
});
