// @vitest-environment jsdom
// =====================================================================
// TabProgramas.test.jsx — PROG-4 (12 ago 2026). Mismo patrón de
// GestionSedes.test.jsx (TabSedes), adaptado al catálogo `programas`:
// carga completa, alta con slug generado + creación automática de las
// filas de sedes_programas para cada sede existente, y activar/
// desactivar con confirmación.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import TabProgramas from "./TabProgramas";

const PROGRAMAS_DB = [
  { id: "informatica",        nombre: "PNF Informática",       activa: true,  orden: 1 },
  { id: "educacion_especial", nombre: "PNF Educación Especial", activa: false, orden: 2 },
];

function makeSelectBuilder(result) {
  const b = {};
  b.select = vi.fn(() => b);
  b.order  = vi.fn(() => Promise.resolve(result));
  return b;
}
function makeInsertBuilder(result) {
  const b = {};
  b.insert = vi.fn(() => Promise.resolve(result));
  return b;
}
function makeUpdateBuilder(result) {
  const b = {};
  b.update = vi.fn(() => b);
  b.eq     = vi.fn(() => Promise.resolve(result));
  return b;
}

function renderTab({ programas = PROGRAMAS_DB, showToast = vi.fn(), logAudit = vi.fn().mockResolvedValue(), onCambio = vi.fn(), mockFrom = null } = {}) {
  supabase.from.mockImplementation(mockFrom || ((tabla) => {
    expect(tabla).toBe("programas");
    return makeSelectBuilder({ data: programas, error: null });
  }));
  const utils = render(<TabProgramas showToast={showToast} logAudit={logAudit} onCambio={onCambio} />);
  return { ...utils, showToast, logAudit, onCambio };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TabProgramas — carga inicial", () => {
  it("carga y muestra programas activos e inactivos", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("PNF Informática")).toBeTruthy());
    expect(screen.getByText("PNF Educación Especial")).toBeTruthy();
    expect(screen.getByText("Activo")).toBeTruthy();
    expect(screen.getByText("Inactivo")).toBeTruthy();
  });
});

describe("TabProgramas — alta", () => {
  it("al guardar, inserta el programa, crea las filas de sedes_programas para cada sede y llama a onCambio", async () => {
    const programasBuilder = { ...makeSelectBuilder({ data: PROGRAMAS_DB, error: null }), ...makeInsertBuilder({ error: null }) };
    const sedesSelectBuilder = { select: vi.fn(() => Promise.resolve({ data: [{ id: "cabimas" }, { id: "coro" }], error: null })) };
    const sedesProgramasInsertBuilder = makeInsertBuilder({ error: null });

    const mockFrom = (tabla) => {
      if (tabla === "programas") return programasBuilder;
      if (tabla === "sedes") return sedesSelectBuilder;
      if (tabla === "sedes_programas") return sedesProgramasInsertBuilder;
      throw new Error(`Tabla inesperada: ${tabla}`);
    };

    const { onCambio, logAudit } = renderTab({ mockFrom });
    await waitFor(() => screen.getByText("PNF Informática"));

    fireEvent.click(screen.getByText("Nuevo programa"));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "PNF Agroalimentación" } });
    fireEvent.change(screen.getByLabelText("Orden"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() => expect(programasBuilder.insert).toHaveBeenCalledWith({ id: "pnf_agroalimentacion", nombre: "PNF Agroalimentación", orden: 3, activa: true }));
    await waitFor(() => expect(sedesProgramasInsertBuilder.insert).toHaveBeenCalledWith([
      { sede_id: "cabimas", programa_id: "pnf_agroalimentacion", activo: true },
      { sede_id: "coro",    programa_id: "pnf_agroalimentacion", activo: true },
    ]));
    await waitFor(() => expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: "CREAR_PROGRAMA", entidad_id: "pnf_agroalimentacion" })));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
  });
});

describe("TabProgramas — activar/desactivar", () => {
  it("pide confirmación y, al confirmar, desactiva y llama a onCambio", async () => {
    const updateBuilder = makeUpdateBuilder({ error: null });
    const selectBuilder = makeSelectBuilder({ data: PROGRAMAS_DB, error: null });
    const mockFrom = (tabla) => {
      expect(tabla).toBe("programas");
      return { ...selectBuilder, ...updateBuilder };
    };

    const { onCambio } = renderTab({ mockFrom });
    await waitFor(() => screen.getByText("PNF Informática"));

    fireEvent.click(screen.getAllByTitle("Desactivar")[0]);
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() => expect(updateBuilder.update).toHaveBeenCalledWith({ activa: false }));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
  });
});
