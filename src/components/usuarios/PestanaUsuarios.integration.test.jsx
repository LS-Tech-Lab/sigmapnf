// @vitest-environment jsdom
// =====================================================================
// PestanaUsuarios.integration.test.jsx — F3 (auditoría julio 2026):
// cobertura de flujo real, no solo función pura.
//
// Cubre el flujo "un admin abre Gestión de Usuarios, ve la lista real y
// desactiva una cuenta": a diferencia de useQRSession/useUpload, esta
// lógica vive directamente en el componente (no hay un hook separado
// para extraer), así que aquí SÍ se renderiza el componente completo
// con @testing-library/react en vez de renderHook — exactamente lo que
// pide la auditoría para "gestión de usuarios".
//
// Se cubre el camino por RPC (admin_get_users, admin_toggle_user_activo),
// que es el que corre en cada carga de pantalla. El camino por
// fetch("/api/admin-users") (crear/eliminar cuentas, que pasa por la
// Edge Function con service_role) queda fuera de este test: mockear
// fetch + sesión + Edge Function agrega una capa distinta de riesgo
// (autenticación, no autorización de datos) y no es donde este hallazgo
// de la auditoría puso el foco.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import PestanaUsuarios from "./PestanaUsuarios";

const roles = [
  { nombre: "coordinador", emoji: "🧑‍💼", label: "Coordinador", color: "#2563EB" },
];

const usuarioActivo = {
  id: "user-1", nombre: "Test User", email: "test@unermb.edu.ve",
  rol: "coordinador", programa: "INFORMATICA", activo: true,
};

function renderPestana(overrides = {}) {
  const showToast = vi.fn();
  const logAudit = vi.fn().mockResolvedValue();
  const utils = render(
    <PestanaUsuarios
      permisos={{ puedeGestionarUsuarios: true }}
      roles={roles}
      programas={["INFORMATICA"]}
      showToast={showToast}
      logAudit={logAudit}
      {...overrides}
    />
  );
  return { ...utils, showToast, logAudit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PestanaUsuarios — flujo de carga y desactivación de usuario", () => {
  it("carga la lista real vía RPC y muestra al usuario activo", async () => {
    supabase.rpc.mockImplementation((fn) => {
      if (fn === "admin_get_users") return Promise.resolve({ data: [usuarioActivo], error: null });
      if (fn === "admin_get_orphan_auth_users") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    renderPestana();

    await waitFor(() => screen.getByText("Test User"));
    expect(supabase.rpc).toHaveBeenCalledWith("admin_get_users");
    expect(screen.getByText("Activo")).toBeTruthy();
  });

  it("desactivar un usuario llama a la RPC correcta, audita, avisa y refresca la lista", async () => {
    supabase.rpc.mockImplementation((fn, _args) => {
      if (fn === "admin_get_users") {
        // Segunda carga (tras el toggle) ya refleja activo=false
        const yaDesactivado = supabase.rpc.mock.calls.filter(c => c[0] === "admin_toggle_user_activo").length > 0;
        return Promise.resolve({
          data: [{ ...usuarioActivo, activo: !yaDesactivado }],
          error: null,
        });
      }
      if (fn === "admin_get_orphan_auth_users") return Promise.resolve({ data: [], error: null });
      if (fn === "admin_toggle_user_activo") return Promise.resolve({ error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const { showToast, logAudit } = renderPestana();

    await waitFor(() => screen.getByText("Test User"));

    fireEvent.click(screen.getByTitle("Desactivar"));

    // Se abre el modal de confirmación con el mensaje real del componente
    expect(
      screen.getByText(/¿Confirmas desactivar la cuenta de Test User\?/)
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("admin_toggle_user_activo", {
        p_user_id: "user-1",
        p_activo: false,
      })
    );

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "DESACTIVAR_USUARIO", entidad_id: "user-1" })
    );
    expect(showToast).toHaveBeenCalledWith("Test User desactivado.", "success");

    // cargar() se volvió a ejecutar tras el toggle → la tabla refleja "Inactivo"
    await waitFor(() => expect(screen.getByText("Inactivo")).toBeTruthy());
  });
});
