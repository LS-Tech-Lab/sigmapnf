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
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), rpc: vi.fn() },
}));

import AdminQRPanel from "./AdminQRPanel";
import { supabase } from "../../lib/supabase";
// SEDE-3: AdminQRPanel consume useSedeContext() (para mandar sede_id al
// crear la sesión QR) — en producción vive dentro de HorariosLayout, que
// App.jsx ya envuelve en <SedeProvider>. Se replica acá el mismo wrapper
// con una sede fija de prueba para que el hook no explote por falta de
// Provider, igual que en ModalEditarClase.test.jsx.
import { SedeProvider } from "../../context/SedeContext";

function renderPanel(profile, overrides = {}) {
  return render(
    <SedeProvider value={{ sedeActiva: "cabimas", sedes: [], setSedeActiva: vi.fn() }}>
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
        {...overrides}
      />
    </SedeProvider>
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

// UX-33: contador "de N esperados" (RPC contar_docentes_esperados, 0069) y
// resumen automático al cerrar sesión.
function makeChannelMock() {
  const ch = {};
  ch.on = vi.fn(() => ch);
  ch.subscribe = vi.fn(() => ch);
  return ch;
}

// Builder para supabase.from("asistencias_diarias").select(...).eq(...)
// [.order(...).limit(...)], awaitable directamente (thenable) — mismo
// patrón que DocenteScan.flow.test.jsx. order/limit son no-ops encadenables
// porque FeedActividad los usa además de ContadorSesion/handleConfirmarCierre
// (que no los usan) — todos comparten el mismo supabase.from mockeado.
function makeAsistenciasMock(rows) {
  const builder = {};
  builder.select = vi.fn(() => builder);
  builder.eq     = vi.fn(() => builder);
  builder.order  = vi.fn(() => builder);
  builder.limit  = vi.fn(() => builder);
  builder.then   = (resolve) => resolve({ data: rows, error: null });
  return builder;
}

describe("AdminQRPanel — UX-33: contador de esperados y resumen de cierre", () => {
  beforeEach(() => {
    // Estos tests usan waitFor/findByText, que dependen de setTimeout real
    // para su polling interno — el resto del archivo usa fake timers (para
    // vi.setSystemTime en el describe de arriba), así que se anula acá.
    vi.useRealTimers();
    supabase.channel.mockImplementation(() => makeChannelMock());
    supabase.rpc.mockImplementation((fn) => {
      if (fn === "contar_docentes_esperados") return Promise.resolve({ data: 5, error: null });
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("ContadorSesion muestra 'de N esperados' usando la RPC sede-scoped", async () => {
    supabase.from.mockImplementation(() => makeAsistenciasMock([
      { id: "a1", cedula_docente: "111", tipo: "ENTRADA" },
    ]));

    renderPanel({ programa: "PNF Informática" }, { activa: true, sessionId: "sesion-1" });

    expect(await screen.findByText(/de 5 esperados/i)).toBeTruthy();
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith(
      "contar_docentes_esperados",
      expect.objectContaining({ p_sede_id: "cabimas" })
    ));
  });

  it("no muestra el denominador si la RPC falla (fallback silencioso, no rompe el contador)", async () => {
    supabase.from.mockImplementation(() => makeAsistenciasMock([]));
    supabase.rpc.mockImplementation((fn) => {
      if (fn === "contar_docentes_esperados") return Promise.resolve({ data: null, error: { message: "no autorizado" } });
      return Promise.resolve({ data: null, error: null });
    });

    renderPanel({ programa: "PNF Informática" }, { activa: true, sessionId: "sesion-1" });

    await screen.findByText(/docentes entraron/i);
    expect(screen.queryByText(/esperados/i)).toBeNull();
  });

  it("al cerrar sesión, muestra el resumen con conteos y docentes sin salida", async () => {
    supabase.from.mockImplementation(() => makeAsistenciasMock([
      { id: "a1", cedula_docente: "111", nombre_docente: "Prof. Ana Pérez",  tipo: "ENTRADA" },
      { id: "a2", cedula_docente: "111", nombre_docente: "Prof. Ana Pérez",  tipo: "SALIDA"  },
      { id: "a3", cedula_docente: "222", nombre_docente: "Prof. Luis Rojas", tipo: "ENTRADA" },
    ]));
    const cerrarSesion = vi.fn().mockResolvedValue();

    renderPanel(
      { programa: "PNF Informática" },
      { activa: true, sessionId: "sesion-1", cerrarSesion }
    );

    fireEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sí, cerrar sesión/i }));

    await waitFor(() => expect(cerrarSesion).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("Sesión cerrada")).toBeTruthy();
    expect(screen.getByText(/sin registro de salida \(1\)/i)).toBeTruthy();
    // Se acota la búsqueda a la lista de pendientes del modal de resumen:
    // "Prof. Luis Rojas" también puede aparecer en el feed de actividad de
    // fondo (mismos datos mockeados), así que buscar en todo el documento
    // daría un falso "múltiples coincidencias".
    const listaPendientes = document.querySelector(".qrp-resumen-pendientes__lista");
    expect(listaPendientes.textContent).toContain("Prof. Luis Rojas");
    expect(listaPendientes.textContent).not.toContain("Prof. Ana Pérez");
  });

  it("si la consulta del resumen falla, la sesión igual se cierra (el resumen no es crítico)", async () => {
    // Solo la consulta específica del resumen (columnas con nombre_docente,
    // sin order/limit) falla — las de ContadorSesion/FeedActividad, que
    // comparten el mismo supabase.from mockeado, siguen respondiendo con
    // datos vacíos, para no derribar el resto del panel en este test.
    supabase.from.mockImplementation(() => {
      const builder = {};
      let cols = "";
      builder.select = vi.fn((c) => { cols = c; return builder; });
      builder.eq     = vi.fn(() => builder);
      builder.order  = vi.fn(() => builder);
      builder.limit  = vi.fn(() => builder);
      builder.then   = (resolve, reject) => {
        if (cols === "cedula_docente, nombre_docente, tipo") {
          return Promise.reject(new Error("network down")).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    });
    const cerrarSesion = vi.fn().mockResolvedValue();

    renderPanel(
      { programa: "PNF Informática" },
      { activa: true, sessionId: "sesion-1", cerrarSesion }
    );

    fireEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sí, cerrar sesión/i }));

    await waitFor(() => expect(cerrarSesion).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Sesión cerrada")).toBeTruthy();
  });
});
