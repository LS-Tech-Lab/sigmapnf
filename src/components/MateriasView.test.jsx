// @vitest-environment jsdom
// =====================================================================
// MateriasView.test.jsx
//
// Fix (caso PNF Agroalimentación, turno MIXTO): el badge de turno en la
// tabla de asignaciones era un ternario binario — cualquier turno que no
// fuera "DIURNO" (incluido "MIXTO") se mostraba como "Vespertino" con
// ícono de luna. El label ahora sale de TURNOS_CONFIG.
// =====================================================================

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import MateriasView from "./MateriasView";

const BY_MATERIA = {
  "PROYECTO FORMATIVO I": [
    {
      dia: "LUNES",
      hora: "7:00AM-7:45AM",
      turno: "MIXTO",
      sheet: "1-1 (11)",
      trayecto: "1-1",
      clase: "Proyecto Formativo I\nProf. Doris Viloria",
      docentes: { nombre_raw: "Doris Viloria" },
    },
  ],
  "PROGRAMACIÓN I": [
    {
      dia: "MARTES",
      hora: "7:30AM-8:15AM",
      turno: "DIURNO",
      sheet: "SEC1",
      trayecto: "1-1",
      clase: "Programación I\nProf. Juan Pérez",
      docentes: { nombre_raw: "Juan Pérez" },
    },
  ],
  "QUÍMICA APLICADA": [
    {
      dia: "VIERNES",
      hora: "1:00PM-1:45PM",
      turno: "VESPERTINO",
      sheet: "SEC2",
      trayecto: "1-1",
      clase: "Química Aplicada\nProf. Lisbeth Brito",
      docentes: { nombre_raw: "Lisbeth Brito" },
    },
  ],
};

function renderVista(initialSel) {
  return render(
    <MateriasView
      byMateria={BY_MATERIA}
      initialSel={initialSel}
      onConsumeNav={() => {}}
      getMateriaName={(raw) => raw}
      getDocName={(raw) => raw}
      modoConsulta={false}
      lapso="2-2026"
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("MateriasView — badge de turno (caso MIXTO, PNF Agroalimentación)", () => {
  it("una asignación MIXTO se etiqueta 'Mixto', no 'Vespertino'", () => {
    renderVista("PROYECTO FORMATIVO I");
    expect(screen.getByText("Mixto")).toBeTruthy();
    expect(screen.queryByText("Vespertino")).toBeNull();
  });

  it("una asignación DIURNO sigue etiquetándose 'Diurno' — no regresión", () => {
    renderVista("PROGRAMACIÓN I");
    expect(screen.getByText("Diurno")).toBeTruthy();
  });

  it("una asignación VESPERTINO sigue etiquetándose 'Vespertino' — no regresión", () => {
    renderVista("QUÍMICA APLICADA");
    expect(screen.getByText("Vespertino")).toBeTruthy();
  });
});

// Fix UX-56 (auditoría 16 ago): filtrar por un texto sin coincidencias
// dejaba la lista de materias completamente en blanco, sin ningún mensaje
// — indistinguible de "cargando" o "roto".
describe("MateriasView — estado vacío del filtro (UX-56)", () => {
  it("muestra un mensaje accionable cuando la búsqueda no encuentra materias", () => {
    renderVista();
    const input = screen.getByPlaceholderText("Filtrar materia…");
    fireEvent.change(input, { target: { value: "materia que no existe xyz" } });

    expect(screen.getByText(/No se encontraron materias que coincidan con/)).toBeTruthy();
    expect(screen.queryByText("PROYECTO FORMATIVO I")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(input.value).toBe("");
    expect(screen.getByText("PROYECTO FORMATIVO I")).toBeTruthy();
  });

  it("sin filtro activo, no muestra el estado vacío aunque la lista esté vacía por otra razón", () => {
    render(
      <MateriasView
        byMateria={{}}
        initialSel={null}
        onConsumeNav={() => {}}
        getMateriaName={(raw) => raw}
        getDocName={(raw) => raw}
        modoConsulta={false}
        lapso="2-2026"
      />
    );
    // Sin búsqueda escrita, el estado vacío del FILTRO no debe aparecer
    // — es un caso distinto (catálogo vacío), fuera de alcance de UX-56.
    expect(screen.queryByText(/No se encontraron materias/)).toBeNull();
  });
});
