// @vitest-environment jsdom
// =====================================================================
// AdminQRPanel.off10.test.jsx
//
// Cobertura de la UI agregada por OFF-10: el CTA + formulario de
// registro manual (opción C) y el panel de "preparar sesiones offline"
// (opción A). No repite la cobertura de turno preseleccionado ya cubierta
// en AdminQRPanel.test.jsx — archivo separado a propósito para no
// heredar su vi.useFakeTimers() (estos tests necesitan await/waitFor
// reales sobre interacciones de usuario).
//
// Los módulos de persistencia (manualAttendanceQueue, qrOfflineCache) se
// mockean por completo: esto es un test de UI/orquestación, la
// persistencia real ya está cubierta por sus propios tests
// (manualAttendanceQueue.test.js, qrOfflineCache.test.js).
// =====================================================================

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

vi.mock("../../utils/manualAttendanceQueue", () => ({
  encolarAsistenciaManual: vi.fn().mockResolvedValue(undefined),
  contarPendientesManuales: vi.fn().mockResolvedValue(0),
}));

vi.mock("../../utils/qrOfflineCache", () => ({
  listarSesionesCacheadas: vi.fn().mockResolvedValue([]),
}));

import AdminQRPanel from "./AdminQRPanel";
import { SedeProvider } from "../../context/SedeContext";
import { encolarAsistenciaManual } from "../../utils/manualAttendanceQueue";
import { listarSesionesCacheadas } from "../../utils/qrOfflineCache";

function renderPanel(props = {}) {
  return render(
    <SedeProvider value={{ sedeActiva: "cabimas", sedes: [], setSedeActiva: vi.fn() }}>
      <AdminQRPanel
        profile={{ programa: "PNF Informática" }}
        onVerReporte={vi.fn()}
        onVerProyeccion={vi.fn()}
        activa={false}
        loading={false}
        error={null}
        sessionId={null}
        crearSesion={vi.fn()}
        renovarManual={vi.fn()}
        cerrarSesion={vi.fn()}
        isOffline={false}
        requiereModoManual={false}
        prepararSesionOffline={vi.fn().mockResolvedValue({ ok: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() })}
        permisos={{}}
        showToast={vi.fn()}
        {...props}
      />
    </SedeProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminQRPanel — OFF-10: registro manual (opción C)", () => {
  it("no muestra el CTA de registro manual si requiereModoManual es false", () => {
    renderPanel({ requiereModoManual: false });
    expect(screen.queryByText(/No hay sesión preparada/)).toBeNull();
  });

  it("cuando requiereModoManual es true, abre el formulario automáticamente", () => {
    renderPanel({ isOffline: true, requiereModoManual: true });
    expect(screen.getByText(/Registro manual de asistencia/)).toBeTruthy();
  });

  it("guardar el formulario llama a encolarAsistenciaManual con los datos ingresados", async () => {
    renderPanel({ isOffline: true, requiereModoManual: true });

    fireEvent.change(screen.getByPlaceholderText("V-12345678"), { target: { value: "V-9999999" } });
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: "Ana Docente" } });
    fireEvent.click(screen.getByRole("button", { name: "Salida" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar registro/ }));

    await waitFor(() => {
      expect(encolarAsistenciaManual).toHaveBeenCalledWith(
        expect.objectContaining({
          cedula: "V-9999999",
          nombre: "Ana Docente",
          tipo: "SALIDA",
          sede_id: "cabimas",
        })
      );
    });
  });

  it("el botón 'Cerrar' del formulario lo oculta de nuevo", async () => {
    renderPanel({ isOffline: true, requiereModoManual: true });
    expect(screen.getByText(/Registro manual de asistencia/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(screen.queryByText(/Registro manual de asistencia/)).toBeNull();
  });
});

describe("AdminQRPanel — OFF-10: preparar sesiones offline (opción A)", () => {
  it("no se muestra mientras está offline (no tendría con qué preparar nada)", () => {
    renderPanel({ isOffline: true });
    expect(screen.queryByText(/Preparar sesiones offline/)).toBeNull();
  });

  it("con red, muestra el panel colapsado; al expandir, ofrece preparar los turnos que no están activos", async () => {
    renderPanel({ isOffline: false });

    fireEvent.click(screen.getByText(/Preparar sesiones offline/));

    await waitFor(() => {
      expect(listarSesionesCacheadas).toHaveBeenCalled();
    });
    // El turno seleccionado por defecto también aparece listado — sí se
    // puede preparar aunque coincida con el que se ve en el selector,
    // mientras no esté activa/en pantalla ahora mismo (activa=false acá).
    expect(screen.getAllByText(/Preparar$/).length).toBeGreaterThan(0);
  });

  it("preparar un turno llama a prepararSesionOffline y luego refresca el estado 'listo'", async () => {
    const prepararSesionOffline = vi.fn().mockResolvedValue({
      ok: true, expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
    });
    listarSesionesCacheadas
      .mockResolvedValueOnce([]) // primera carga al expandir: nada preparado
      .mockResolvedValueOnce([   // segunda carga, después de preparar
        { turno: "DIURNO", programa: "PNF Informática", expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString() },
      ]);

    renderPanel({ isOffline: false, prepararSesionOffline });

    fireEvent.click(screen.getByText(/Preparar sesiones offline/));
    await waitFor(() => expect(listarSesionesCacheadas).toHaveBeenCalledTimes(1));

    const botonesPreparar = screen.getAllByText("Preparar");
    fireEvent.click(botonesPreparar[0]);

    await waitFor(() => {
      expect(prepararSesionOffline).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText(/Listo hasta las/)).toBeTruthy();
    });
  });

  it("si prepararSesionOffline falla, muestra el mensaje de error devuelto", async () => {
    const prepararSesionOffline = vi.fn().mockResolvedValue({
      ok: false, mensaje: "Necesitas conexión para preparar una sesión offline.",
    });

    renderPanel({ isOffline: false, prepararSesionOffline });

    fireEvent.click(screen.getByText(/Preparar sesiones offline/));
    await waitFor(() => expect(listarSesionesCacheadas).toHaveBeenCalled());

    const botonesPreparar = screen.getAllByText("Preparar");
    fireEvent.click(botonesPreparar[0]);

    await waitFor(() => {
      expect(screen.getByText("Necesitas conexión para preparar una sesión offline.")).toBeTruthy();
    });
  });
});
