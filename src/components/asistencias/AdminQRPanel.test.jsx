// @vitest-environment jsdom
// =====================================================================
// AdminQRPanel.test.jsx
//
// Fix (caso PNF Agroalimentación, turno MIXTO): el turno preseleccionado
// al abrir el panel recorría TURNOS_VISIBLES en orden fijo (DIURNO →
// VESPERTINO → MIXTO) buscando el primero que no hubiera terminado. Un
// coordinador de Agroalimentación (turno real: MIXTO) que abriera el
// panel en la tarde se encontraba con "Vespertino" preseleccionado —
// VESPERTINO calzaba antes en la lista y MIXTO nunca se llegaba a
// evaluar. Ahora, si el perfil es de PNF Agroalimentación, se prioriza
// MIXTO mientras siga disponible ese día.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

import AdminQRPanel from "./AdminQRPanel";

function renderPanel(profile) {
  return render(
    <AdminQRPanel
      profile={profile}
      onVerReporte={vi.fn()}
      onVerProyeccion={vi.fn()}
      activa={false}
      loading={false}
      error={null}
      sessionId={null}
      crearSesion={vi.fn()}
      renovarManual={vi.fn()}
      cerrarSesion={vi.fn()}
      permisos={{}}
      showToast={vi.fn()}
    />
  );
}

function turnoSeleccionado() {
  const seleccionado = document.querySelector(".qrp-turno-btn--sel");
  return seleccionado?.textContent || null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AdminQRPanel — turno preseleccionado (caso PNF Agroalimentación)", () => {
  // 2026-08-05T17:00:00Z = 1:00pm hora de Caracas (UTC-4): DIURNO (hasta
  // 12:00pm) ya terminó, VESPERTINO (1:00pm-5:30pm) y MIXTO (7:00am-4:00pm)
  // están ambos disponibles. Es exactamente el caso donde el bug viejo
  // elegía VESPERTINO por orden de lista, aunque MIXTO también calzara.
  it("con perfil de Agroalimentación en la tarde, preselecciona MIXTO (no VESPERTINO)", () => {
    vi.setSystemTime(new Date("2026-08-05T17:00:00Z"));

    renderPanel({ programa: "PNF Agroalimentación" });

    expect(turnoSeleccionado()).toContain("Mixto");
  });

  it("con perfil de otro programa a la misma hora, sigue preseleccionando VESPERTINO — no regresión", () => {
    vi.setSystemTime(new Date("2026-08-05T17:00:00Z"));

    renderPanel({ programa: "PNF Informática" });

    expect(turnoSeleccionado()).toContain("Vespertino");
  });

  it("con perfil de Agroalimentación en la mañana, preselecciona MIXTO (coincide con el orden viejo, pero confirma que sigue funcionando)", () => {
    // 2026-08-05T13:00:00Z = 9:00am Caracas — DIURNO, VESPERTINO y MIXTO
    // todos vigentes; DIURNO es el primero en la lista de todas formas,
    // así que este caso ya "funcionaba" antes por casualidad de orden —
    // se prueba igual para confirmar que la prioridad por programa no
    // rompe el caso mañana.
    vi.setSystemTime(new Date("2026-08-05T13:00:00Z"));

    renderPanel({ programa: "PNF Agroalimentación" });

    expect(turnoSeleccionado()).toContain("Mixto");
  });

  it("sin perfil (profile null/undefined), no rompe y usa el comportamiento por horario de siempre", () => {
    vi.setSystemTime(new Date("2026-08-05T17:00:00Z"));

    renderPanel(null);

    expect(turnoSeleccionado()).toContain("Vespertino");
  });
});
