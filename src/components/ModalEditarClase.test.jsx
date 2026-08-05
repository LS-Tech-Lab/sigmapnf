// @vitest-environment jsdom
// =====================================================================
// ModalEditarClase.test.jsx
//
// Fix (sync turno-hora, caso Agroalimentación / turno MIXTO): el payload
// que arma `handleGuardar()` no incluía el campo `turno` de la fila —
// solo `hora` se actualizaba. Si alguien cambiaba el bloque de inicio a
// otro turno (ej. de un bloque MIXTO exclusivo a uno que solo existe en
// VESPERTINO), la columna `turno` quedaba con el valor viejo, desincro-
// nizada de la nueva `hora` guardada. Ahora `turno` se deriva del mismo
// bloque de inicio elegido (bloqueInicioObj.turno) y viaja en el payload.
//
// También cubre el bug de `bloqueValue()`/`bloqueInicialDe()`: los
// últimos 4 bloques de MIXTO (1:00pm-4:00pm) comparten horario con los
// primeros 4 de VESPERTINO — sin desambiguar por turno real, abrir una
// clase MIXTO en ese rango la mostraba (y guardaba) como VESPERTINO.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../lib/supabase";
import ModalEditarClase from "./ModalEditarClase";
import { SedeProvider } from "../context/SedeContext";

const DOCENTES = [{ id: 1, nombre_raw: "Lisbeth Brito", nombre_display: "Lisbeth Brito" }];
const MATERIAS = [{ id: 10, nombre_raw: "Quimica Aplicada", nombre_display: "Quimica Aplicada" }];

function makeCatalogBuilder(data) {
  const b = {};
  b.select = vi.fn(() => b);
  b.order = vi.fn(() => Promise.resolve({ data, error: null }));
  return b;
}

function mockCatalogos() {
  supabase.from.mockImplementation((tabla) => {
    if (tabla === "docentes") return makeCatalogBuilder(DOCENTES);
    if (tabla === "materias") return makeCatalogBuilder(MATERIAS);
    throw new Error(`tabla inesperada: ${tabla}`);
  });
}

function renderModal(entry, overrides = {}) {
  const onSave = vi.fn().mockResolvedValue({ success: true });
  const onDelete = vi.fn().mockResolvedValue({ success: true });
  const onClose = vi.fn();
  let capturedConfirm = null;
  const openConfirm = vi.fn((cfg) => { capturedConfirm = cfg; });
  const closeConfirm = vi.fn();

  // SEDE-5: ModalEditarClase consume useSedeContext() (para mandar
  // sede_id en la creación inline "+ Nuevo docente/materia") — en
  // producción vive dentro de HorariosLayout, que App.jsx ya envuelve en
  // <SedeProvider>. Se replica acá el mismo wrapper con una sede fija de
  // prueba para que el hook no explote por falta de Provider.
  const utils = render(
    <SedeProvider value={{ sedeActiva: "cabimas", sedes: [], setSedeActiva: vi.fn() }}>
      <ModalEditarClase
        open={true}
        entry={entry}
        puedeEditar={true}
        puedeBorrar={true}
        puedeCrearDocentes={false}
        puedeCrearMaterias={false}
        onSave={onSave}
        onDelete={onDelete}
        onClose={onClose}
        openConfirm={openConfirm}
        closeConfirm={closeConfirm}
        {...overrides}
      />
    </SedeProvider>
  );

  return { ...utils, onSave, onDelete, onClose, openConfirm, closeConfirm, getConfirm: () => capturedConfirm };
}

beforeEach(() => {
  mockCatalogos();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ModalEditarClase — sync turno-hora al guardar", () => {
  it("guarda turno:'MIXTO' al editar una clase MIXTO cuyo bloque de inicio (11:30am-12:15pm) coincide en horario con un bloque de DIURNO", async () => {
    const entry = {
      id: 1,
      dia: "LUNES",
      hora: "11:30AM-12:15PM",
      turno: "MIXTO",
      aula: "A1",
      docente_id: 1,
      materia_id: 10,
      clase: "Quimica Aplicada\nProf. Lisbeth Brito",
      updated_at: "2026-08-01T00:00:00Z",
    };
    const { onSave, getConfirm } = renderModal(entry);

    await waitFor(() => expect(screen.getByText("Guardar")).toBeTruthy());
    fireEvent.click(screen.getByText("Guardar"));

    await getConfirm().onConfirm();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [, payload] = onSave.mock.calls[0];
    expect(payload.turno).toBe("MIXTO");
    expect(payload.hora).toBe("11:30AM-12:15PM");
  });

  it("guarda turno:'MIXTO' (no 'VESPERTINO') para un bloque MIXTO que comparte horario con VESPERTINO (1:00pm-1:45pm)", async () => {
    const entry = {
      id: 2,
      dia: "VIERNES",
      hora: "1:00PM-1:45PM",
      turno: "MIXTO",
      aula: null,
      docente_id: 1,
      materia_id: 10,
      clase: "Quimica Aplicada\nProf. Lisbeth Brito",
      updated_at: "2026-08-01T00:00:00Z",
    };
    const { onSave, getConfirm } = renderModal(entry);

    await waitFor(() => expect(screen.getByText("Guardar")).toBeTruthy());

    // Verifica que el <select> de hora de inicio haya quedado en el
    // optgroup "Mixto" (no "Vespertino") pese a compartir el horario.
    const selectInicio = document.getElementById("mec-bloque-inicio");
    expect(selectInicio.value.startsWith("MIXTO|")).toBe(true);

    fireEvent.click(screen.getByText("Guardar"));
    await getConfirm().onConfirm();

    const [, payload] = onSave.mock.calls[0];
    expect(payload.turno).toBe("MIXTO");
  });

  it("caso estándar (DIURNO) sigue guardando turno correctamente — no regresión", async () => {
    const entry = {
      id: 3,
      dia: "MARTES",
      hora: "7:30AM-8:15AM",
      turno: "DIURNO",
      aula: "B2",
      docente_id: 1,
      materia_id: 10,
      clase: "Quimica Aplicada\nProf. Lisbeth Brito",
      updated_at: "2026-08-01T00:00:00Z",
    };
    const { onSave, getConfirm } = renderModal(entry);

    await waitFor(() => expect(screen.getByText("Guardar")).toBeTruthy());
    fireEvent.click(screen.getByText("Guardar"));
    await getConfirm().onConfirm();

    const [, payload] = onSave.mock.calls[0];
    expect(payload.turno).toBe("DIURNO");
  });
});
