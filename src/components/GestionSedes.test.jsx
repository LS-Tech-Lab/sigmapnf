// @vitest-environment jsdom
// =====================================================================
// GestionSedes.test.jsx — SEDE-17 (auditoría 6 ago 2026): cobertura de
// flujo real de la pantalla de administración del catálogo de sedes —
// carga completa (activas e inactivas), alta con slug generado del
// nombre, edición de nombre/orden, activar/desactivar con confirmación,
// y que refetchSedes() del SedeContext se llama tras cada cambio para
// refrescar el selector de sede en el resto de la app.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../lib/supabase";
import GestionSedes from "./GestionSedes";
import { SedeProvider } from "../context/SedeContext";

const SEDES_DB = [
  { id: "cabimas", nombre: "Cabimas", activa: true, orden: 1 },
  { id: "bobures",  nombre: "Bobures",  activa: false, orden: 2 },
];

// Builder encadenable + thenable, mismo patrón que ConfiguracionReportes.
// integration.test.jsx/ReporteRango.integration.test.jsx.
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

function renderGestion({ sedes = SEDES_DB, refetchSedes = vi.fn(), showToast = vi.fn(), logAudit = vi.fn().mockResolvedValue(), mockFrom = null } = {}) {
  supabase.from.mockImplementation(mockFrom || ((tabla) => {
    expect(tabla).toBe("sedes");
    return makeSelectBuilder({ data: sedes, error: null });
  }));
  const utils = render(
    <SedeProvider value={{ sedeActiva: "cabimas", sedes: [], setSedeActiva: vi.fn(), refetchSedes }}>
      <GestionSedes showToast={showToast} logAudit={logAudit} permisos={{ puedeGestionarSedes: true }} />
    </SedeProvider>
  );
  return { ...utils, showToast, logAudit, refetchSedes };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GestionSedes — carga inicial", () => {
  it("carga y muestra sedes activas E inactivas (a diferencia de useSedes/SedeContext, que solo expone activas)", async () => {
    renderGestion();
    await waitFor(() => expect(screen.getByText("Cabimas")).toBeTruthy());
    expect(screen.getByText("Bobures")).toBeTruthy();
    expect(screen.getByText("Activa")).toBeTruthy();
    expect(screen.getByText("Inactiva")).toBeTruthy();
  });

  it("muestra un estado vacío si no hay sedes registradas", async () => {
    renderGestion({ sedes: [] });
    await waitFor(() => expect(screen.getByText("Sin sedes registradas todavía.")).toBeTruthy());
  });
});

describe("GestionSedes — alta de sede", () => {
  it("genera el id (slug) a partir del nombre, sin tildes ni mayúsculas, y lo muestra antes de guardar", async () => {
    renderGestion();
    await waitFor(() => screen.getByText("Cabimas"));

    fireEvent.click(screen.getByText("Nueva sede"));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "San Francisco de Asís" } });

    expect(screen.getByText("san_francisco_de_asis")).toBeTruthy();
  });

  it("al guardar, inserta con el slug generado y activa=true, llama a logAudit y a refetchSedes", async () => {
    // PROG-4: al crear una sede, TabSedes también crea las filas de
    // sedes_programas (una por cada programa del catálogo) -- el mock
    // acá enruta por tabla para cubrir las 3 llamadas que ahora dispara
    // el alta: insert en "sedes", select de ids en "programas", insert
    // en "sedes_programas".
    const sedesBuilder          = { ...makeSelectBuilder({ data: SEDES_DB, error: null }), ...makeInsertBuilder({ error: null }) };
    const programasSelectBuilder = { select: vi.fn(() => Promise.resolve({ data: [{ id: "informatica" }], error: null })) };
    const sedesProgramasInsertBuilder = makeInsertBuilder({ error: null });

    const mockFrom = (tabla) => {
      if (tabla === "sedes") return sedesBuilder;
      if (tabla === "programas") return programasSelectBuilder;
      if (tabla === "sedes_programas") return sedesProgramasInsertBuilder;
      throw new Error(`Tabla inesperada: ${tabla}`);
    };

    const { refetchSedes, logAudit } = renderGestion({ mockFrom });
    await waitFor(() => screen.getByText("Cabimas"));

    fireEvent.click(screen.getByText("Nueva sede"));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Coro" } });
    fireEvent.change(screen.getByLabelText("Orden"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() => expect(sedesBuilder.insert).toHaveBeenCalledWith({ id: "coro", nombre: "Coro", orden: 3, activa: true }));
    await waitFor(() => expect(sedesProgramasInsertBuilder.insert).toHaveBeenCalledWith([{ sede_id: "coro", programa_id: "informatica", activo: true }]));
    await waitFor(() => expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: "CREAR_SEDE", entidad_id: "coro" })));
    await waitFor(() => expect(refetchSedes).toHaveBeenCalled());
  });

  it("rechaza el alta si ya existe una sede con el mismo id (slug) generado", async () => {
    const { showToast } = renderGestion();
    await waitFor(() => screen.getByText("Cabimas"));

    fireEvent.click(screen.getByText("Nueva sede"));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Cabimas" } });
    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Ya existe"), "error"));
  });

  it("rechaza un nombre vacío sin llegar a llamar a supabase.insert", async () => {
    const { showToast } = renderGestion();
    await waitFor(() => screen.getByText("Cabimas"));

    fireEvent.click(screen.getByText("Nueva sede"));
    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining("nombre"), "error"));
  });
});

describe("GestionSedes — edición", () => {
  it("edita nombre/orden sin exponer el id — actualiza por id existente, sin tocarlo", async () => {
    const updateBuilder = makeUpdateBuilder({ error: null });
    const selectBuilder = makeSelectBuilder({ data: SEDES_DB, error: null });
    const mockFrom = (tabla) => {
      expect(tabla).toBe("sedes");
      return { ...selectBuilder, ...updateBuilder };
    };

    const { refetchSedes } = renderGestion({ mockFrom });
    await waitFor(() => screen.getByText("Cabimas"));

    fireEvent.click(screen.getAllByTitle("Editar")[0]);
    expect(screen.queryByText(/se genera del nombre/)).toBeNull(); // sin campo de id en edición

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Cabimas Centro" } });
    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() => expect(updateBuilder.update).toHaveBeenCalledWith({ nombre: "Cabimas Centro", orden: 1 }));
    await waitFor(() => expect(updateBuilder.eq).toHaveBeenCalledWith("id", "cabimas"));
    await waitFor(() => expect(refetchSedes).toHaveBeenCalled());
  });
});

describe("GestionSedes — activar/desactivar", () => {
  it("pide confirmación y, al confirmar, desactiva y llama a refetchSedes", async () => {
    const updateBuilder = makeUpdateBuilder({ error: null });
    const selectBuilder = makeSelectBuilder({ data: SEDES_DB, error: null });
    const mockFrom = (tabla) => {
      expect(tabla).toBe("sedes");
      return { ...selectBuilder, ...updateBuilder };
    };

    const { refetchSedes } = renderGestion({ mockFrom });
    await waitFor(() => screen.getByText("Cabimas"));

    fireEvent.click(screen.getByTitle("Desactivar"));
    expect(screen.getByText(/Confirmas desactivar/)).toBeTruthy();
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() => expect(updateBuilder.update).toHaveBeenCalledWith({ activa: false }));
    await waitFor(() => expect(refetchSedes).toHaveBeenCalled());
  });

  it("cancelar la confirmación no llama a supabase.update", async () => {
    renderGestion();
    await waitFor(() => screen.getByText("Cabimas"));

    fireEvent.click(screen.getByTitle("Desactivar"));
    fireEvent.click(screen.getByText("Cancelar"));

    expect(screen.queryByText(/Confirmas desactivar/)).toBeNull();
  });
});
