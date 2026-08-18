// @vitest-environment jsdom
// =====================================================================
// ReporteRango.integration.test.jsx — ARCH-25 (auditoría QA del 15 de
// julio): cobertura de flujo real de componente, no solo funciones
// puras. `ReporteRango.jsx` no tiene un hook separado del que extraer
// la lógica (vive directo en el componente, como `PestanaUsuarios`), así
// que se renderiza completo con @testing-library/react.
//
// ACTUALIZADO (ARCH-27, auditoría 1 ago 2026): el componente ya no pagina
// filas crudas de `asistencias_diarias` — llama a la RPC
// `reporte_asistencias_rango_agregado` (agregada en el servidor) más un
// conteo liviano (`head: true`) para el modal de borrado. Los mocks de
// este archivo se actualizan para reflejar esa llamada; las aserciones de
// negocio (% de asistencia, horas estimadas, borrado admin) se mantienen
// intactas — solo cambia CÓMO llegan los datos, no qué calculan.
//
// Casos cubiertos:
//   1. Carga el reporte vía la RPC de agregación con los filtros de
//      rango/turno aplicados y muestra días asistidos / % de asistencia
//      por docente ya agregados desde el servidor.
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
import { SedeProvider } from "../../../context/SedeContext";

// Rango fijo de lunes a viernes (5 días hábiles) para que diasHabiles/%
// sean deterministas sin depender de la fecha real de ejecución del test.
const INICIO = "2026-07-06"; // lunes
const FIN    = "2026-07-10"; // viernes

// Ya viene agregado desde el servidor: 1 fila por docente, no por evento
// de asistencia — 2 días asistidos ya calculados, como los devolvería
// reporte_asistencias_rango_agregado.
const AGREGADO_DOCENTE_1 = [
  { cedula_docente: "12345678", nombre_docente: "Prof. Ana Pérez", dias_asistidos: 2, programas: ["PNF INFORMATICA"] },
];

// Builder encadenable de Supabase que además es "thenable" (awaitable
// directo), igual que el cliente real y que el resto de mocks del
// proyecto (ver DocenteScan.flow.test.jsx).
function makeQueryMock(result) {
  const builder = {};
  // ASIST-4/5: agregado "in" -- useTrimestreActivo() (que ReporteRango
  // ahora consume, tanto para el preset de trimestre como para el guard
  // de "Borrar rango") filtra por estado con .in().
  ["select", "gte", "lte", "eq", "in", "order", "range", "abortSignal"].forEach((m) => {
    builder[m] = vi.fn(() => builder);
  });
  builder.then = (resolve) => Promise.resolve(result).then(resolve);
  return builder;
}

// ASIST-4/5: trimestre activo de prueba cuyo rango cubre INICIO..FIN --
// si no cubriera el rango, el guard de "Borrar rango" (rangoFueraDeVigencia,
// ver ReporteRango.jsx) lo deshabilitaría y romperían los tests de borrado
// de este archivo, que no son sobre ese guard sino sobre el flujo de RPC.
const TRIMESTRE_ACTIVO_MOCK = { lapso: "2-2026", estado: "activo", fecha_inicio: "2026-05-11", fecha_fin: "2026-08-31" };

// La RPC no encadena filtros como .from() — solo necesita ser "thenable"
// tras .abortSignal(), igual que la llama fetchRango().
function makeRpcMock(result) {
  const builder = {};
  builder.abortSignal = vi.fn(() => builder);
  builder.then = (resolve) => Promise.resolve(result).then(resolve);
  return builder;
}

// Configura ambos mocks de una vez: supabase.rpc(...) para el reporte
// agregado y supabase.from("asistencias_diarias") para el conteo (head).
// El resto de llamadas a supabase.rpc (ej. admin_borrar_asistencias_rango)
// se resuelven aparte en cada test que las necesite.
function mockReporteYConteo({ agregado = AGREGADO_DOCENTE_1, total = agregado.length, rpcMock } = {}) {
  supabase.rpc.mockImplementation((fn, args) => {
    if (fn === "reporte_asistencias_rango_agregado") {
      return makeRpcMock({ data: agregado, error: null });
    }
    if (rpcMock) return rpcMock(fn, args);
    throw new Error(`RPC inesperada en el test: ${fn}`);
  });
  supabase.from.mockImplementation((tabla) => {
    if (tabla === "trimestres") return makeQueryMock({ data: [TRIMESTRE_ACTIVO_MOCK], error: null });
    expect(tabla).toBe("asistencias_diarias");
    return makeQueryMock({ count: total, error: null });
  });
}

function setDateInput(labelText, value) {
  const input = screen.getByText(labelText).closest("label").querySelector("input");
  fireEvent.change(input, { target: { value } });
}

// SEDE-13: ReporteRango ahora lee useSedeContext() para mandar
// p_sede_id en admin_borrar_asistencias_rango — necesita un
// <SedeProvider/> en el árbol o el hook lanza, igual que ya se ajustó en
// AdminModulo.integration.test.jsx.
function renderReporte(overrides = {}) {
  const showToast = vi.fn();
  const utils = render(
    <SedeProvider value={{ sedeActiva: "cabimas", sedes: [{ id: "cabimas", nombre: "Cabimas" }], setSedeActiva: vi.fn() }}>
      <ReporteRango onVolverDiario={vi.fn()} permisos={{}} showToast={showToast} {...overrides} />
    </SedeProvider>
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

describe("ReporteRango — carga real del reporte por rango (ARCH-27, agregación server-side)", () => {
  it("llama a la RPC de agregación con los filtros de rango/turno y muestra días asistidos / % de asistencia", async () => {
    mockReporteYConteo();

    renderReporte();

    setDateInput("Desde", INICIO);
    setDateInput("Hasta", FIN);

    // 2 días asistidos sobre 5 días hábiles del rango = 40% (< 75%)
    await waitFor(() => screen.getByText("Prof. Ana Pérez"));
    expect(screen.getByText("12345678")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("~8h")).toBeTruthy(); // 2 días × 4h (turno DIURNO)

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("reporte_asistencias_rango_agregado", {
        p_fecha_desde: INICIO,
        p_fecha_hasta: FIN,
        p_turno:       "DIURNO",
        p_programa:    null,
        p_sede_id:     "cabimas",
      })
    );
  });

  // Fix (caso PNF Agroalimentación, turno MIXTO): antes las horas
  // estimadas usaban un ternario fijo (NOCTURNO=3, cualquier otro=4) —
  // MIXTO (9h reales, 7:00am-4:00pm continuo) heredaba el "4" genérico y
  // subestimaba a menos de la mitad las horas de un docente con jornada
  // completa en Agroalimentación. Ahora sale de TURNOS_CONFIG.
  it("con turno MIXTO, calcula ~18h (2 días × 9h reales) en vez de ~8h (el '4h' genérico que usaba antes)", async () => {
    mockReporteYConteo();

    renderReporte();

    const selectTurno = screen.getByText("Turno").closest("label").querySelector("select");
    fireEvent.change(selectTurno, { target: { value: "MIXTO" } });

    setDateInput("Desde", INICIO);
    setDateInput("Hasta", FIN);

    await waitFor(() => screen.getByText("Prof. Ana Pérez"));
    expect(screen.getByText("~18h")).toBeTruthy();
    expect(screen.queryByText("~8h")).toBeNull();

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("reporte_asistencias_rango_agregado", {
        p_fecha_desde: INICIO,
        p_fecha_hasta: FIN,
        p_turno:       "MIXTO",
        p_programa:    null,
        p_sede_id:     "cabimas",
      })
    );
  });

  it("sin el permiso puedeBorrarReportes no muestra el botón de borrado", async () => {
    mockReporteYConteo();

    renderReporte({ permisos: {} });

    await waitFor(() => screen.getByText("Prof. Ana Pérez"));
    expect(screen.queryByText("Borrar rango")).toBeNull();
  });

  it("si la RPC de agregación falla, muestra el error sin romper la pantalla", async () => {
    supabase.rpc.mockImplementation((fn) => {
      if (fn === "reporte_asistencias_rango_agregado") {
        return makeRpcMock({ data: null, error: { message: "Error de red." } });
      }
      throw new Error(`RPC inesperada: ${fn}`);
    });
    supabase.from.mockImplementation(() => makeQueryMock({ count: 0, error: null }));

    renderReporte();

    setDateInput("Desde", INICIO);
    setDateInput("Hasta", FIN);

    // Fix UX-59 (auditoría 16 ago): "Error de red." no matchea ninguna
    // regla de errorMessages.js — antes de conectar mensajeAmigable() en
    // este archivo se mostraba tal cual, ahora cae al mensaje genérico
    // (mismo criterio que SEC-38 ya estableció para cualquier mensaje no
    // reconocido).
    await waitFor(() => screen.getByText("Ocurrió un error al procesar la solicitud. Si el problema persiste, contacta a soporte."));
    expect(screen.getByText("No hay asistencias en este rango.")).toBeTruthy();
  });
});

describe("ReporteRango — borrado de rango (ADMIN-2)", () => {
  it("con permiso, borra el rango vía RPC con los filtros aplicados, avisa y refresca", async () => {
    mockReporteYConteo({
      rpcMock: (fn) => {
        if (fn === "admin_borrar_asistencias_rango") return Promise.resolve({ data: 2, error: null });
        throw new Error(`RPC inesperada: ${fn}`);
      },
    });

    const { showToast } = renderReporte({ permisos: { puedeBorrarReportes: true } });

    setDateInput("Desde", INICIO);
    setDateInput("Hasta", FIN);
    await waitFor(() => screen.getByText("Prof. Ana Pérez"));

    const llamadasAntesDeBorrar = supabase.rpc.mock.calls.length;

    fireEvent.click(screen.getByText("Borrar rango"));
    // totalRegistros viene del conteo mockeado (1, igual que agregado.length por defecto)
    expect(screen.getByText(/¿Borrar reporte de asistencia\?/)).toBeTruthy();

    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("admin_borrar_asistencias_rango", {
        p_fecha_desde: INICIO,
        p_fecha_hasta: FIN,
        p_turno:       "DIURNO",
        p_programa:    null,
        p_sede_id:     "cabimas",
      })
    );

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Se borraron 2 registro(s) de asistencia. Se descargó un respaldo CSV/JSON.", "success")
    );
    // fetchRango() se vuelve a disparar tras el borrado exitoso
    await waitFor(() => expect(supabase.rpc.mock.calls.length).toBeGreaterThan(llamadasAntesDeBorrar));
  });

  it("si la RPC de borrado falla, avisa por toast sin romper la pantalla (SEC-38: mensaje genérico, no crudo)", async () => {
    mockReporteYConteo({
      rpcMock: (fn) => {
        if (fn === "admin_borrar_asistencias_rango") return Promise.resolve({ data: null, error: { message: "No autorizado." } });
        throw new Error(`RPC inesperada: ${fn}`);
      },
    });

    const { showToast } = renderReporte({ permisos: { puedeBorrarReportes: true } });

    setDateInput("Desde", INICIO);
    setDateInput("Hasta", FIN);
    await waitFor(() => screen.getByText("Prof. Ana Pérez"));

    fireEvent.click(screen.getByText("Borrar rango"));
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() =>
      // Fix SEC-38: "No autorizado." no matchea ninguna regla explícita
      // de errorMessages.js, así que cae en el mensaje genérico en vez de
      // mostrarse crudo — lo que importa acá es que el toast de error
      // ocurrió y que la pantalla no se rompió/vació.
      expect(showToast).toHaveBeenCalledWith(
        "Ocurrió un error al procesar la solicitud. Si el problema persiste, contacta a soporte.",
        "error"
      )
    );
    // Sigue mostrando los datos ya cargados (no se vació la tabla por el error)
    expect(screen.getByText("Prof. Ana Pérez")).toBeTruthy();
  });
});
