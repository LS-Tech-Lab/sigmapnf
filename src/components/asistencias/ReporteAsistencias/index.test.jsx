// @vitest-environment jsdom
// =====================================================================
// index.test.jsx (ReporteAsistencias — vista diaria)
//
// Fix (caso PNF Agroalimentación, turno MIXTO): el filtro de turno del
// reporte diario mostraba MIXTO como "Todos los turnos" — mismo texto
// que la opción real de "sin filtro" (TODOS) — porque el label era un
// ternario que solo contemplaba DIURNO/VESPERTINO. Ahora sale de
// TURNOS_CONFIG.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../../lib/supabase", () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

vi.mock("../../../utils/reporteCache", () => ({
  guardarReporteEnIDB: vi.fn().mockResolvedValue(undefined),
  cargarReporteDeIDB:  vi.fn().mockResolvedValue(null),
}));

import { supabase } from "../../../lib/supabase";
import ReporteAsistencias from "./index";

function makeQueryMock(result) {
  const builder = {};
  ["select", "eq", "order", "maybeSingle"].forEach((m) => { builder[m] = vi.fn(() => builder); });
  builder.then = (resolve) => Promise.resolve(result).then(resolve);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
  // Cualquier tabla que consulte (asistencias_diarias, docentes,
  // configuracion_reportes) resuelve vacío — solo interesa el <select>.
  supabase.from.mockImplementation(() => makeQueryMock({ data: [], error: null }));
  // Canal realtime chainable (.on().subscribe()) — no se ejercita el
  // realtime en sí, solo se evita que el mount rompa.
  const channelMock = { on: vi.fn(() => channelMock), subscribe: vi.fn(() => channelMock) };
  supabase.channel.mockReturnValue(channelMock);
});

afterEach(() => {
  cleanup();
});

describe("ReporteAsistencias (vista diaria) — labels del filtro de turno", () => {
  it("MIXTO se etiqueta 'Mixto', no 'Todos los turnos' (no se confunde con la opción TODOS real)", () => {
    render(<ReporteAsistencias onVolverPanel={vi.fn()} permisos={{}} showToast={vi.fn()} />);

    const select = screen.getByText("Turno").closest("label").querySelector("select");
    const opciones = Array.from(select.options).map(o => ({ value: o.value, text: o.textContent }));

    const opcionMixto = opciones.find(o => o.value === "MIXTO");
    const opcionTodos = opciones.find(o => o.value === "TODOS");

    expect(opcionMixto).toBeTruthy();
    expect(opcionMixto.text).toBe("Mixto");
    expect(opcionTodos.text).toBe("Todos los turnos");
    // Antes del fix, ambas mostraban el mismo texto — confirma que ya no.
    expect(opcionMixto.text).not.toBe(opcionTodos.text);
  });

  it("DIURNO y VESPERTINO se siguen etiquetando igual que antes — no regresión", () => {
    render(<ReporteAsistencias onVolverPanel={vi.fn()} permisos={{}} showToast={vi.fn()} />);

    const select = screen.getByText("Turno").closest("label").querySelector("select");
    const opciones = Array.from(select.options).map(o => ({ value: o.value, text: o.textContent }));

    expect(opciones.find(o => o.value === "DIURNO").text).toBe("Diurno");
    expect(opciones.find(o => o.value === "VESPERTINO").text).toBe("Vespertino");
  });
});
