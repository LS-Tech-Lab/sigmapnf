// @vitest-environment jsdom
// =====================================================================
// VistaAusentes.integration.test.jsx — ARCH-26 (auditoría 1 ago 2026):
// el componente pedía el catálogo completo de `docentes` en cada carga,
// incluso cuando el 100% de las clases de `horarios` ya tenían
// `docente_id` vinculado (el catálogo solo se usa como fallback para
// clases sin vincular). Fix: pedir el catálogo solo si al menos una
// clase carece de `docente_id`.
//
// Casos cubiertos:
//   1. Con todas las clases vinculadas por docente_id, NO se consulta
//      la tabla `docentes` (el ahorro real que motiva el fix) y el
//      nombre/cédula se resuelven igual desde el join embebido.
//   2. Con alguna clase sin docente_id, SÍ se consulta `docentes` (el
//      fallback sigue funcionando, sin regresión de comportamiento).
//   3. Un docente ya presente (marcó asistencia) no aparece en Ausentes,
//      sin importar por qué vía se resolvió su identidad.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("../../../utils/reporteCache", () => ({
  guardarAusentesEnIDB: vi.fn().mockResolvedValue(undefined),
  cargarAusentesDeIDB:  vi.fn().mockResolvedValue(null),
}));

import { supabase } from "../../../lib/supabase";
import VistaAusentes from "./VistaAusentes";

const FECHA = "2026-07-06"; // lunes — evita la rama de fin de semana

function makeQueryMock(result) {
  const builder = {};
  ["select", "eq"].forEach((m) => { builder[m] = vi.fn(() => builder); });
  builder.then = (resolve) => Promise.resolve(result).then(resolve);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
});

describe("VistaAusentes — fetch condicional del catálogo de docentes (ARCH-26)", () => {
  it("con todas las clases vinculadas por docente_id, no consulta la tabla docentes", async () => {
    const clasesVinculadas = [
      {
        clase: "Programación I\nProf. García Ana", programa: "PNF INFORMATICA",
        sheet: "A", hora: "8:00-10:00", trayecto: "I",
        docente_id: "d1",
        docentes: { nombre_raw: "García, Ana", nombre_display: "Prof. Ana García", cedula: "11111111" },
      },
    ];

    supabase.from.mockImplementation((tabla) => {
      if (tabla === "horarios")  return makeQueryMock({ data: clasesVinculadas, error: null });
      if (tabla === "docentes")  return makeQueryMock({ data: [], error: null });
      throw new Error(`Tabla inesperada: ${tabla}`);
    });

    render(<VistaAusentes fecha={FECHA} programa="" cedulasPresentes={new Set()} onAusentesChange={vi.fn()} lapso="2-2026" />);

    await waitFor(() => screen.getByText("Prof. Ana García"));
    expect(screen.getByText("11111111")).toBeTruthy();

    // El ahorro real que motiva ARCH-26: docentes NUNCA se consulta.
    const tablasConsultadas = supabase.from.mock.calls.map(([tabla]) => tabla);
    expect(tablasConsultadas).toContain("horarios");
    expect(tablasConsultadas).not.toContain("docentes");
  });

  it("con una clase sin docente_id, sí consulta docentes como fallback y resuelve el nombre", async () => {
    const clasesMixtas = [
      {
        clase: "Bases de Datos\nProf. López Juan", programa: "PNF INFORMATICA",
        sheet: "B", hora: "10:00-12:00", trayecto: "II",
        docente_id: null,
        docentes: null,
      },
    ];
    const catalogoDocentes = [{ nombre_raw: "López, Juan", cedula: "22222222" }];

    supabase.from.mockImplementation((tabla) => {
      if (tabla === "horarios")  return makeQueryMock({ data: clasesMixtas, error: null });
      if (tabla === "docentes")  return makeQueryMock({ data: catalogoDocentes, error: null });
      throw new Error(`Tabla inesperada: ${tabla}`);
    });

    render(<VistaAusentes fecha={FECHA} programa="" cedulasPresentes={new Set()} onAusentesChange={vi.fn()} lapso="2-2026" />);

    await waitFor(() => screen.getByText("22222222"));

    const tablasConsultadas = supabase.from.mock.calls.map(([tabla]) => tabla);
    expect(tablasConsultadas).toContain("docentes");
  });

  it("un docente ya presente no aparece en la lista de ausentes", async () => {
    const clasesVinculadas = [
      {
        clase: "Programación I\nProf. García Ana", programa: "PNF INFORMATICA",
        sheet: "A", hora: "8:00-10:00", trayecto: "I",
        docente_id: "d1",
        docentes: { nombre_raw: "García, Ana", nombre_display: "Prof. Ana García", cedula: "11111111" },
      },
    ];

    supabase.from.mockImplementation((tabla) => {
      if (tabla === "horarios") return makeQueryMock({ data: clasesVinculadas, error: null });
      return makeQueryMock({ data: [], error: null });
    });

    render(
      <VistaAusentes
        fecha={FECHA}
        programa=""
        cedulasPresentes={new Set(["11111111"])}
        onAusentesChange={vi.fn()}
        lapso="2-2026"
      />
    );

    await waitFor(() =>
      screen.getByText("Todos los docentes con clases hoy marcaron asistencia.")
    );
  });
});

describe("VistaAusentes — filtro por lapso (bug ausentes-trimestre-cerrado, ago 2026)", () => {
  it("filtra horarios por el lapso resuelto, no solo por día", async () => {
    const clases = [
      {
        clase: "Programación I\nProf. García Ana", programa: "PNF INFORMATICA",
        sheet: "A", hora: "8:00-10:00", trayecto: "I",
        docente_id: "d1",
        docentes: { nombre_raw: "García, Ana", nombre_display: "Prof. Ana García", cedula: "11111111" },
      },
    ];

    supabase.from.mockImplementation((tabla) => {
      if (tabla === "horarios") return makeQueryMock({ data: clases, error: null });
      return makeQueryMock({ data: [], error: null });
    });

    render(
      <VistaAusentes
        fecha={FECHA}
        programa=""
        cedulasPresentes={new Set()}
        onAusentesChange={vi.fn()}
        lapso="3-2026"
      />
    );

    await waitFor(() => screen.getByText("Prof. Ana García"));

    const builder = supabase.from.mock.results.find(r => r.value?.select).value;
    expect(builder.eq).toHaveBeenCalledWith("lapso", "3-2026");
  });

  it("sin un lapso que cubra la fecha, NO consulta horarios y muestra estado explícito (antes mostraba el horario de un trimestre cerrado)", async () => {
    supabase.from.mockImplementation((tabla) => {
      throw new Error(`No debería consultarse ninguna tabla sin lapso resuelto, se intentó: ${tabla}`);
    });

    render(
      <VistaAusentes
        fecha={FECHA}
        programa=""
        cedulasPresentes={new Set()}
        onAusentesChange={vi.fn()}
        lapso={null}
      />
    );

    await waitFor(() => screen.getByText("Sin trimestre para esta fecha"));
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
