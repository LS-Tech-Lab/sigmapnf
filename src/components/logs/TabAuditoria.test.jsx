// @vitest-environment jsdom
// =====================================================================
// TabAuditoria.test.jsx — Fase 2, prioridad 4 (auditoría de cobertura,
// 10 ago 2026): get_audit_logs no tenía ningún test. Es la única
// ventana para reconstruir qué pasó tras un incidente (como el de
// hoy) — un bug acá no rompe la operación normal del sistema, pero sí
// deja a un admin ciego justo cuando más necesita ver.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from "../../lib/supabase";
import TabAuditoria from "./TabAuditoria";

const logBase = (overrides = {}) => ({
  id: "log-1", accion: "EDITAR_DOCENTE", entidad: "docentes", lapso: "1-2026",
  programa_afectado: null, resumen: "Editó a Juan Pérez", nombre: "Coord X",
  email: "coord@unermb.edu.ve", rol: "coordinador", created_at: "2026-08-10T10:00:00Z",
  datos_antes: null, datos_despues: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  supabase.rpc.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
});

describe("TabAuditoria — carga inicial", () => {
  it("llama a get_audit_logs con page 0 y filtros vacíos al montar", async () => {
    render(<TabAuditoria />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("get_audit_logs", {
      p_limit: 50, p_offset: 0, p_email: null, p_accion: null, p_lapso: null, p_programa: null,
    }));
  });

  it("muestra el estado vacío cuando no hay logs", async () => {
    render(<TabAuditoria />);
    await waitFor(() => screen.getByText(/No hay registros de auditoría/));
  });

  it("renderiza los logs devueltos por el RPC", async () => {
    supabase.rpc.mockResolvedValue({ data: [logBase()], error: null });
    render(<TabAuditoria />);
    await waitFor(() => screen.getByText("Editó a Juan Pérez"));
  });
});

describe("TabAuditoria — filtros server-side (email, acción, lapso)", () => {
  it("el filtro de email se manda al RPC y resetea la página a 0", async () => {
    render(<TabAuditoria />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText("Filtrar por usuario…"), { target: { value: "coord@x.com" } });

    await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith("get_audit_logs", expect.objectContaining({
      p_email: "coord@x.com", p_offset: 0,
    })));
  });

  it("el filtro de lapso se manda tal cual al RPC", async () => {
    render(<TabAuditoria />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText("Trimestre (ej: 2-2025)"), { target: { value: "2-2026" } });

    await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith("get_audit_logs", expect.objectContaining({
      p_lapso: "2-2026",
    })));
  });
});

describe("TabAuditoria — filtros client-side (entidad, fecha) — get_audit_logs no los soporta server-side", () => {
  it("el filtro de entidad excluye logs de otras entidades sin volver a llamar al RPC con otro parámetro", async () => {
    supabase.rpc.mockResolvedValue({
      data: [logBase({ id: "1", entidad: "docentes" }), logBase({ id: "2", entidad: "horarios", resumen: "Cambió un horario" })],
      error: null,
    });
    render(<TabAuditoria />);
    await waitFor(() => screen.getByText("Editó a Juan Pérez"));
    expect(screen.getByText("Cambió un horario")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("Todas las entidades"), { target: { value: "docentes" } });

    await waitFor(() => expect(screen.queryByText("Cambió un horario")).toBeNull());
    expect(screen.getByText("Editó a Juan Pérez")).toBeTruthy();
  });

  it("el filtro 'Desde' excluye logs anteriores a esa fecha", async () => {
    supabase.rpc.mockResolvedValue({
      data: [
        logBase({ id: "1", resumen: "Log viejo", created_at: "2026-01-01T10:00:00Z" }),
        logBase({ id: "2", resumen: "Log reciente", created_at: "2026-08-10T10:00:00Z" }),
      ],
      error: null,
    });
    render(<TabAuditoria />);
    await waitFor(() => screen.getByText("Log viejo"));

    const inputsFecha = document.querySelectorAll('input[type="date"]');
    fireEvent.change(inputsFecha[0], { target: { value: "2026-06-01" } }); // "Desde" es el primero

    await waitFor(() => expect(screen.queryByText("Log viejo")).toBeNull());
    expect(screen.getByText("Log reciente")).toBeTruthy();
  });
});

describe("TabAuditoria — expandir detalle (datos_antes / datos_despues)", () => {
  it("un log con datos_antes/datos_despues los muestra al expandir, útil para reconstruir un incidente", async () => {
    supabase.rpc.mockResolvedValue({
      data: [logBase({
        datos_antes: { permisos: { puedeVerReportes: false } },
        datos_despues: { permisos: { puedeVerReportes: true } },
      })],
      error: null,
    });
    render(<TabAuditoria />);
    await waitFor(() => screen.getByText("Editó a Juan Pérez"));

    fireEvent.click(screen.getByText("Editó a Juan Pérez"));

    await waitFor(() => screen.getByText("Estado anterior"));
    expect(screen.getByText("Estado nuevo")).toBeTruthy();
    expect(screen.getByText(/puedeVerReportes.*false/s)).toBeTruthy();
  });
});

describe("TabAuditoria — paginación", () => {
  it("el botón Siguiente incrementa p_offset en PAGE_SIZE (50)", async () => {
    const pagina1 = Array.from({ length: 50 }, (_, i) => logBase({ id: `l${i}` }));
    supabase.rpc.mockResolvedValue({ data: pagina1, error: null });
    render(<TabAuditoria />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Siguiente →"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith("get_audit_logs", expect.objectContaining({
      p_offset: 50,
    })));
  });

  it("Siguiente se deshabilita cuando la página trae menos de PAGE_SIZE (última página)", async () => {
    supabase.rpc.mockResolvedValue({ data: [logBase()], error: null });
    render(<TabAuditoria />);
    await waitFor(() => screen.getByText("Editó a Juan Pérez"));
    expect(screen.getByText("Siguiente →").closest("button").disabled).toBe(true);
  });

  it("Anterior se deshabilita en la página 0", async () => {
    render(<TabAuditoria />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    expect(screen.getByText("← Anterior").closest("button").disabled).toBe(true);
  });
});

describe("TabAuditoria — Limpiar filtros", () => {
  it("resetea todos los filtros y vuelve a la página 0", async () => {
    render(<TabAuditoria />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText("Filtrar por usuario…"), { target: { value: "x@x.com" } });
    await waitFor(() => screen.getByText("Limpiar"));

    fireEvent.click(screen.getByText("Limpiar"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith("get_audit_logs", expect.objectContaining({
      p_email: null, p_accion: null, p_lapso: null, p_offset: 0,
    })));
    expect(screen.getByPlaceholderText("Filtrar por usuario…").value).toBe("");
  });
});
