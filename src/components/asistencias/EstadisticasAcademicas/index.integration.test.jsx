// @vitest-environment jsdom
// =====================================================================
// EstadisticasAcademicas/index.integration.test.jsx — ESTAD-1.
//
// Mismo patrón de mocking que ReporteRango.integration.test.jsx: mock
// de supabase.rpc() "thenable" tras .abortSignal()/.single(), y
// <SedeProvider> en el árbol porque el componente lee useSedeContext().
//
// recharts (ResponsiveContainer) usa ResizeObserver, que jsdom no
// implementa -- se define un stub mínimo antes de renderizar, igual que
// cualquier setup de recharts en jsdom.
//
// Casos cubiertos:
//   1. Llama a reporte_estadisticas_academicas con los filtros por
//      defecto (turno DIURNO, últimos 30 días) y muestra los totales
//      agregados (asistencias, docentes distintos, sedes con actividad).
//   2. Cambiar los filtros de fecha dispara una nueva llamada a la RPC
//      con los nuevos p_fecha_desde/p_fecha_hasta.
//   3. Sin conexión: no llama a la RPC y muestra el aviso offline.
//   4. Si la RPC devuelve error, se muestra el banner de error y no los
//      totales.
//   5. PROG-3: con puedeVerSoloSuPrograma, el selector de programa queda
//      fijo al programa del usuario (mismo criterio que ReporteRango).
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../../lib/supabase", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

import { supabase } from "../../../lib/supabase";
import EstadisticasAcademicas from "./index";
import { SedeProvider } from "../../../context/SedeContext";

beforeAll_stubResizeObserver();
function beforeAll_stubResizeObserver() {
  if (typeof global.ResizeObserver === "undefined") {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

const DATOS_OK = {
  tendencia: [
    { fecha: "2026-08-08", total_asistencias: 3, docentes_distintos: 2 },
    { fecha: "2026-08-09", total_asistencias: 5, docentes_distintos: 3 },
  ],
  por_docente: [
    { cedula: "12345678", nombre: "Prof. Ana Pérez", dias_asistidos: 4 },
    { cedula: "87654321", nombre: "Prof. Beto Ríos", dias_asistidos: 2 },
  ],
  por_materia: [
    { materia_id: 1, nombre: "Programación I", dias_asistidos: 3 },
  ],
  por_sede: [
    { sede_id: "cabimas", dias_asistidos: 6, docentes_distintos: 3 },
  ],
};

// La RPC no encadena filtros -- solo necesita ser "thenable" tras
// .abortSignal().single(), igual que la llama fetchEstadisticas().
function makeRpcMock(result) {
  const builder = {};
  builder.abortSignal = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(result));
  return builder;
}

// ASIST-4: este componente ahora también consume useTrimestreActivo(),
// que llama a supabase.from("trimestres") -- se mockea aparte para no
// afectar las aserciones existentes sobre supabase.rpc(). Vacío (sin
// trimestres) es un resultado válido -- el hook cae a su fallback
// defensivo (ver useTrimestreActivo.js) y el componente sigue
// funcionando igual que antes de ASIST-4, solo sin el selector visible.
function makeTrimestresQueryMock() {
  const builder = {};
  ["select", "in", "order"].forEach((m) => { builder[m] = vi.fn(() => builder); });
  builder.then = (resolve) => Promise.resolve({ data: [], error: null }).then(resolve);
  return builder;
}

function mockRpc({ data = DATOS_OK, error = null } = {}) {
  supabase.rpc.mockImplementation((fn) => {
    if (fn === "reporte_estadisticas_academicas") {
      return makeRpcMock({ data, error });
    }
    throw new Error(`RPC inesperada en el test: ${fn}`);
  });
}

function setDateInput(labelText, value) {
  const input = screen.getByText(labelText).closest("label").querySelector("input");
  fireEvent.change(input, { target: { value } });
}

function renderDashboard(overrides = {}) {
  return render(
    <SedeProvider value={{ sedeActiva: "cabimas", sedes: [{ id: "cabimas", nombre: "Cabimas" }], setSedeActiva: vi.fn() }}>
      <EstadisticasAcademicas permisos={{}} {...overrides} />
    </SedeProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
  // ASIST-4: supabase.from("trimestres") -- ver makeTrimestresQueryMock().
  supabase.from.mockImplementation(() => makeTrimestresQueryMock());
});

afterEach(() => {
  cleanup();
});

describe("EstadisticasAcademicas — carga real vía RPC agregada en el servidor", () => {
  it("llama a reporte_estadisticas_academicas con turno DIURNO por defecto y muestra los totales", async () => {
    mockRpc();

    renderDashboard();

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith(
      "reporte_estadisticas_academicas",
      expect.objectContaining({ p_turno: "DIURNO", p_sede_id: "cabimas" })
    ));

    // total_asistencias: 3 + 5 = 8 (suma de la serie de tendencia)
    await waitFor(() => expect(screen.getByText("8")).toBeTruthy());
    // docentes_distintos: 2 filas en por_docente
    expect(screen.getByText("2")).toBeTruthy();
    // 1 sede con actividad
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("cambiar el rango de fechas dispara una nueva llamada con los nuevos filtros", async () => {
    mockRpc();
    renderDashboard();

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    supabase.rpc.mockClear();
    mockRpc();

    setDateInput("Desde", "2026-07-01");
    setDateInput("Hasta", "2026-07-15");

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith(
      "reporte_estadisticas_academicas",
      expect.objectContaining({ p_fecha_desde: "2026-07-01", p_fecha_hasta: "2026-07-15" })
    ));
  });

  it("sin conexión: no llama a la RPC y muestra el aviso offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
    mockRpc();

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/Sin conexión/)).toBeTruthy());
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("si la RPC devuelve error, muestra el banner de error", async () => {
    mockRpc({ data: null, error: { message: "Selecciona un programa antes de generar las estadísticas." } });

    renderDashboard();

    await waitFor(() => expect(
      screen.getByText("Selecciona un programa antes de generar las estadísticas.")
    ).toBeTruthy());
  });

  it("PROG-3: con puedeVerSoloSuPrograma, el selector de programa queda fijo al programa del usuario", async () => {
    mockRpc();

    renderDashboard({
      permisos: { puedeVerSoloSuPrograma: true, programasRestringidos: ["PNF Informática"] },
    });

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith(
      "reporte_estadisticas_academicas",
      expect.objectContaining({ p_programa: "PNF Informática" })
    ));

    const select = screen.getByDisplayValue("Informática");
    expect(select.disabled).toBe(true);
  });
});
