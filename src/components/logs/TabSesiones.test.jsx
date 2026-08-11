// @vitest-environment jsdom
// =====================================================================
// TabSesiones.test.jsx — Fase 2, prioridad 4 (auditoría de cobertura,
// 10 ago 2026): get_session_logs y admin_borrar_session_logs sin
// ningún test. admin_borrar_session_logs además borra datos de forma
// irreversible — vale la pena cubrir bien el guard de permiso y el
// flujo de confirmación.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from "../../lib/supabase";
import TabSesiones from "./TabSesiones";

const logBase = (overrides = {}) => ({
  id: "s1", evento: "login", nombre: "Coord X", email: "coord@unermb.edu.ve",
  rol: "coordinador", programa: null, created_at: "2026-08-10T10:00:00Z",
  ...overrides,
});

function renderTab(overrides = {}) {
  const showToast = vi.fn();
  const utils = render(<TabSesiones permisos={{ puedeBorrarSesiones: true }} showToast={showToast} {...overrides} />);
  return { ...utils, showToast };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.rpc.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
});

describe("TabSesiones — carga vía get_session_logs", () => {
  it("llama a get_session_logs con page 0 y filtro de email vacío al montar", async () => {
    renderTab();
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("get_session_logs", {
      p_limit: 50, p_offset: 0, p_email: null,
    }));
  });

  it("renderiza los logs devueltos", async () => {
    supabase.rpc.mockResolvedValue({ data: [logBase()], error: null });
    renderTab();
    await waitFor(() => screen.getByText("coord@unermb.edu.ve"));
  });

  it("el filtro de email se manda al RPC y resetea la página", async () => {
    renderTab();
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText("Filtrar por correo…"), { target: { value: "x@x.com" } });

    await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith("get_session_logs", {
      p_limit: 50, p_offset: 0, p_email: "x@x.com",
    }));
  });
});

describe("TabSesiones — visibilidad de borrado según permiso puedeBorrarSesiones", () => {
  it("sin el permiso, no muestra checkboxes de selección", async () => {
    supabase.rpc.mockResolvedValue({ data: [logBase()], error: null });
    renderTab({ permisos: { puedeBorrarSesiones: false } });
    await waitFor(() => screen.getByText("coord@unermb.edu.ve"));
    expect(screen.queryByLabelText("Seleccionar todos")).toBeNull();
  });

  it("con el permiso, muestra el checkbox de 'seleccionar todos'", async () => {
    supabase.rpc.mockResolvedValue({ data: [logBase()], error: null });
    renderTab({ permisos: { puedeBorrarSesiones: true } });
    await waitFor(() => screen.getByText("coord@unermb.edu.ve"));
    expect(screen.getByLabelText("Seleccionar todos")).toBeTruthy();
  });
});

describe("TabSesiones — selección y borrado (admin_borrar_session_logs)", () => {
  it("seleccionar una fila muestra el botón de borrar con el conteo correcto", async () => {
    supabase.rpc.mockResolvedValue({ data: [logBase()], error: null });
    renderTab();
    await waitFor(() => screen.getByText("coord@unermb.edu.ve"));

    fireEvent.click(screen.getByLabelText("Seleccionar este registro"));
    expect(screen.getByText("Borrar seleccionados (1)")).toBeTruthy();
  });

  it("pide confirmación antes de borrar — no llama al RPC de borrado al primer clic", async () => {
    supabase.rpc.mockResolvedValue({ data: [logBase()], error: null });
    renderTab();
    await waitFor(() => screen.getByText("coord@unermb.edu.ve"));

    fireEvent.click(screen.getByLabelText("Seleccionar este registro"));
    fireEvent.click(screen.getByText("Borrar seleccionados (1)"));

    expect(supabase.rpc).not.toHaveBeenCalledWith("admin_borrar_session_logs", expect.anything());
    expect(screen.getByText(/¿Borrar registros de sesión?/)).toBeTruthy();
  });

  it("al confirmar, llama admin_borrar_session_logs con los ids exactos y los quita de la lista", async () => {
    supabase.rpc.mockImplementation((fn) => {
      if (fn === "get_session_logs") return Promise.resolve({ data: [logBase({ id: "s1" }), logBase({ id: "s2", email: "otro@x.com" })], error: null });
      if (fn === "admin_borrar_session_logs") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    renderTab();
    await waitFor(() => screen.getByText("coord@unermb.edu.ve"));

    fireEvent.click(screen.getAllByLabelText("Seleccionar este registro")[0]);
    fireEvent.click(screen.getByText("Borrar seleccionados (1)"));
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("admin_borrar_session_logs", { p_ids: ["s1"] }));
    await waitFor(() => expect(screen.queryByText("coord@unermb.edu.ve")).toBeNull());
    expect(screen.getByText("otro@x.com")).toBeTruthy();
  });

  it("si el RPC de borrado falla, muestra el error y NO quita las filas de la lista", async () => {
    supabase.rpc.mockImplementation((fn) => {
      if (fn === "get_session_logs") return Promise.resolve({ data: [logBase({ id: "s1" })], error: null });
      if (fn === "admin_borrar_session_logs") return Promise.resolve({ data: null, error: { message: "permiso denegado" } });
      return Promise.resolve({ data: null, error: null });
    });
    const { showToast } = renderTab();
    await waitFor(() => screen.getByText("coord@unermb.edu.ve"));

    fireEvent.click(screen.getByLabelText("Seleccionar este registro"));
    fireEvent.click(screen.getByText("Borrar seleccionados (1)"));
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), "error"));
    expect(screen.getByText("coord@unermb.edu.ve")).toBeTruthy();
  });

  it("la selección se limpia al cambiar de página o de filtro (no sobrevive)", async () => {
    supabase.rpc.mockResolvedValue({ data: [logBase()], error: null });
    renderTab();
    await waitFor(() => screen.getByText("coord@unermb.edu.ve"));

    fireEvent.click(screen.getByLabelText("Seleccionar este registro"));
    expect(screen.getByText("Borrar seleccionados (1)")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Filtrar por correo…"), { target: { value: "otro" } });

    await waitFor(() => expect(screen.queryByText(/Borrar seleccionados/)).toBeNull());
  });
});
