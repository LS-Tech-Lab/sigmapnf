// @vitest-environment jsdom
// =====================================================================
// ReporteRango.integration.test.jsx — ARCH-25 (auditoría QA del 15 de
// julio): cobertura de flujo real de componente, no solo funciones
// puras. `ReporteRango.jsx` no tiene un hook separado del que extraer
// la lógica (vive directo en el componente, como `PestanaUsuarios`), así
// que se renderiza completo con @testing-library/react.
//
// Casos cubiertos:
//   1. Carga el reporte vía `asistencias_diarias` con los filtros de
//      rango/turno aplicados y calcula días asistidos / % de asistencia
//      por docente correctamente sobre datos reales de la tabla.
//   2. ADMIN-2: con el permiso `puedeBorrarReportes`, borrar el rango
//      llama a la RPC `admin_borrar_asistencias_rango` con los mismos
//      filtros ya aplicados en pantalla, avisa por toast y refresca.
//   3. Sin el permiso `puedeBorrarReportes`, el botón "Borrar rango" no
//      se muestra (SEC: la UI no ofrece una acción que el backend
//      igualmente rechazaría).
//
// Fuera de alcance (igual que en `PestanaUsuarios.integration.test.jsx`):
// exportación real a PDF/CSV — abren ventana/descarga del navegador,
// capa de riesgo distinta a la que audita este hallazgo (cálculo de
// asistencia + borrado admin).
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../../lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabase } from "../../../lib/supabase";
import ReporteRango from "./ReporteRango";

// Rango fijo de lunes a viernes (5 días hábiles) para que diasHabiles/%
// sean deterministas sin depender de la fecha real de ejecución del test.
const INICIO = "2026-07-06"; // lunes
const FIN    = "2026-07-10"; // viernes

const FILAS_DOCENTE_1 = [
  { id: "a1", cedula_docente: "12345678", nombre_docente: "Prof. Ana Pérez", fecha: "2026-07-06", programa: "PNF INFORMATICA" },
  { id: "a2", cedula_docente: "12345678", nombre_docente: "Prof. Ana Pérez", fecha: "2026-07-07", programa: "PNF INFORMATICA" },
];

// Builder encadenable de Supabase que además es "thenable" (awaitable
// directo), igual que el cliente real y que el resto de mocks del
// proyecto (ver DocenteScan.flow.test.jsx).
function makeQueryMock(result) {
  const builder = {};
  ["select", "gte", "lte", "eq", "order", "range", "abortSignal"].forEach((m) => {
    builder[m] = vi.fn(() => builder);
  });
  builder.then = (resolve) => Promise.resolve(result).then(resolve);
  return builder;
}

function setDateInput(labelText, value) {
  const input = screen.getByText(labelText).closest("label").querySelector("input");
  fireEvent.change(input, { target: { value } });
}

function renderReporte(overrides = {}) {
  const showToast = vi.fn();
  const utils = render(
    <ReporteRango onVolverDiario={vi.fn()} permisos={{}} showToast={showToast} {...overrides} />
  );
  return { ...utils, showToast };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
});

describe("ReporteRango — carga real del reporte por rango", () => {
  it("pagina la consulta a asistencias_diarias y calcula días asistidos / % de asistencia por docente", async () => {
    supabase.from.mockImplementation((tabla) => {
      expect(tabla).toBe("asistencias_diarias");
      return makeQueryMock({ data: FILAS_DOCENTE_1, error: null });
    });

    renderReporte();

    setDateInput("Desde", INICIO);
    setDateInput("Hasta", FIN);

    // 2 días asistidos sobre 5 días hábiles del rango = 40% (< 75%)
    await waitFor(() => screen.getByText("Prof. Ana Pérez"));
    expect(screen.getByText("12345678")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("~8h")).toBeTruthy(); // 2 días × 4h (turno DIURNO)
  });

  it("sin el permiso puedeBorrarReportes no muestra el botón de borrado", async () => {
    supabase.from.mockImplementation(() => makeQueryMock({ data: FILAS_DOCENTE_1, error: null }));

    renderReporte({ permisos: {} });

    await waitFor(() => screen.getByText("Prof. Ana Pérez"));
    expect(screen.queryByText("Borrar rango")).toBeNull();
  });
});

describe("ReporteRango — borrado de rango (ADMIN-2)", () => {
  it("con permiso, borra el rango vía RPC con los filtros aplicados, avisa y refresca", async () => {
    supabase.from.mockImplementation(() => makeQueryMock({ data: FILAS_DOCENTE_1, error: null }));
    supabase.rpc.mockResolvedValue({ data: 2, error: null });

    const { showToast } = renderReporte({ permisos: { puedeBorrarReportes: true } });

    setDateInput("Desde", INICIO);
    setDateInput("Hasta", FIN);
    await waitFor(() => screen.getByText("Prof. Ana Pérez"));

    const llamadasAntesDeBorrar = supabase.from.mock.calls.length;

    fireEvent.click(screen.getByText("Borrar rango"));
    expect(screen.getByText(/¿Borrar reporte de asistencia\?/)).toBeTruthy();

    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("admin_borrar_asistencias_rango", {
        p_fecha_desde: INICIO,
        p_fecha_hasta: FIN,
        p_turno:       "DIURNO",
        p_programa:    null,
      })
    );

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Se borraron 2 registro(s) de asistencia.", "success")
    );
    // fetchRango() se vuelve a disparar tras el borrado exitoso
    await waitFor(() => expect(supabase.from.mock.calls.length).toBeGreaterThan(llamadasAntesDeBorrar));
  });

  it("si la RPC de borrado falla, avisa por toast con el mensaje de error sin romper la pantalla", async () => {
    supabase.from.mockImplementation(() => makeQueryMock({ data: FILAS_DOCENTE_1, error: null }));
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "No autorizado." } });

    const { showToast } = renderReporte({ permisos: { puedeBorrarReportes: true } });

    setDateInput("Desde", INICIO);
    setDateInput("Hasta", FIN);
    await waitFor(() => screen.getByText("Prof. Ana Pérez"));

    fireEvent.click(screen.getByText("Borrar rango"));
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("No autorizado.", "error"));
    // Sigue mostrando los datos ya cargados (no se vació la tabla por el error)
    expect(screen.getByText("Prof. Ana Pérez")).toBeTruthy();
  });
});
