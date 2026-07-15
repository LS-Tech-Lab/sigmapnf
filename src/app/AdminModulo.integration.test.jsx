// @vitest-environment jsdom
// =====================================================================
// AdminModulo.integration.test.jsx — ARCH-25 (auditoría QA del 15 de
// julio): cobertura de flujo real del shell del módulo "Sistema"
// (ADMIN-3): qué pestañas se arman según los permisos efectivos, cuál
// queda activa por defecto, y que cambiar de pestaña realmente cambia
// la sub-vista montada.
//
// Las 3 sub-vistas (UsuariosView, LogsView, HistorialView) se mockean:
// son lazy() + hacen sus propias consultas a Supabase, una capa de
// riesgo completamente distinta a la que este hallazgo audita (el
// armado de TABS y el gate de permisos de AdminModulo en sí). Se
// reemplazan por stubs mínimos que solo confirman "esta vista se montó
// con estas props", igual de precedente a como PestanaUsuarios.
// integration.test.jsx deja fuera de alcance la Edge Function de
// admin-users.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../components/usuarios", () => ({
  default: ({ programas }) => (
    <div data-testid="view-usuarios">Usuarios y Roles — programas: {programas.join(",")}</div>
  ),
}));
vi.mock("../components/LogsView", () => ({
  default: () => <div data-testid="view-logs">Registros</div>,
}));
vi.mock("../components/HistorialView", () => ({
  default: ({ modoConsulta }) => (
    <div data-testid="view-historial">Historial — modoConsulta: {String(modoConsulta)}</div>
  ),
}));

import AdminModulo from "./AdminModulo";
import { AppDataProvider } from "../context/AppDataContext";

const APP_DATA = {
  data: { programas: ["INFORMATICA", "ADMINISTRACION"] },
  showToast: vi.fn(),
  logAudit: vi.fn(),
  openConfirm: vi.fn(),
  closeConfirm: vi.fn(),
};

const PROFILE = { rol_info: { label: "Coordinador", color: "#2563EB" } };

function renderAdminModulo(overrides = {}) {
  return render(
    <AppDataProvider value={APP_DATA}>
      <AdminModulo
        profile={PROFILE}
        permisos={{}}
        user={{ id: "u1" }}
        lapso="2026-1"
        onCambiarLapso={vi.fn()}
        tieneHorarios={false}
        tieneQR={false}
        onVolverSelector={vi.fn()}
        onLogout={vi.fn()}
        {...overrides}
      />
    </AppDataProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("AdminModulo — armado de pestañas según permisos efectivos", () => {
  it("sin ningún permiso admin, solo muestra Historial (única pestaña sin gate propio) y la deja activa", async () => {
    renderAdminModulo({ permisos: {} });

    expect(screen.queryByText("Usuarios y Roles")).toBeNull();
    expect(screen.queryByText("Registros")).toBeNull();
    expect(screen.getByText("Historial")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("view-historial")).toBeTruthy());
  });

  it("con puedeGestionarUsuarios, agrega la pestaña Usuarios y Roles y la deja activa por defecto (primera de TABS)", async () => {
    renderAdminModulo({ permisos: { puedeGestionarUsuarios: true } });

    expect(screen.getByText("Usuarios y Roles")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("view-usuarios")).toBeTruthy());
    expect(screen.getByTestId("view-usuarios").textContent).toContain("INFORMATICA,ADMINISTRACION");
    // Historial existe como pestaña pero no está activa por defecto
    expect(screen.queryByTestId("view-historial")).toBeNull();
  });

  it("con puedeVerLogs, agrega Registros; con puedeGestionarRoles (sin puedeGestionarUsuarios) también agrega Usuarios y Roles", async () => {
    renderAdminModulo({ permisos: { puedeVerLogs: true, puedeGestionarRoles: true } });

    expect(screen.getByText("Usuarios y Roles")).toBeTruthy();
    expect(screen.getByText("Registros")).toBeTruthy();
  });

  it("cambiar de pestaña desmonta la sub-vista anterior y monta la nueva", async () => {
    renderAdminModulo({ permisos: { puedeGestionarUsuarios: true, puedeVerLogs: true } });

    await waitFor(() => expect(screen.getByTestId("view-usuarios")).toBeTruthy());

    fireEvent.click(screen.getByText("Registros"));
    await waitFor(() => expect(screen.getByTestId("view-logs")).toBeTruthy());
    expect(screen.queryByTestId("view-usuarios")).toBeNull();

    fireEvent.click(screen.getByText("Historial"));
    await waitFor(() => expect(screen.getByTestId("view-historial")).toBeTruthy());
    expect(screen.queryByTestId("view-logs")).toBeNull();
  });

  it("pasa modoConsulta=true a HistorialView cuando el usuario no puede gestionar trimestres", async () => {
    renderAdminModulo({ permisos: {} });
    await waitFor(() =>
      expect(screen.getByTestId("view-historial").textContent).toContain("modoConsulta: true")
    );
  });
});

describe("AdminModulo — navegación entre módulos y menú de usuario", () => {
  it("no muestra el botón 'Módulos' si el perfil no tiene acceso a ningún otro módulo", () => {
    renderAdminModulo({ tieneHorarios: false, tieneQR: false });
    expect(screen.queryByText("Módulos")).toBeNull();
  });

  it("muestra 'Módulos' y llama a onVolverSelector si el perfil también tiene acceso a Horarios o QR", () => {
    const onVolverSelector = vi.fn();
    renderAdminModulo({ tieneHorarios: true, onVolverSelector });

    fireEvent.click(screen.getByText("Módulos"));
    expect(onVolverSelector).toHaveBeenCalledTimes(1);
  });

  it("abre el modal de cambiar contraseña desde el menú de usuario", async () => {
    renderAdminModulo({ permisos: {} });

    fireEvent.click(screen.getByLabelText("Menú de usuario"));
    fireEvent.click(await screen.findByText(/cambiar contraseña/i));

    expect(await screen.findByText(/configuración de cuenta/i)).toBeTruthy();
  });
});
