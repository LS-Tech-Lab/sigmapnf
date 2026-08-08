// @vitest-environment jsdom
// =====================================================================
// qrOfflineCache.test.js — OFF-10 (opción A: pre-generación de sesiones
// QR mientras hay red, para activación local sin RPC durante un corte).
//
// Mismo patrón de aislamiento que offlineQueue.test.js: IDBFactory nueva
// antes de cada test para partir de una base en memoria vacía.
// =====================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

import {
  guardarSesionCacheada,
  buscarSesionCacheada,
  listarSesionesCacheadas,
  purgarSesionesCacheadasVencidas,
  eliminarSesionCacheada,
} from "./qrOfflineCache";

function contextoBase(overrides = {}) {
  return {
    fecha: "2026-08-07",
    turno: "DIURNO",
    programa: null,
    sede_id: "cabimas",
    ...overrides,
  };
}

function futuro(minutos) {
  return new Date(Date.now() + minutos * 60 * 1000).toISOString();
}

describe("qrOfflineCache", () => {
  it("guarda una sesión pre-generada y la encuentra por el mismo contexto", async () => {
    const ctx = contextoBase();
    await guardarSesionCacheada({
      ...ctx, sessionId: "s1", token: "t1", expiresAt: futuro(360),
    });

    const encontrada = await buscarSesionCacheada(ctx);
    expect(encontrada).not.toBeNull();
    expect(encontrada.sessionId).toBe("s1");
    expect(encontrada.token).toBe("t1");
  });

  it("no encuentra la sesión si el contexto no coincide (distinto turno)", async () => {
    const ctx = contextoBase({ turno: "DIURNO" });
    await guardarSesionCacheada({ ...ctx, sessionId: "s1", token: "t1", expiresAt: futuro(360) });

    const encontrada = await buscarSesionCacheada({ ...ctx, turno: "VESPERTINO" });
    expect(encontrada).toBeNull();
  });

  it("no encuentra la sesión si el contexto no coincide (distinta sede)", async () => {
    const ctx = contextoBase({ sede_id: "cabimas" });
    await guardarSesionCacheada({ ...ctx, sessionId: "s1", token: "t1", expiresAt: futuro(360) });

    const encontrada = await buscarSesionCacheada({ ...ctx, sede_id: "santa-barbara" });
    expect(encontrada).toBeNull();
  });

  it("no devuelve una sesión cacheada ya vencida", async () => {
    const ctx = contextoBase();
    await guardarSesionCacheada({ ...ctx, sessionId: "s1", token: "t1", expiresAt: futuro(-5) });

    const encontrada = await buscarSesionCacheada(ctx);
    expect(encontrada).toBeNull();
  });

  it("guardarSesionCacheada reemplaza la entrada previa del mismo contexto (no acumula)", async () => {
    const ctx = contextoBase();
    await guardarSesionCacheada({ ...ctx, sessionId: "viejo", token: "t-viejo", expiresAt: futuro(360) });
    await guardarSesionCacheada({ ...ctx, sessionId: "nuevo", token: "t-nuevo", expiresAt: futuro(360) });

    const encontrada = await buscarSesionCacheada(ctx);
    expect(encontrada.sessionId).toBe("nuevo");

    const todas = await listarSesionesCacheadas(ctx.fecha);
    expect(todas).toHaveLength(1);
  });

  it("listarSesionesCacheadas filtra solo por la fecha pedida", async () => {
    await guardarSesionCacheada({ ...contextoBase({ fecha: "2026-08-07" }), sessionId: "hoy", token: "t1", expiresAt: futuro(360) });
    await guardarSesionCacheada({ ...contextoBase({ fecha: "2026-08-06" }), sessionId: "ayer", token: "t2", expiresAt: futuro(360) });

    const deHoy = await listarSesionesCacheadas("2026-08-07");
    expect(deHoy).toHaveLength(1);
    expect(deHoy[0].sessionId).toBe("hoy");
  });

  it("purgarSesionesCacheadasVencidas elimina solo las expiradas", async () => {
    await guardarSesionCacheada({ ...contextoBase({ turno: "DIURNO" }), sessionId: "vigente", token: "t1", expiresAt: futuro(360) });
    await guardarSesionCacheada({ ...contextoBase({ turno: "VESPERTINO" }), sessionId: "vencida", token: "t2", expiresAt: futuro(-1) });

    const n = await purgarSesionesCacheadasVencidas();
    expect(n).toBe(1);

    const restantes = await listarSesionesCacheadas("2026-08-07");
    expect(restantes).toHaveLength(1);
    expect(restantes[0].sessionId).toBe("vigente");
  });

  it("eliminarSesionCacheada borra por contexto explícito", async () => {
    const ctx = contextoBase();
    await guardarSesionCacheada({ ...ctx, sessionId: "s1", token: "t1", expiresAt: futuro(360) });

    await eliminarSesionCacheada(ctx);

    const encontrada = await buscarSesionCacheada(ctx);
    expect(encontrada).toBeNull();
  });
});
