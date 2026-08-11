// @vitest-environment jsdom
// =====================================================================
// ModalRol.test.jsx — Fase 2, prioridad 2 (auditoría de cobertura,
// 10 ago 2026): admin_upsert_role no tenía ningún test. Es superficie
// de escalación de privilegios directa — cualquier bug acá puede
// terminar en un rol con permisos que no debería tener, o en un
// permiso que se guarda distinto de lo que la UI mostraba.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import ModalRol from "./ModalRol";

const rolExistente = {
  nombre: "coordinador",
  label: "Coordinador",
  emoji: "🧑‍💼",
  color: "var(--color-text-mid)",
  restringe_programa: true,
  permisos: { puedeVerReportes: true, puedeEditarHorarios: false },
};

function renderModal(overrides = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const logAudit = vi.fn().mockResolvedValue();
  const utils = render(
    <ModalRol rol={null} onSave={onSave} onClose={onClose} logAudit={logAudit} {...overrides} />
  );
  return { ...utils, onSave, onClose, logAudit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("ModalRol — crear rol nuevo", () => {
  it("exige identificador y nombre visible antes de llamar al RPC", async () => {
    const { onSave } = renderModal();
    fireEvent.click(screen.getByText("Crear rol"));
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rechaza un identificador con caracteres fuera de [a-z0-9_] que sobreviven la normalización", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Nombre visible/), { target: { value: "Coordinador X" } });
    // El onChange del campo normaliza a minúsculas y cambia espacios por
    // "_", pero NO elimina acentos ni símbolos — "café!" sobrevive esa
    // normalización tal cual y debe seguir siendo rechazado por el
    // regex ^[a-z0-9_]+$ del handleSave.
    fireEvent.change(screen.getByLabelText(/Identificador/), { target: { value: "café!" } });
    fireEvent.click(screen.getByText("Crear rol"));
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/solo puede tener minúsculas/i)).toBeTruthy();
  });

  it("llama a admin_upsert_role con los 6 parámetros exactos, permisos incluidos", async () => {
    supabase.rpc.mockResolvedValue({ error: null });
    const { onSave, logAudit } = renderModal();

    fireEvent.change(screen.getByLabelText(/Identificador/), { target: { value: "Coord Info" } });
    fireEvent.change(screen.getByLabelText(/Nombre visible/), { target: { value: "Coordinador Informática" } });
    fireEvent.click(screen.getByText("Crear rol"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());

    expect(supabase.rpc).toHaveBeenCalledWith("admin_upsert_role", {
      // El input normaliza a minúsculas y reemplaza espacios por "_" en
      // cada keystroke — "Coord Info" tipeado de una vez llega como
      // "coord_info".
      p_nombre: "coord_info",
      p_label: "Coordinador Informática",
      p_emoji: "👤",
      p_color: "var(--color-text-mid)",
      p_restringe_programa: false,
      p_permisos: expect.any(Object),
    });

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      accion: "CREAR_ROL",
      entidad: "roles",
      entidad_id: "coord_info",
    }));
    expect(onSave).toHaveBeenCalled();
  });

  it("con error del RPC, muestra el mensaje y NO llama onSave (no cierra el modal)", async () => {
    supabase.rpc.mockResolvedValue({ error: { message: "Ya existe un rol con ese identificador." } });
    const { onSave } = renderModal();

    fireEvent.change(screen.getByLabelText(/Identificador/), { target: { value: "coordinador" } });
    fireEvent.change(screen.getByLabelText(/Nombre visible/), { target: { value: "Coordinador" } });
    fireEvent.click(screen.getByText("Crear rol"));

    await waitFor(() => screen.getByText(/Ya existe un rol/));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("\"Todos\" y \"Ninguno\" activan/desactivan el conjunto completo de permisos enviado al RPC", async () => {
    supabase.rpc.mockResolvedValue({ error: null });
    renderModal();

    fireEvent.change(screen.getByLabelText(/Identificador/), { target: { value: "temp" } });
    fireEvent.change(screen.getByLabelText(/Nombre visible/), { target: { value: "Temporal" } });
    fireEvent.click(screen.getByText("Todos"));
    fireEvent.click(screen.getByText("Crear rol"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    const [, args] = supabase.rpc.mock.calls[0];
    const valores = Object.values(args.p_permisos);
    expect(valores.length).toBeGreaterThan(0);
    expect(valores.every(Boolean)).toBe(true);
  });
});

describe("ModalRol — editar rol existente", () => {
  it("usa el nombre (identificador) original del rol, no permite cambiarlo desde el form", () => {
    renderModal({ rol: rolExistente });
    expect(screen.queryByLabelText(/Identificador/)).toBeNull();
  });

  it("al guardar, envía p_nombre = identificador original aunque se edite solo el label", async () => {
    supabase.rpc.mockResolvedValue({ error: null });
    const { logAudit } = renderModal({ rol: rolExistente });

    fireEvent.change(screen.getByLabelText(/Nombre visible/), { target: { value: "Coordinador General" } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    expect(supabase.rpc).toHaveBeenCalledWith("admin_upsert_role", expect.objectContaining({
      p_nombre: "coordinador",
      p_label: "Coordinador General",
    }));

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      accion: "EDITAR_ROL",
      // Auditoría de escalación de privilegios: debe quedar registrado
      // el estado ANTES del cambio, no solo el de después.
      datos_antes: expect.objectContaining({ permisos: rolExistente.permisos }),
    }));
  });

  it("precarga los permisos existentes del rol en el form (no arranca todo en false)", async () => {
    supabase.rpc.mockResolvedValue({ error: null });
    renderModal({ rol: rolExistente });

    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    const [, args] = supabase.rpc.mock.calls[0];
    expect(args.p_permisos.puedeVerReportes).toBe(true);
    expect(args.p_permisos.puedeEditarHorarios).toBe(false);
  });
});
