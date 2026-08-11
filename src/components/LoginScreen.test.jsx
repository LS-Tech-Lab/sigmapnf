// @vitest-environment jsdom
// =====================================================================
// LoginScreen.test.jsx — Fase 2, prioridad 3 (auditoría de cobertura,
// 10 ago 2026): handleLogin() (verificar_bloqueo_login / log_login_fallido)
// no tenía ningún test pese a ser la puerta de entrada a todo el
// sistema y tener dos capas de lockout distintas (SEC-6 en IDB,
// SEC-7 server-side vía RPC).
//
// Alcance: cubre el flujo de login normal (online). El flujo de PIN
// offline ya lo cubre pinOffline.test.js a nivel de la lógica pura
// (PBKDF2, lockout); acá solo se verifica que handlePinLogin() llame
// correctamente a esas funciones, ya mockeadas como módulo completo.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    auth: { signInWithPassword: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn(function () { return this; }),
      eq:     vi.fn(function () { return this; }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

vi.mock("../utils/pinOffline", () => ({
  listarUsuariosOffline: vi.fn().mockResolvedValue([]),
  verificarPinOffline: vi.fn(),
  tienePinOffline: vi.fn().mockResolvedValue(true), // por defecto, no mostrar modal PIN
  guardarPinOffline: vi.fn().mockResolvedValue(),
  leerLockoutIDB: vi.fn().mockResolvedValue({ intentos: 0, bloqueadoHasta: null }),
  registrarIntentoPinFallido: vi.fn(),
  limpiarLockoutIDB: vi.fn(),
  leerLoginLockoutIDB: vi.fn().mockResolvedValue({ intentos: 0, bloqueadoHasta: null }),
  registrarIntentoLoginFallido: vi.fn().mockResolvedValue({ intentos: 1, bloqueadoHasta: null, bloqueadoAhora: false }),
  limpiarLoginLockoutIDB: vi.fn(),
}));

import { supabase } from "../lib/supabase";
import * as pinOffline from "../utils/pinOffline";
import LoginScreen from "./LoginScreen";

function renderLogin(overrides = {}) {
  const onOfflineLogin = vi.fn();
  const utils = render(<LoginScreen onOfflineLogin={onOfflineLogin} {...overrides} />);
  return { ...utils, onOfflineLogin };
}

async function completarForm(email = "coord@unermb.edu.ve", password = "Abcdefgh12") {
  await waitFor(() => screen.getByLabelText(/Correo electrónico/));
  fireEvent.change(screen.getByLabelText(/Correo electrónico/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /Iniciar sesión/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
  supabase.rpc.mockResolvedValue({ data: { bloqueado: false }, error: null });
  pinOffline.tienePinOffline.mockResolvedValue(true);
  pinOffline.leerLoginLockoutIDB.mockResolvedValue({ intentos: 0, bloqueadoHasta: null });
  pinOffline.registrarIntentoLoginFallido.mockResolvedValue({ intentos: 1, bloqueadoHasta: null, bloqueadoAhora: false });
});

afterEach(() => {
  cleanup();
});

describe("LoginScreen — SEC-7: lockout server-side, consultado ANTES de gastar el intento en Auth", () => {
  it("si verificar_bloqueo_login dice bloqueado, NO llama a signInWithPassword", async () => {
    supabase.rpc.mockResolvedValue({
      data: { bloqueado: true, intentos: 5, desbloquea_en: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    renderLogin();
    await completarForm();

    await waitFor(() => screen.getByText(/Demasiados intentos fallidos/));
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("consulta verificar_bloqueo_login con el email exacto del form", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1", email: "x@x.com" } }, error: null });
    renderLogin();
    await completarForm("coord@unermb.edu.ve", "Abcdefgh12");

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith(
      "verificar_bloqueo_login", { p_email: "coord@unermb.edu.ve" }
    ));
  });

  it("si la RPC de bloqueo falla (red), el login sigue intentándose (no bloquea por eso)", async () => {
    supabase.rpc.mockRejectedValue(new Error("network down"));
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1", email: "x@x.com" } }, error: null });
    renderLogin();
    await completarForm();

    await waitFor(() => expect(supabase.auth.signInWithPassword).toHaveBeenCalled());
  });
});

describe("LoginScreen — login fallido: SEC-6 (IDB) + log_login_fallido", () => {
  it("credenciales inválidas: muestra mensaje, registra en IDB y llama log_login_fallido", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: {}, error: { message: "Invalid login credentials" },
    });
    renderLogin();
    await completarForm();

    await waitFor(() => screen.getByText(/Correo o contraseña incorrectos/));
    expect(pinOffline.registrarIntentoLoginFallido).toHaveBeenCalledWith("coord@unermb.edu.ve");
    expect(supabase.rpc).toHaveBeenCalledWith("log_login_fallido", expect.objectContaining({
      p_email: "coord@unermb.edu.ve",
      p_motivo: "Invalid login credentials",
    }));
  });

  it("cuando registrarIntentoLoginFallido devuelve bloqueadoAhora, activa el lockout local inmediatamente", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: {}, error: { message: "Invalid login credentials" },
    });
    const bloqueadoHasta = Date.now() + 60000;
    pinOffline.registrarIntentoLoginFallido.mockResolvedValue({ intentos: 5, bloqueadoHasta, bloqueadoAhora: true });
    renderLogin();
    await completarForm();

    await waitFor(() => screen.getByText(/Bloqueado \(/));
  });

  it("muestra mensajes distintos según el tipo de error de Auth", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "User not found" } });
    renderLogin();
    await completarForm();
    await waitFor(() => screen.getByText(/No existe una cuenta con ese correo/));
  });
});

describe("LoginScreen — login exitoso", () => {
  it("limpia el lockout de IDB y no muestra error", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1", email: "coord@unermb.edu.ve" } }, error: null,
    });
    renderLogin();
    await completarForm();

    await waitFor(() => expect(pinOffline.limpiarLoginLockoutIDB).toHaveBeenCalledWith("coord@unermb.edu.ve"));
    expect(screen.queryByText(/incorrectos/)).toBeNull();
  });

  it("si el usuario NO tiene PIN offline guardado, muestra el modal para activarlo", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1", email: "coord@unermb.edu.ve" } }, error: null,
    });
    supabase.from.mockReturnValue({
      select: vi.fn(function () { return this; }),
      eq:     vi.fn(function () { return this; }),
      single: vi.fn().mockResolvedValue({ data: { nombre: "Coord", rol: "coordinador" }, error: null }),
    });
    pinOffline.tienePinOffline.mockResolvedValue(false);

    renderLogin();
    await completarForm();

    await waitFor(() => expect(screen.getByText("Activar PIN offline")).toBeTruthy());
  });

  it("si el usuario YA tiene PIN offline guardado, NO muestra el modal", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1", email: "coord@unermb.edu.ve" } }, error: null,
    });
    pinOffline.tienePinOffline.mockResolvedValue(true);

    renderLogin();
    await completarForm();

    await waitFor(() => expect(pinOffline.tienePinOffline).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("LoginScreen — el input queda bloqueado mientras isLocked es true", () => {
  it("con lockout activo desde el montaje (SEC-6 ya bloqueado antes de escribir), el submit no dispara nada", async () => {
    pinOffline.leerLoginLockoutIDB.mockResolvedValue({
      intentos: 5, bloqueadoHasta: Date.now() + 30000,
    });
    renderLogin();

    fireEvent.change(await screen.findByLabelText(/Correo electrónico/), { target: { value: "coord@unermb.edu.ve" } });
    await waitFor(() => screen.getByText(/Bloqueado \(/));

    fireEvent.click(screen.getByRole("button", { name: /Bloqueado/ }));
    expect(supabase.rpc).not.toHaveBeenCalledWith("verificar_bloqueo_login", expect.anything());
  });
});
