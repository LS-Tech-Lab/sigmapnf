// @vitest-environment jsdom
// =====================================================================
// PlanillaImprimibleBase.security.test.jsx — SEC-25 (CodeQL, 15 de
// julio): regresión para el XSS almacenado real que tenía
// `handlePrint()`. Nombres de docente/materia/programa vienen de datos
// reales cargados por Excel (`useUpload.js`) y se interpolaban SIN
// escapar en el HTML pasado a `document.write()`. Este test simula un
// nombre "malicioso" (como lo dejaría una fila de Excel mal cargada, a
// propósito o por error) y confirma que llega escapado a la ventana de
// impresión.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import PlanillaImprimibleBase from "./PlanillaImprimibleBase";

const PAYLOAD_DOCENTE = '<img src=x onerror="alert(1)">';
const PAYLOAD_MATERIA = "<script>alert('materia')</script>";
const PAYLOAD_SECCION = '"><svg onload=alert(2)>';
const PAYLOAD_PROGRAMA = "<b>PNF Informática</b>";

const DATA = [
  {
    dia: "LUNES",
    turno: "DIURNO",
    hora: "07:30-08:30",
    sheet: PAYLOAD_SECCION,
    trayecto: null,
    aula: "A1",
    programa: PAYLOAD_PROGRAMA,
    clase: "irrelevante|irrelevante",
    docentes: { nombre_raw: PAYLOAD_DOCENTE },
    materias: { nombre_raw: PAYLOAD_MATERIA },
  },
];

function renderPlanilla() {
  return render(
    <PlanillaImprimibleBase
      data={DATA}
      getDocName={(raw) => raw}
      getMateriaName={(raw) => raw}
      catalogoDocentes={[]}
      lapso="1-2026"
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlanillaImprimibleBase — escapa datos reales antes de document.write()", () => {
  it("escapa nombre de docente, materia, sección y programa (nunca aparecen sin escapar en el HTML impreso)", () => {
    const fakeWin = {
      document: { write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    };
    vi.spyOn(window, "open").mockReturnValue(fakeWin);
    vi.useFakeTimers();

    renderPlanilla();
    fireEvent.click(screen.getByText("Imprimir / PDF"));

    expect(fakeWin.document.write).toHaveBeenCalledTimes(1);
    const html = fakeWin.document.write.mock.calls[0][0];

    // Ninguno de los 4 payloads debe sobrevivir sin escapar.
    expect(html).not.toContain(PAYLOAD_DOCENTE);
    expect(html).not.toContain(PAYLOAD_MATERIA);
    expect(html).not.toContain(PAYLOAD_SECCION);
    expect(html).not.toContain(PAYLOAD_PROGRAMA);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<svg onload");

    // Las versiones escapadas sí deben estar presentes (confirma que el
    // dato no se perdió, solo se neutralizó).
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).toContain("&lt;script&gt;alert('materia')&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;PNF Informática&lt;/b&gt;");

    vi.useRealTimers();
  });
});
