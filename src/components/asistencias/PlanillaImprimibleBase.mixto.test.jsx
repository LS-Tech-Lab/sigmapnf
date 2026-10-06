// @vitest-environment jsdom
// =====================================================================
// PlanillaImprimibleBase.filtros.test.jsx
//
// "Asistencias Diarias por Turno": cada botón de filtro (turno y día)
// debe mostrar SOLO lo suyo. Bug original: el botón "Diurno" dejaba ver
// clases de la tarde (columna `turno` mal cargada, o sin turno y con una
// hora fuera de 7:00-12:00, caían a "DIURNO").
// =====================================================================
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PlanillaImprimibleBase from "./PlanillaImprimibleBase";

const mk = (id, over) => ({
  dia: "LUNES", programa: "PNF X", aula: "A1", trayecto: "1-1",
  clase: `Mat ${id}\nProf. P${id}`,
  docentes: { nombre_raw: `P${id}` }, materias: { nombre_raw: `Mat ${id}` },
  ...over,
});

const DATA = [
  mk("D_OK",        { turno: "DIURNO",     hora: "8:15AM-9:00AM",    sheet: "1-1 (11)" }),
  mk("D_CRUZA",     { turno: "DIURNO",     hora: "11:30AM-12:15PM",  sheet: "1-1 (11)" }),
  mk("V_OK",        { turno: "VESPERTINO", hora: "1:00PM-1:45PM",    sheet: "1-1 (21)" }),
  mk("DIURNO_PM",   { turno: "DIURNO",     hora: "2:15PM-3:00PM",    sheet: "1-1 (11)" }),
  mk("SINTURNO_PM", { turno: null,         hora: "2:15PM-3:00PM",    sheet: "ABC" }),
  mk("SINTURNO_12", { turno: null,         hora: "12:15PM-12:45PM",  sheet: "ABC" }),
  mk("SINTURNO_6",  { turno: null,         hora: "5:45PM-6:30PM",    sheet: "ABC" }),
  mk("SHEET_D_PM",  { turno: null,         hora: "3:15PM-4:00PM",    sheet: "SEC-111" }),
  mk("VESP_AM",     { turno: "VESPERTINO", hora: "9:00AM-9:45AM",    sheet: "1-1 (21)" }),
  mk("MIXTO_PM",    { turno: "MIXTO",      hora: "2:00PM-2:45PM",    sheet: "1-1 (11)" }),
  mk("MIXTO_AM",    { turno: "MIXTO",      hora: "7:00AM-7:45AM",    sheet: "1-1 (11)" }),
  mk("MARTES_D",    { dia: "MARTES", turno: "DIURNO", hora: "8:15AM-9:00AM", sheet: "1-1 (11)" }),
];

afterEach(cleanup);

function renderPlanilla() {
  return render(
    <PlanillaImprimibleBase data={DATA} getDocName={r => r} getMateriaName={r => r}
      catalogoDocentes={[]} lapso="2-2026" />
  );
}
const nombres = () =>
  [...document.querySelectorAll("table.pib-table tbody tr")]
    .map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent).find(t => t.startsWith("Mat "))?.slice(4))
    .sort();

describe("Planilla — botones de turno", () => {
  it("Diurno: solo clases que empiezan hasta las 12:00 PM (y no MIXTO)", () => {
    renderPlanilla();
    fireEvent.click(screen.getByText("Diurno"));
    expect(nombres()).toEqual(["D_CRUZA", "D_OK", "VESP_AM"]);
  });

  it("Vespertino: solo clases que empiezan después de las 12:00 PM (y no MIXTO)", () => {
    renderPlanilla();
    fireEvent.click(screen.getByText("Vespertino"));
    expect(nombres()).toEqual(["DIURNO_PM", "SHEET_D_PM", "SINTURNO_12", "SINTURNO_6", "SINTURNO_PM", "V_OK"]);
  });

  it("Mixto: solo las clases MIXTO, sea cual sea su hora", () => {
    renderPlanilla();
    fireEvent.click(screen.getByText("Mixto"));
    expect(nombres()).toEqual(["MIXTO_AM", "MIXTO_PM"]);
  });

  it("ninguna clase aparece en dos botones de turno a la vez", () => {
    renderPlanilla();
    const vistos = [];
    for (const b of ["Diurno", "Vespertino", "Mixto"]) {
      fireEvent.click(screen.getByText(b));
      vistos.push(...nombres());
    }
    const lunes = DATA.filter(d => d.dia === "LUNES").length;
    expect(vistos.length).toBe(lunes);
    expect(new Set(vistos).size).toBe(lunes);
  });
});

describe("Planilla — botones de día", () => {
  it("Martes muestra solo lo del martes; Lunes vuelve a lo del lunes", () => {
    renderPlanilla();
    fireEvent.click(screen.getByText("Diurno"));
    fireEvent.click(screen.getByText("Martes"));
    expect(nombres()).toEqual(["MARTES_D"]);
    fireEvent.click(screen.getByText("Lunes"));
    expect(nombres()).toEqual(["D_CRUZA", "D_OK", "VESP_AM"]);
  });

  it("un día sin clases muestra el mensaje vacío", () => {
    renderPlanilla();
    fireEvent.click(screen.getByText("Viernes"));
    expect(screen.getByText("No hay clases programadas.")).toBeTruthy();
  });

  it("el botón activo queda marcado (s-btn--active) al cambiar turno y día", () => {
    renderPlanilla();
    fireEvent.click(screen.getByText("Vespertino"));
    fireEvent.click(screen.getByText("Jueves"));
    expect(screen.getByText("Vespertino").closest("button").className).toContain("s-btn--active");
    expect(screen.getByText("Diurno").closest("button").className).not.toContain("s-btn--active");
    expect(screen.getByText("Jueves").closest("button").className).toContain("s-btn--active");
    expect(screen.getByText("Lunes").closest("button").className).not.toContain("s-btn--active");
  });
});
