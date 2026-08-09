// @vitest-environment jsdom
// =====================================================================
// useInstallPrompt.test.js — ADMIN-7 (mejora "PWA completa" para /scan y
// la proyección QR). Cubre las tres ramas de estado que el hook expone:
// disponible para instalar (Chrome/Edge/Android), ya instalada
// (display-mode: standalone), y el caso especial de iOS Safari (nunca
// dispara beforeinstallprompt, no hay API programática).
// =====================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useInstallPrompt from "./useInstallPrompt";

function mockMatchMedia(standalone) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query === "(display-mode: standalone)" ? standalone : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function makeBeforeInstallEvent(outcome = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  event.prompt = vi.fn();
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

beforeEach(() => {
  mockMatchMedia(false);
  window.navigator.standalone = undefined;
  vi.stubGlobal("navigator", { ...window.navigator, userAgent: "Mozilla/5.0 (Android)" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useInstallPrompt", () => {
  it("no ofrece instalar mientras no llegó beforeinstallprompt", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.puedeInstalar).toBe(false);
    expect(result.current.instalada).toBe(false);
  });

  it("puedeInstalar pasa a true al capturar beforeinstallprompt, y preventDefault evita el mini-infobar nativo", () => {
    const { result } = renderHook(() => useInstallPrompt());
    const evento = makeBeforeInstallEvent();
    const preventDefaultSpy = vi.spyOn(evento, "preventDefault");

    act(() => { window.dispatchEvent(evento); });

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(result.current.puedeInstalar).toBe(true);
  });

  it("instalar() dispara el prompt nativo y limpia el evento tras la elección (de un solo uso)", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const evento = makeBeforeInstallEvent("accepted");
    act(() => { window.dispatchEvent(evento); });
    expect(result.current.puedeInstalar).toBe(true);

    let aceptado;
    await act(async () => {
      aceptado = await result.current.instalar();
    });

    expect(evento.prompt).toHaveBeenCalled();
    expect(aceptado).toBe(true);
    // Un solo uso: sin un beforeinstallprompt nuevo, no hay nada que ofrecer.
    expect(result.current.puedeInstalar).toBe(false);
  });

  it("instalar() sin evento capturado no revienta y devuelve false", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    let respuesta;
    await act(async () => { respuesta = await result.current.instalar(); });
    expect(respuesta).toBe(false);
  });

  it("appinstalled marca instalada=true y descarta cualquier prompt pendiente", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => { window.dispatchEvent(makeBeforeInstallEvent()); });
    expect(result.current.puedeInstalar).toBe(true);

    act(() => { window.dispatchEvent(new Event("appinstalled")); });

    expect(result.current.instalada).toBe(true);
    expect(result.current.puedeInstalar).toBe(false);
  });

  it("ya en modo standalone (display-mode), no ofrece instalar aunque llegue beforeinstallprompt", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.instalada).toBe(true);

    act(() => { window.dispatchEvent(makeBeforeInstallEvent()); });
    expect(result.current.puedeInstalar).toBe(false);
  });

  it("iOS Safari: esIOS=true (para mostrar instrucciones manuales) y nunca puedeInstalar", () => {
    vi.stubGlobal("navigator", {
      ...window.navigator,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.esIOS).toBe(true);
    expect(result.current.puedeInstalar).toBe(false);
  });

  it("iOS ya instalada (navigator.standalone) no muestra ni botón ni hint", () => {
    vi.stubGlobal("navigator", {
      ...window.navigator,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      standalone: true,
    });
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.instalada).toBe(true);
    expect(result.current.esIOS).toBe(false);
  });
});
