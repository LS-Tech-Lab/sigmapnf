// @vitest-environment jsdom
// =====================================================================
// useQRSession.off10.test.js — OFF-10: arranque de sesión QR sin red.
//
// Cubre los dos caminos nuevos de crearSesion() cuando no hay conexión:
//   1. Hay una sesión pre-generada en caché para el mismo contexto →
//      se activa localmente, sin llamar a crear_qr_session.
//   2. No hay nada cacheado → no bloquea con un callejón sin salida:
//      expone requiereModoManual=true para que la UI ofrezca el
//      registro manual de respaldo (opción C).
// Y prepararSesionOffline(): la pre-generación en sí (opción A), que
// solo debe poder ejecutarse con red.
//
// Aislamiento de IndexedDB: misma estrategia que offlineQueue.test.js
// (IDBFactory nueva por test). navigator.onLine se redefine por test
// con Object.defineProperty porque jsdom lo expone como getter fijo.
// =====================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

vi.mock("../lib/supabase", () => {
  const chain = {
    select: vi.fn(function () { return this; }),
    eq: vi.fn(function () { return this; }),
    order: vi.fn(function () { return this; }),
    limit: vi.fn(function () { return this; }),
    abortSignal: vi.fn(function () { return this; }),
    update: vi.fn(function () { return this; }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    then: (resolve) => resolve({ count: 0, data: null }),
  };
  return {
    supabase: {
      rpc: vi.fn(),
      channel: vi.fn(() => ({
        on: vi.fn(function () { return this; }),
        subscribe: vi.fn(function () { return this; }),
      })),
      removeChannel: vi.fn(),
      from: vi.fn(() => chain),
    },
  };
});

import { supabase } from "../lib/supabase";
import useQRSession from "./useQRSession";
import { guardarSesionCacheada } from "../utils/qrOfflineCache";

function setOnline(value) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

const ORIGINAL_ONLINE_DESCRIPTOR = Object.getOwnPropertyDescriptor(window.navigator, "onLine");

afterEach(() => {
  if (ORIGINAL_ONLINE_DESCRIPTOR) {
    Object.defineProperty(window.navigator, "onLine", ORIGINAL_ONLINE_DESCRIPTOR);
  }
  vi.clearAllMocks();
});

function futuro(minutos) {
  return new Date(Date.now() + minutos * 60 * 1000).toISOString();
}

describe("useQRSession — OFF-10: activar sesión cacheada sin red", () => {
  it("con red normal, no toca la caché ni cambia de comportamiento", async () => {
    setOnline(true);
    supabase.rpc.mockResolvedValueOnce({
      data: { ok: true, session_id: "s-online", token: "t-online", expires_at: futuro(360) },
      error: null,
    });

    const { result, unmount } = renderHook(() => useQRSession());
    let ok;
    await act(async () => {
      ok = await result.current.crearSesion({ turno: "DIURNO", fecha: "2026-08-07", sede_id: "cabimas" });
    });

    expect(ok).toBe(true);
    expect(result.current.sessionId).toBe("s-online");
    expect(result.current.requiereModoManual).toBe(false);
    expect(supabase.rpc).toHaveBeenCalledWith("crear_qr_session", expect.any(Object));

    unmount();
  });

  it("sin red y con sesión pre-generada vigente en caché: activa localmente sin llamar al RPC", async () => {
    await guardarSesionCacheada({
      fecha: "2026-08-07", turno: "DIURNO", programa: null, sede_id: "cabimas",
      sessionId: "s-cache", token: "t-cache", expiresAt: futuro(300),
    });

    setOnline(false);

    const { result, unmount } = renderHook(() => useQRSession());
    let ok;
    await act(async () => {
      ok = await result.current.crearSesion({ turno: "DIURNO", fecha: "2026-08-07", sede_id: "cabimas" });
    });

    expect(ok).toBe(true);
    expect(result.current.activa).toBe(true);
    expect(result.current.sessionId).toBe("s-cache");
    expect(result.current.token).toBe("t-cache");
    expect(result.current.requiereModoManual).toBe(false);
    expect(result.current.error).toBe(null);
    // Lo esencial de OFF-10: activar desde caché NUNCA debe llamar al RPC.
    expect(supabase.rpc).not.toHaveBeenCalled();

    unmount();
  });

  it("sin red y sin nada cacheado para ese contexto: no activa, y pide modo manual", async () => {
    // Cacheada para un turno distinto — no debe usarse como fallback.
    await guardarSesionCacheada({
      fecha: "2026-08-07", turno: "VESPERTINO", programa: null, sede_id: "cabimas",
      sessionId: "s-otro-turno", token: "t-otro-turno", expiresAt: futuro(300),
    });

    setOnline(false);

    const { result, unmount } = renderHook(() => useQRSession());
    let ok;
    await act(async () => {
      ok = await result.current.crearSesion({ turno: "DIURNO", fecha: "2026-08-07", sede_id: "cabimas" });
    });

    expect(ok).toBe(false);
    expect(result.current.activa).toBe(false);
    expect(result.current.sessionId).toBe(null);
    expect(result.current.requiereModoManual).toBe(true);
    expect(result.current.error).toMatch(/registro manual/i);
    expect(supabase.rpc).not.toHaveBeenCalled();

    unmount();
  });

  it("sin red y con sesión cacheada pero ya vencida: no la usa, pide modo manual", async () => {
    await guardarSesionCacheada({
      fecha: "2026-08-07", turno: "DIURNO", programa: null, sede_id: "cabimas",
      sessionId: "s-vencida", token: "t-vencida", expiresAt: futuro(-10),
    });

    setOnline(false);

    const { result, unmount } = renderHook(() => useQRSession());
    let ok;
    await act(async () => {
      ok = await result.current.crearSesion({ turno: "DIURNO", fecha: "2026-08-07", sede_id: "cabimas" });
    });

    expect(ok).toBe(false);
    expect(result.current.requiereModoManual).toBe(true);

    unmount();
  });
});

describe("useQRSession — OFF-10: prepararSesionOffline (opción A)", () => {
  it("con red: llama al RPC normal y guarda el resultado en caché", async () => {
    setOnline(true);
    supabase.rpc.mockResolvedValueOnce({
      data: { ok: true, session_id: "s-prep", token: "t-prep", expires_at: futuro(360) },
      error: null,
    });

    const { result, unmount } = renderHook(() => useQRSession());
    let res;
    await act(async () => {
      res = await result.current.prepararSesionOffline({
        turno: "VESPERTINO", fecha: "2026-08-07", sede_id: "cabimas",
      });
    });

    expect(res.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "crear_qr_session",
      expect.objectContaining({ p_turno: "VESPERTINO", p_ttl_min: 360, p_fecha: "2026-08-07" })
    );
    // No debe tocar la sesión activa/mostrada en pantalla.
    expect(result.current.activa).toBe(false);
    expect(result.current.sessionId).toBe(null);

    unmount();
  });

  it("sin red: no llama al RPC y devuelve ok:false", async () => {
    setOnline(false);

    const { result, unmount } = renderHook(() => useQRSession());
    let res;
    await act(async () => {
      res = await result.current.prepararSesionOffline({ turno: "VESPERTINO", fecha: "2026-08-07" });
    });

    expect(res.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();

    unmount();
  });

  it("una sesión preparada con prepararSesionOffline queda disponible para crearSesion() offline después", async () => {
    setOnline(true);
    supabase.rpc.mockResolvedValueOnce({
      data: { ok: true, session_id: "s-prep2", token: "t-prep2", expires_at: futuro(360) },
      error: null,
    });

    const { result, unmount } = renderHook(() => useQRSession());
    await act(async () => {
      await result.current.prepararSesionOffline({
        turno: "MIXTO", fecha: "2026-08-07", sede_id: "cabimas",
      });
    });

    setOnline(false);
    let ok;
    await act(async () => {
      ok = await result.current.crearSesion({ turno: "MIXTO", fecha: "2026-08-07", sede_id: "cabimas" });
    });

    expect(ok).toBe(true);
    expect(result.current.sessionId).toBe("s-prep2");
    // Solo la llamada de prepararSesionOffline llegó al RPC — activar
    // desde caché no debe generar una segunda.
    expect(supabase.rpc).toHaveBeenCalledTimes(1);

    unmount();
  });
});
