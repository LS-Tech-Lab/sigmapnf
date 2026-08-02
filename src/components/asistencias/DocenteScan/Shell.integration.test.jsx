// @vitest-environment jsdom
// =====================================================================
// Shell.integration.test.jsx — UX-25 (auditoría de estrés operacional,
// 2 ago 2026): DocenteScan encolaba registros offline (OFF-7) sin dar
// ninguna señal visual de cuántos quedaban pendientes de sincronizar —
// un operador de QR con conexión inestable no tenía forma de saber si
// sus escaneos ya se habían confirmado contra el servidor.
//
// Shell es el único wrapper común a las ~10 pantallas de DocenteScan
// (index.jsx, PasoRegistro.jsx, PasoValidacionCedula.jsx,
// SelectorTipo.jsx), así que el badge se implementó ahí una sola vez,
// autocontenido: lee contarPendientes() al montar y se refresca solo
// escuchando 'sigma:cola-offline-cambio' (disparado por offlineQueue.js)
// y 'online'/'offline' — sin polling y sin tocar los ~10 call-sites que
// ya usan <Shell>.
// =====================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

afterEach(() => {
  cleanup();
});

// Importados después del beforeEach por el mismo motivo que
// offlineQueue.test.js: abrirDB() se llama en tiempo de ejecución, no
// de importación, así que siempre toma el indexedDB vigente.
import Shell from "./Shell";
import { encolarAsistencia } from "../../../utils/offlineQueue";

function makeAsistencia(overrides = {}) {
  return {
    qr_session_id: "session-abc-123",
    cedula:        "12345678",
    tipo:          "ENTRADA",
    ...overrides,
  };
}

describe("Shell — badge de cola offline pendiente (UX-25)", () => {
  it("no muestra ningún badge cuando la cola está vacía", async () => {
    render(<Shell><p>contenido</p></Shell>);
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("muestra el conteo correcto si ya hay registros pendientes al montar", async () => {
    await encolarAsistencia(makeAsistencia());
    await encolarAsistencia(makeAsistencia({ cedula: "87654321" }));

    render(<Shell><p>contenido</p></Shell>);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("2 registros pendientes de sincronizar");
    });
  });

  it("usa singular cuando queda exactamente 1 pendiente", async () => {
    await encolarAsistencia(makeAsistencia());
    render(<Shell><p>contenido</p></Shell>);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("1 registro pendiente de sincronizar");
    });
  });

  it("se actualiza en vivo cuando se encola un nuevo registro tras montar (sin recargar la pantalla)", async () => {
    render(<Shell><p>contenido</p></Shell>);

    // Al montar, la cola está vacía — sin badge todavía.
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });

    // Un escaneo offline ocurre MIENTRAS la pantalla ya está montada
    // (el caso real: operador escaneando varias cédulas seguidas).
    await encolarAsistencia(makeAsistencia());

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("1 registro pendiente de sincronizar");
    });
  });

  it("sigue renderizando children normalmente con o sin badge", async () => {
    await encolarAsistencia(makeAsistencia());
    render(<Shell><p>contenido del paso actual</p></Shell>);
    await waitFor(() => {
      expect(screen.getByText("contenido del paso actual")).toBeTruthy();
    });
  });
});
