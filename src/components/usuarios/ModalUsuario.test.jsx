// @vitest-environment jsdom
// =====================================================================
// ModalUsuario.test.jsx — Fase 2, prioridad 2 (auditoría de cobertura,
// 10 ago 2026): admin_upsert_user_profile y admin_set_user_programas
// no tenían ningún test. Es superficie de escalación de privilegios
// (asignación de rol/sede/programa) y el punto donde falló
// históricamente SEC-10.
//
// Alcance: cubre el flujo de EDICIÓN (usuario ya existe), que llama a
// ambas RPC directamente vía supabase.rpc(). El flujo de CREACIÓN pasa
// por fetch("/api/admin-users") con la Edge Function de service_role
// — se deja fuera a propósito, mismo criterio que
// PestanaUsuarios.integration.test.jsx: mockear fetch + sesión + Edge
// Function es una capa de riesgo distinta (autenticación, no
// autorización de datos vía RPC) y merece su propio archivo de test
// dedicado a api/admin-users.js en vez de mezclarse acá.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok" } } }) },
  },
}));

import { supabase } from "../../lib/supabase";
import ModalUsuario from "./ModalUsuario";

const roles = [
  { nombre: "coordinador", label: "Coordinador", emoji: "🧑‍💼", restringe_programa: true, permisos: {} },
  { nombre: "admin", label: "Administrador", emoji: "👑", restringe_programa: false, permisos: { puedeVerTodasLasSedes: true } },
  { nombre: "auxiliar", label: "Auxiliar", emoji: "📋", restringe_programa: false, permisos: {} },
];

const sedes = [{ id: "cabimas", nombre: "Cabimas" }, { id: "bachaquero", nombre: "Bachaquero" }];

const usuarioExistente = {
  id: "user-1", email: "coord@unermb.edu.ve", nombre: "Coordinadora X",
  rol: "coordinador", programa: "INFORMATICA", programas: ["INFORMATICA"],
  sede_id: "cabimas",
};

function renderModal(overrides = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const showToast = vi.fn();
  const logAudit = vi.fn().mockResolvedValue();
  const utils = render(
    <ModalUsuario
      usuario={usuarioExistente}
      esActorAdmin={true}
      roles={roles}
      programas={["INFORMATICA", "AGROALIMENTACION"]}
      sedes={sedes}
      onSave={onSave}
      onClose={onClose}
      showToast={showToast}
      logAudit={logAudit}
      {...overrides}
    />
  );
  return { ...utils, onSave, onClose, showToast, logAudit };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.rpc.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe("ModalUsuario — PROG-4: filtro de programas por sede activa", () => {
  it("sin sedeProgramaActivo, muestra el catálogo completo (comportamiento previo sin cambios)", () => {
    renderModal();
    expect(screen.getByText("INFORMATICA")).toBeTruthy();
    expect(screen.getByText("AGROALIMENTACION")).toBeTruthy();
  });

  it("con sedeProgramaActivo, filtra el checklist a los programas activos en la sede ya elegida", () => {
    renderModal({
      sedeProgramaActivo: { cabimas: new Set(["INFORMATICA"]) },
    });
    // usuarioExistente.sede_id === "cabimas": AGROALIMENTACION no está
    // activo ahí y no estaba ya asignado -> se oculta.
    expect(screen.getByText("INFORMATICA")).toBeTruthy();
    expect(screen.queryByText("AGROALIMENTACION")).toBeNull();
  });

  it("no oculta un programa ya asignado aunque ya no esté activo en la sede (unión con lo asignado)", () => {
    renderModal({
      sedeProgramaActivo: { cabimas: new Set([]) }, // nada activo en cabimas
    });
    // usuarioExistente.programas === ["INFORMATICA"] -> se conserva visible.
    expect(screen.getByText("INFORMATICA")).toBeTruthy();
    expect(screen.queryByText("AGROALIMENTACION")).toBeNull();
  });
});

describe("ModalUsuario — editar usuario existente", () => {
  it("guarda con admin_upsert_user_profile y luego admin_set_user_programas, en ese orden", async () => {
    const { onSave } = renderModal();
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(2));
    expect(supabase.rpc.mock.calls[0][0]).toBe("admin_upsert_user_profile");
    expect(supabase.rpc.mock.calls[1][0]).toBe("admin_set_user_programas");
    expect(onSave).toHaveBeenCalled();
  });

  it("admin_upsert_user_profile recibe el user_id, rol y sede correctos", async () => {
    renderModal();
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    expect(supabase.rpc).toHaveBeenCalledWith("admin_upsert_user_profile", {
      p_user_id: "user-1",
      p_email: "coord@unermb.edu.ve",
      p_nombre: "Coordinadora X",
      p_rol: "coordinador",
      p_programa: "INFORMATICA",
      p_sede_id: "cabimas",
    });
  });

  it("un rol que restringe programa exige al menos uno seleccionado, sin llamar al RPC", async () => {
    renderModal({
      usuario: { ...usuarioExistente, programas: [] },
    });
    // Desmarcar el único programa preseleccionado
    fireEvent.click(screen.getByRole("checkbox", { name: "INFORMATICA" }));
    fireEvent.click(screen.getByText("Guardar cambios"));

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/al menos un programa asignado/i)).toBeTruthy();
  });

  it("un rol que NO restringe programa (ej. admin) manda p_programa: null, sin exigir selección", async () => {
    renderModal({ usuario: { ...usuarioExistente, rol: "admin", programas: [] } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    expect(supabase.rpc).toHaveBeenCalledWith("admin_upsert_user_profile", expect.objectContaining({
      p_programa: null,
    }));
  });

  it("un rol sin puedeVerTodasLasSedes exige sede asignada", async () => {
    renderModal({ usuario: { ...usuarioExistente, sede_id: "" } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/requiere una sede asignada/i)).toBeTruthy();
  });

  it("un rol con puedeVerTodasLasSedes (admin) NO exige sede", async () => {
    renderModal({ usuario: { ...usuarioExistente, rol: "admin", sede_id: "" } });
    fireEvent.click(screen.getByText("Guardar cambios"));
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
  });

  it("admin_set_user_programas manda exactamente los programas marcados en el form", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("checkbox", { name: "AGROALIMENTACION" }));
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(2));
    expect(supabase.rpc).toHaveBeenCalledWith("admin_set_user_programas", {
      p_user_id: "user-1",
      p_programas: expect.arrayContaining(["INFORMATICA", "AGROALIMENTACION"]),
    });
  });

  it("si admin_upsert_user_profile falla, NO llama a admin_set_user_programas ni a onSave", async () => {
    supabase.rpc.mockResolvedValueOnce({ error: { message: "Sin permiso." } });
    const { onSave, logAudit } = renderModal();
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => screen.getByText("Sin permiso."));
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("si admin_set_user_programas falla, el perfil YA se guardó — avisa pero no bloquea onSave", async () => {
    supabase.rpc
      .mockResolvedValueOnce({ error: null }) // admin_upsert_user_profile
      .mockResolvedValueOnce({ error: { message: "timeout" } }); // admin_set_user_programas
    const { onSave, showToast } = renderModal();
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(2));
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("no se pudieron guardar los programas"), "warning"
    );
    expect(onSave).toHaveBeenCalled();
  });

  it("registra EDITAR_USUARIO en auditoría al guardar con éxito", async () => {
    const { logAudit } = renderModal();
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      accion: "EDITAR_USUARIO",
      entidad_id: "user-1",
    })));
  });

  it("esActorAdmin=false oculta el rol admin del selector (defensa en profundidad de SEC-15)", () => {
    renderModal({ esActorAdmin: false });
    const select = screen.getByLabelText("Rol");
    const opciones = Array.from(select.querySelectorAll("option")).map(o => o.value);
    expect(opciones).not.toContain("admin");
  });
});

// UX-43 (auditoría UI/UX de élite, 15 ago): handleSave() validaba
// secuencialmente con `return` en el primer campo inválido — un usuario
// con varios errores a la vez necesitaba un intento de "Guardar" por
// cada uno para enterarse de todos. Ahora valida todo de una vez
// (fieldErrors por campo) y no llama a ningún RPC hasta que el form
// completo sea válido.
describe("ModalUsuario — UX-43: validación por campo, todos los errores de una vez", () => {
  it("con nombre Y sede vacíos a la vez, muestra AMBOS mensajes en el mismo intento de guardar", () => {
    renderModal({ usuario: { ...usuarioExistente, nombre: "", sede_id: "" } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    // Antes de UX-43 solo se veía "El nombre es obligatorio." — el error
    // de sede quedaba oculto hasta un segundo intento de guardar.
    expect(screen.getByText("El nombre es obligatorio.")).toBeTruthy();
    expect(screen.getByText(/requiere una sede asignada/i)).toBeTruthy();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("marca aria-invalid en cada campo inválido, no solo en un banner genérico", () => {
    renderModal({ usuario: { ...usuarioExistente, nombre: "", sede_id: "" } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    expect(screen.getByLabelText("Nombre completo").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Sede asignada").getAttribute("aria-invalid")).toBe("true");
    // Email era válido en este caso — no debe marcarse como inválido.
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("false");
  });

  it("mueve el foco al primer campo inválido en el orden visual del formulario", () => {
    // nombre (primer campo del form) Y sede inválidos a la vez — el foco
    // debe ir a nombre, no a sede, aunque sede aparezca después en el objeto.
    renderModal({ usuario: { ...usuarioExistente, nombre: "", sede_id: "" } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    expect(document.activeElement).toBe(screen.getByLabelText("Nombre completo"));
  });

  it("con el form válido, no queda ningún fieldError visible y sí llama al RPC", async () => {
    renderModal();
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    expect(screen.queryByText("El nombre es obligatorio.")).toBeNull();
    expect(screen.queryByText(/requiere una sede asignada/i)).toBeNull();
  });

  it("corregir un campo y volver a guardar limpia solo ese fieldError, no los demás pendientes", () => {
    renderModal({ usuario: { ...usuarioExistente, nombre: "", sede_id: "" } });
    fireEvent.click(screen.getByText("Guardar cambios"));
    expect(screen.getByText("El nombre es obligatorio.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Nombre Corregido" } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    expect(screen.queryByText("El nombre es obligatorio.")).toBeNull();
    expect(screen.getByText(/requiere una sede asignada/i)).toBeTruthy();
  });
});
