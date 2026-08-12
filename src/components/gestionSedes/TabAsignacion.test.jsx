// @vitest-environment jsdom
// =====================================================================
// TabAsignacion.test.jsx — PROG-4 (12 ago 2026). Cobertura de la matriz
// sede × programa: carga (solo sedes/programas activos), y toggle de
// `sedes_programas.activo` vía upsert.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import TabAsignacion from "./TabAsignacion";

const SEDES = [{ id: "cabimas", nombre: "Cabimas" }];
const PROGRAMAS = [{ id: "informatica", nombre: "PNF Informática" }, { id: "agro", nombre: "PNF Agroalimentación" }];
const ASIGNACION = [
  { sede_id: "cabimas", programa_id: "informatica", activo: true },
  { sede_id: "cabimas", programa_id: "agro",         activo: false },
];

function makeEqOrderBuilder(result) {
  const b = {};
  b.select = vi.fn(() => b);
  b.eq     = vi.fn(() => b);
  b.order  = vi.fn(() => Promise.resolve(result));
  return b;
}
function makeSelectOnlyBuilder(result) {
  const b = {};
  b.select = vi.fn(() => Promise.resolve(result));
  return b;
}

function mockFromDefault() {
  return (tabla) => {
    if (tabla === "sedes")          return makeEqOrderBuilder({ data: SEDES, error: null });
    if (tabla === "programas")      return makeEqOrderBuilder({ data: PROGRAMAS, error: null });
    if (tabla === "sedes_programas") return makeSelectOnlyBuilder({ data: ASIGNACION, error: null });
    throw new Error(`Tabla inesperada: ${tabla}`);
  };
}

function renderTab({ showToast = vi.fn(), logAudit = vi.fn().mockResolvedValue(), mockFrom = null } = {}) {
  supabase.from.mockImplementation(mockFrom || mockFromDefault());
  const utils = render(<TabAsignacion showToast={showToast} logAudit={logAudit} refrescarClave={0} />);
  return { ...utils, showToast, logAudit };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TabAsignacion — carga", () => {
  it("muestra la matriz con el estado activo/inactivo de cada combinación", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("Cabimas")).toBeTruthy());
    expect(screen.getByText("PNF Informática")).toBeTruthy();
    expect(screen.getByText("PNF Agroalimentación")).toBeTruthy();
    expect(screen.getByTitle("PNF Informática en Cabimas: activo")).toBeTruthy();
    expect(screen.getByTitle("PNF Agroalimentación en Cabimas: inactivo")).toBeTruthy();
  });
});

describe("TabAsignacion — toggle", () => {
  it("al hacer click en un toggle activo, hace upsert con activo=false y registra auditoría", async () => {
    const upsertBuilder = { upsert: vi.fn(() => Promise.resolve({ error: null })) };
    const mockFrom = (tabla) => {
      if (tabla === "sedes")          return makeEqOrderBuilder({ data: SEDES, error: null });
      if (tabla === "programas")      return makeEqOrderBuilder({ data: PROGRAMAS, error: null });
      if (tabla === "sedes_programas") return { ...makeSelectOnlyBuilder({ data: ASIGNACION, error: null }), ...upsertBuilder };
      throw new Error(`Tabla inesperada: ${tabla}`);
    };

    const { logAudit } = renderTab({ mockFrom });
    await waitFor(() => screen.getByText("Cabimas"));

    fireEvent.click(screen.getByTitle("PNF Informática en Cabimas: activo"));

    await waitFor(() => expect(upsertBuilder.upsert).toHaveBeenCalledWith(
      { sede_id: "cabimas", programa_id: "informatica", activo: false },
      { onConflict: "sede_id,programa_id" }
    ));
    await waitFor(() => expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: "DESACTIVAR_PROGRAMA_EN_SEDE" })));
  });
});
