// fetchWithRetry.test.js — ARCH-45 (auditoría E2E, 18 de agosto de 2026):
// backoff exponencial ante fallos de red transitorios, sin reintentar
// aborts intencionales ni errores permanentes de Postgres/PostgREST.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { esErrorDeRed, conReintento } from "./fetchWithRetry";

describe("esErrorDeRed", () => {
  it("reconoce un TypeError (patrón real de fetch fallido en navegadores)", () => {
    expect(esErrorDeRed(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("reconoce mensajes de red/timeout aunque no sean TypeError", () => {
    expect(esErrorDeRed({ message: "Network request failed" })).toBe(true);
    expect(esErrorDeRed({ message: "timeout de conexión" })).toBe(true);
  });

  it("NO reconoce un AbortError -- es un abort intencional, no un fallo de red", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(esErrorDeRed(err)).toBe(false);
  });

  it("NO reconoce un error de Postgres/PostgREST (trae `code`) -- es permanente", () => {
    expect(esErrorDeRed({ code: "42501", message: "permission denied for table horarios" })).toBe(false);
  });

  it("devuelve false para valores nulos/indefinidos", () => {
    expect(esErrorDeRed(null)).toBe(false);
    expect(esErrorDeRed(undefined)).toBe(false);
  });
});

describe("conReintento", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("devuelve el resultado directo si fn() tiene éxito al primer intento", async () => {
    const fn = vi.fn().mockResolvedValue({ data: [1, 2, 3], error: null });
    const resultado = await conReintento(fn, { intentos: 3, baseMs: 10 });
    expect(resultado).toEqual({ data: [1, 2, 3], error: null });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("reintenta con backoff exponencial ante un error de red devuelto como { error }", async () => {
    const errorDeRed = { message: "Failed to fetch" };
    const fn = vi.fn()
      .mockResolvedValueOnce({ data: null, error: errorDeRed })
      .mockResolvedValueOnce({ data: null, error: errorDeRed })
      .mockResolvedValueOnce({ data: "ok", error: null });

    const promesa = conReintento(fn, { intentos: 3, baseMs: 100 });

    await vi.advanceTimersByTimeAsync(100);  // backoff del 1er reintento (100ms)
    await vi.advanceTimersByTimeAsync(200);  // backoff del 2do reintento (200ms, exponencial)

    const resultado = await promesa;
    expect(resultado).toEqual({ data: "ok", error: null });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("reintenta cuando fn() lanza una excepción de red (TypeError)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ data: "ok", error: null });

    const promesa = conReintento(fn, { intentos: 3, baseMs: 50 });
    await vi.advanceTimersByTimeAsync(50);

    const resultado = await promesa;
    expect(resultado).toEqual({ data: "ok", error: null });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("NO reintenta un error permanente de Postgres (RLS/permiso) -- devuelve de inmediato", async () => {
    const errorPermiso = { code: "42501", message: "permission denied for table horarios" };
    const fn = vi.fn().mockResolvedValue({ data: null, error: errorPermiso });

    const resultado = await conReintento(fn, { intentos: 3, baseMs: 10 });
    expect(resultado).toEqual({ data: null, error: errorPermiso });
    expect(fn).toHaveBeenCalledTimes(1); // sin reintentos
  });

  it("NO reintenta un AbortError -- lo relanza de inmediato", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fn = vi.fn().mockRejectedValue(abortError);

    await expect(conReintento(fn, { intentos: 3, baseMs: 10 })).rejects.toBe(abortError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("agota los intentos y devuelve/lanza el último error de red si nunca se recupera", async () => {
    const errorDeRed = new TypeError("Failed to fetch");
    const fn = vi.fn().mockRejectedValue(errorDeRed);

    const promesa = conReintento(fn, { intentos: 3, baseMs: 10 });
    // Adjuntar el manejador de rechazo ANTES de avanzar timers, para que
    // vitest no marque la promesa como "unhandled rejection" en el ínterin.
    const expectacion = expect(promesa).rejects.toBe(errorDeRed);

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);

    await expectacion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("invoca onReintento en cada reintento con el número de intento y el error", async () => {
    const errorDeRed = { message: "network timeout" };
    const fn = vi.fn()
      .mockResolvedValueOnce({ data: null, error: errorDeRed })
      .mockResolvedValueOnce({ data: "ok", error: null });
    const onReintento = vi.fn();

    const promesa = conReintento(fn, { intentos: 3, baseMs: 10, onReintento });
    await vi.advanceTimersByTimeAsync(10);
    await promesa;

    expect(onReintento).toHaveBeenCalledTimes(1);
    expect(onReintento).toHaveBeenCalledWith({ intento: 1, err: errorDeRed });
  });
});
