// @vitest-environment jsdom
// =====================================================================
// TurnoGrid.test.jsx — Fix UX-28 (reportado por el usuario: "edité una
// clase y la siguiente se movía al lugar de la que edité, y al agregarla
// de nuevo en su hora original no apareció").
//
// Causa raíz real (no era un problema de la base de datos): cellMap
// marcaba los bloques cubiertos por el rowSpan de una clase como
// "occupied" y descartaba en silencio (`map[day][bi] = "skip"`) cualquier
// OTRA clase distinta que empezara justo ahí — aunque siguiera intacta en
// `horarios`. Esto pasa en la práctica cada vez que dos clases distintas
// terminan compartiendo un bloque de 45 min después de una edición (ej.
// extender la duración de una hasta pisar el inicio de la siguiente).
//
// Este test reproduce exactamente ese choque con datos sintéticos y
// verifica que AMBAS clases se sigan mostrando (fusionadas en la misma
// celda, marcadas como conflicto) en vez de que una desaparezca.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TurnoGrid from "./TurnoGrid";
import { BLOQUES_DIURNO, DAYS } from "../constants";

afterEach(() => {
  cleanup();
});

const noop = () => {};
const getDocName = (n) => n || "";
const getMateriaName = (n) => n || "";

function entry(overrides) {
  return {
    id: overrides.id,
    dia: "LUNES",
    hora: overrides.hora,
    sheet: "T1-1",
    trayecto: "1",
    aula: "A1",
    clase: `${overrides.materia}\nProf. ${overrides.docente}`,
    ...overrides,
  };
}

describe("TurnoGrid — Fix UX-28: choque de horario no debe ocultar clases", () => {
  it("si dos clases distintas terminan en el mismo bloque (una de span largo tapando a otra), ambas siguen visibles y se marca el conflicto", () => {
    // A: 9:00-10:30 (2 bloques, span=2) — su rowSpan cubriría bi=2 y bi=3.
    // B: 9:45-10:30 (1 bloque) — empieza justo en bi=3, el bloque que A tapa.
    const filtered = [
      entry({ id: 1, hora: "9:00AM-10:30AM", materia: "Cálculo I", docente: "Pérez" }),
      entry({ id: 2, hora: "9:45AM-10:30AM", materia: "Física I", docente: "Gómez" }),
    ];

    render(
      <TurnoGrid
        bloques={BLOQUES_DIURNO}
        turnoLabel="DIURNO"
        filtered={filtered}
        days={DAYS}
        expandedCell={null}
        setExpandedCell={noop}
        getDocName={getDocName}
        getMateriaName={getMateriaName}
        puedeEditar={false}
        puedeBorrar={false}
        puedeCrearDocentes={false}
        puedeCrearMaterias={false}
        onSaveClase={vi.fn()}
        onDeleteClase={vi.fn()}
        openConfirm={vi.fn()}
        closeConfirm={vi.fn()}
      />
    );
    
    expect(screen.getByText("Cálculo I")).toBeTruthy();
    expect(screen.getByText("Física I")).toBeTruthy();
    expect(screen.getByText(/Choque de horario/i)).toBeTruthy();
  });

  it("sin choque real (clases en bloques distintos y no solapados), no aparece ningún aviso de conflicto", () => {
    const filtered = [
      entry({ id: 1, hora: "9:00AM-9:45AM", materia: "Cálculo I", docente: "Pérez" }),
      entry({ id: 2, hora: "9:45AM-10:30AM", materia: "Física I", docente: "Gómez" }),
    ];

    render(
      <TurnoGrid
        bloques={BLOQUES_DIURNO}
        turnoLabel="DIURNO"
        filtered={filtered}
        days={DAYS}
        expandedCell={null}
        setExpandedCell={noop}
        getDocName={getDocName}
        getMateriaName={getMateriaName}
        puedeEditar={false}
        puedeBorrar={false}
        puedeCrearDocentes={false}
        puedeCrearMaterias={false}
        onSaveClase={vi.fn()}
        onDeleteClase={vi.fn()}
        openConfirm={vi.fn()}
        closeConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("Cálculo I")).toBeTruthy();
    expect(screen.getByText("Física I")).toBeTruthy();
    expect(screen.queryByText(/Choque de horario/i)).toBeNull();
  });

  it("una clase larga que NO tapa a nadie sigue rindiendo con su rowSpan normal (no rompe el caso común)", () => {
    const filtered = [
      entry({ id: 1, hora: "7:30AM-9:00AM", materia: "Programación I", docente: "Rojas" }),
    ];

    const { container } = render(
      <TurnoGrid
        bloques={BLOQUES_DIURNO}
        turnoLabel="DIURNO"
        filtered={filtered}
        days={DAYS}
        expandedCell={null}
        setExpandedCell={noop}
        getDocName={getDocName}
        getMateriaName={getMateriaName}
        puedeEditar={false}
        puedeBorrar={false}
        puedeCrearDocentes={false}
        puedeCrearMaterias={false}
        onSaveClase={vi.fn()}
        onDeleteClase={vi.fn()}
        openConfirm={vi.fn()}
        closeConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("Programación I")).toBeTruthy();
    expect(screen.queryByText(/Choque de horario/i)).toBeNull();
    const celdaLarga = container.querySelector(".tg-cell-data--span-2");
    expect(celdaLarga).toBeTruthy();
  });
});
