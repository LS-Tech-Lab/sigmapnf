// @vitest-environment jsdom
// =====================================================================
// PlanillaImprimibleBase.mixto.test.jsx
//
// Fix (caso PNF Agroalimentación, turno MIXTO): el selector de turno de
// esta planilla era un array fijo ["DIURNO", "VESPERTINO"] — un
// coordinador de Agroalimentación no podía generar esta planilla en
// absoluto, porque su turno (MIXTO) ni siquiera aparecía como botón.
// Ahora sale de TURNOS_CONFIG.filter(habilitado).
// =====================================================================

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import PlanillaImprimibleBase from "./PlanillaImprimibleBase";

const DATA = [
  {
    dia: "LUNES",
    turno: "MIXTO",
    hora: "7:00AM-7:45AM",
    sheet: "1-1 (11)",
    trayecto: "1-1",
    aula: "Lab 1",
    programa: "PNF Agroalimentación",
    clase: "Proyecto Formativo I\nProf. Doris Viloria",
    docentes: { nombre_raw: "Doris Viloria" },
    materias: { nombre_raw: "Proyecto Formativo I" },
  },
  {
    dia: "LUNES",
    turno: "DIURNO",
    hora: "7:30AM-8:15AM",
    sheet: "SEC1",
    trayecto: "1-1",
    aula: "A1",
    programa: "PNF Informática",
    clase: "Programación I\nProf. Juan Pérez",
    docentes: { nombre_raw: "Juan Pérez" },
    materias: { nombre_raw: "Programación I" },
  },
];

function renderPlanilla() {
  return render(
    <PlanillaImprimibleBase
      data={DATA}
      getDocName={(raw) => raw}
      getMateriaName={(raw) => raw}
      catalogoDocentes={[]}
      lapso="2-2026"
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("PlanillaImprimibleBase — turno MIXTO (PNF Agroalimentación)", () => {
  it("el botón 'Mixto' existe como opción de turno seleccionable", () => {
    renderPlanilla();
    expect(screen.getByText("Mixto")).toBeTruthy();
  });

  it("al elegir 'Mixto', solo se listan las clases con turno MIXTO (no las DIURNO)", () => {
    renderPlanilla();
    fireEvent.click(screen.getByText("Mixto"));

    expect(screen.getByText("Doris Viloria")).toBeTruthy();
    expect(screen.queryByText("Juan Pérez")).toBeNull();
  });

  it("por defecto (Diurno) sigue funcionando igual que antes — no regresión", () => {
    renderPlanilla();
    expect(screen.getByText("Juan Pérez")).toBeTruthy();
    expect(screen.queryByText("Doris Viloria")).toBeNull();
  });
});
