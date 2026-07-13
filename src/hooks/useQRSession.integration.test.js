// @vitest-environment jsdom
// =====================================================================
// useQRSession.integration.test.js — F3 (auditoría julio 2026):
// cobertura de flujo real, no solo función pura.
//
// Cubre el flujo "un admin abre el Panel QR y genera una sesión para que
// los docentes escaneen": la orquestación real entre el hook y la RPC
// crear_qr_session (éxito y fallo), que es exactamente el camino que se
// ejecuta al abrir AdminQRPanel y presionar "Iniciar sesión QR".
//
// El resto de las responsabilidades del hook (rotación por Realtime,
// poll de respaldo, auto-renovado por TTL) están documentadas en el
// propio archivo fuente con comentarios "FIX (...)" extensos y no se
// re-verifican aquí: son mecanismos de fondo con intervalos largos que
// no se disparan en la ventana de un test, y agregarlos requeriría fake
// timers que complicarían el test sin cubrir una regresión real de
// negocio. Lo que sí importa para el flujo de usuario —crear la sesión y
// obtener un token válido, o enterarse claramente si algo falló— queda
// cubierto por los dos casos de abajo.
//
// Se mockea todo el módulo supabase — nunca se conecta a una base real.
// =====================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../lib/supabase", () => {
  const chain = {
    select: vi.fn(function () { return this; }),
    eq: vi.fn(function () { return this; }),
    order: vi.fn(function () { return this; }),
    limit: vi.fn(function () { return this; }),
    abortSignal: vi.fn(function () { return this; }),
    update: vi.fn(function () { return this; }),
    // La recuperación de sesión al montar (`maybeSingle`) y el conteo de
    // escaneos para el poll de respaldo (`.then` directo sobre el chain)
    // ambos deben resolver a "nada que hacer" para no interferir con el
    // flujo de crearSesion() que se está probando.
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useQRSession — flujo de creación de sesión QR", () => {
  it("crearSesion() con RPC exitosa activa la sesión y expone token/expiración", async () => {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    supabase.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        session_id: "sess-123",
        token: "tok-abc",
        expires_at: expiresAt,
      },
      error: null,
    });

    const { result, unmount } = renderHook(() => useQRSession());

    let ok;
    await act(async () => {
      ok = await result.current.crearSesion({ turno: "Diurno" });
    });

    expect(ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "crear_qr_session",
      expect.objectContaining({ p_turno: "Diurno", p_ttl_min: 5 })
    );
    expect(result.current.activa).toBe(true);
    expect(result.current.sessionId).toBe("sess-123");
    expect(result.current.token).toBe("tok-abc");
    expect(result.current.qrUrl).toContain("token=tok-abc");
    expect(result.current.error).toBe(null);
    expect(result.current.loading).toBe(false);

    unmount();
  });

  it("crearSesion() con RPC fallida NO activa la sesión y expone el mensaje de error", async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: { ok: false, mensaje: "Ya existe una sesión activa para este turno." },
      error: null,
    });

    const { result, unmount } = renderHook(() => useQRSession());

    let ok;
    await act(async () => {
      ok = await result.current.crearSesion({ turno: "Diurno" });
    });

    expect(ok).toBe(false);
    expect(result.current.activa).toBe(false);
    expect(result.current.sessionId).toBe(null);
    expect(result.current.error).toBe("Ya existe una sesión activa para este turno.");
    expect(result.current.loading).toBe(false);

    unmount();
  });
});
