// =====================================================================
// pinOffline.test.js — Fase 2, prioridad 3 (auditoría de cobertura,
// 10 ago 2026): módulo de seguridad (PBKDF2-SHA-256 para el PIN
// offline, más los dos sistemas de lockout en IDB — SEC-6 login
// normal y OFF-6 PIN) sin ningún test pese a ser la única barrera
// contra fuerza bruta que sobrevive a limpiar localStorage o abrir
// una pestaña privada.
//
// Mismo patrón de aislamiento que offlineQueue.test.js: una IDBFactory
// nueva antes de cada test, reasignada a global.indexedDB.
// =====================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

import {
  guardarPinOffline, verificarPinOffline, listarUsuariosOffline,
  eliminarPinOffline, tienePinOffline,
  leerLockoutIDB, registrarIntentoPinFallido, limpiarLockoutIDB,
  leerLoginLockoutIDB, registrarIntentoLoginFallido, limpiarLoginLockoutIDB,
  guardarLockoutIDB, guardarLoginLockoutIDB,
} from "./pinOffline";

const user = { id: "user-1", email: "docente@unermb.edu.ve" };
const profile = { nombre: "Docente X", rol: "auxiliar", programa: "INFORMATICA", activo: true, rol_info: { nombre: "auxiliar" } };

describe("guardarPinOffline / verificarPinOffline — round trip PBKDF2", () => {
  it("rechaza un PIN con formato inválido (no numérico o fuera de 4-6 dígitos)", async () => {
    await expect(guardarPinOffline(user, profile, "abcd")).rejects.toThrow(/PIN inválido/);
    await expect(guardarPinOffline(user, profile, "123")).rejects.toThrow(/PIN inválido/);
    await expect(guardarPinOffline(user, profile, "1234567")).rejects.toThrow(/PIN inválido/);
  });

  it("acepta 4, 5 y 6 dígitos", async () => {
    await expect(guardarPinOffline(user, profile, "1234")).resolves.not.toThrow();
    await expect(guardarPinOffline(user, profile, "12345")).resolves.not.toThrow();
    await expect(guardarPinOffline(user, profile, "123456")).resolves.not.toThrow();
  });

  it("el PIN correcto devuelve el perfil guardado", async () => {
    await guardarPinOffline(user, profile, "1234");
    const perfil = await verificarPinOffline(user.id, "1234");
    expect(perfil).not.toBeNull();
    expect(perfil.nombre).toBe("Docente X");
    expect(perfil.userId).toBe("user-1");
  });

  it("el PIN incorrecto devuelve null, no el perfil", async () => {
    await guardarPinOffline(user, profile, "1234");
    const perfil = await verificarPinOffline(user.id, "9999");
    expect(perfil).toBeNull();
  });

  it("nunca expone salt ni hash en el perfil devuelto", async () => {
    await guardarPinOffline(user, profile, "1234");
    const perfil = await verificarPinOffline(user.id, "1234");
    expect(perfil.salt).toBeUndefined();
    expect(perfil.hash).toBeUndefined();
  });

  it("un userId sin PIN guardado devuelve null en vez de lanzar", async () => {
    const perfil = await verificarPinOffline("usuario-inexistente", "1234");
    expect(perfil).toBeNull();
  });

  it("guardar de nuevo el PIN de un usuario existente lo reemplaza (mismo userId = misma key)", async () => {
    await guardarPinOffline(user, profile, "1234");
    await guardarPinOffline(user, profile, "5678");

    expect(await verificarPinOffline(user.id, "1234")).toBeNull();
    const perfil = await verificarPinOffline(user.id, "5678");
    expect(perfil).not.toBeNull();
  });
});

describe("listarUsuariosOffline / eliminarPinOffline / tienePinOffline", () => {
  it("devuelve [] cuando no hay ningún PIN guardado", async () => {
    expect(await listarUsuariosOffline()).toEqual([]);
  });

  it("lista los usuarios ordenados por guardadoEn descendente (el más reciente primero)", async () => {
    const userA = { id: "a", email: "a@x.com" };
    const userB = { id: "b", email: "b@x.com" };

    vi.spyOn(Date, "now").mockReturnValueOnce(1000);
    await guardarPinOffline(userA, profile, "1111");
    vi.spyOn(Date, "now").mockReturnValueOnce(2000);
    await guardarPinOffline(userB, profile, "2222");
    Date.now.mockRestore?.();

    const lista = await listarUsuariosOffline();
    expect(lista.map(u => u.userId)).toEqual(["b", "a"]);
  });

  it("nunca incluye salt ni hash en el listado", async () => {
    await guardarPinOffline(user, profile, "1234");
    const lista = await listarUsuariosOffline();
    expect(lista[0].salt).toBeUndefined();
    expect(lista[0].hash).toBeUndefined();
  });

  it("tienePinOffline distingue correctamente entre usuario con y sin PIN", async () => {
    await guardarPinOffline(user, profile, "1234");
    expect(await tienePinOffline(user.id)).toBe(true);
    expect(await tienePinOffline("otro-usuario")).toBe(false);
  });

  it("eliminarPinOffline borra el PIN — verificarPinOffline deja de reconocerlo", async () => {
    await guardarPinOffline(user, profile, "1234");
    await eliminarPinOffline(user.id);
    expect(await tienePinOffline(user.id)).toBe(false);
    expect(await verificarPinOffline(user.id, "1234")).toBeNull();
  });
});

describe("OFF-6 — lockout del PIN offline (5 intentos, 5 minutos)", () => {
  it("arranca en 0 intentos, sin bloqueo", async () => {
    expect(await leerLockoutIDB(user.id)).toEqual({ intentos: 0, bloqueadoHasta: null });
  });

  it("cada intento fallido incrementa el contador sin bloquear todavía", async () => {
    for (let i = 1; i <= 4; i++) {
      const r = await registrarIntentoPinFallido(user.id);
      expect(r.intentos).toBe(i);
      expect(r.bloqueadoAhora).toBe(false);
    }
  });

  it("el 5to intento fallido activa el bloqueo por 5 minutos", async () => {
    for (let i = 0; i < 4; i++) await registrarIntentoPinFallido(user.id);
    const r = await registrarIntentoPinFallido(user.id);
    expect(r.intentos).toBe(5);
    expect(r.bloqueadoAhora).toBe(true);
    expect(r.bloqueadoHasta).toBeGreaterThan(Date.now());
    expect(r.bloqueadoHasta - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000 + 100);
  });

  it("leerLockoutIDB refleja el bloqueo mientras está vigente", async () => {
    for (let i = 0; i < 5; i++) await registrarIntentoPinFallido(user.id);
    const estado = await leerLockoutIDB(user.id);
    expect(estado.intentos).toBe(5);
    expect(estado.bloqueadoHasta).not.toBeNull();
  });

  it("un bloqueo ya vencido se limpia solo al leerlo (no queda bloqueado para siempre)", async () => {
    await guardarLockoutIDB(user.id, 5, Date.now() - 1000); // vencido hace 1s
    const estado = await leerLockoutIDB(user.id);
    expect(estado).toEqual({ intentos: 0, bloqueadoHasta: null });
  });

  it("limpiarLockoutIDB borra el estado tras un PIN correcto", async () => {
    for (let i = 0; i < 5; i++) await registrarIntentoPinFallido(user.id);
    await limpiarLockoutIDB(user.id);
    expect(await leerLockoutIDB(user.id)).toEqual({ intentos: 0, bloqueadoHasta: null });
  });

  it("el lockout es independiente por usuario", async () => {
    await registrarIntentoPinFallido("user-a");
    const estadoB = await leerLockoutIDB("user-b");
    expect(estadoB.intentos).toBe(0);
  });
});

describe("SEC-6 — lockout del login normal (5 intentos, 60 segundos, keyed por email)", () => {
  const email = "docente@unermb.edu.ve";

  it("arranca en 0 intentos, sin bloqueo", async () => {
    expect(await leerLoginLockoutIDB(email)).toEqual({ intentos: 0, bloqueadoHasta: null });
  });

  it("el 5to intento fallido bloquea por 60 segundos", async () => {
    for (let i = 0; i < 4; i++) await registrarIntentoLoginFallido(email);
    const r = await registrarIntentoLoginFallido(email);
    expect(r.intentos).toBe(5);
    expect(r.bloqueadoAhora).toBe(true);
    expect(r.bloqueadoHasta - Date.now()).toBeLessThanOrEqual(60 * 1000 + 100);
  });

  it("un bloqueo vencido se limpia solo al leerlo", async () => {
    await guardarLoginLockoutIDB(email, 5, Date.now() - 1000);
    expect(await leerLoginLockoutIDB(email)).toEqual({ intentos: 0, bloqueadoHasta: null });
  });

  it("limpiarLoginLockoutIDB borra el estado tras un login exitoso", async () => {
    for (let i = 0; i < 5; i++) await registrarIntentoLoginFallido(email);
    await limpiarLoginLockoutIDB(email);
    expect(await leerLoginLockoutIDB(email)).toEqual({ intentos: 0, bloqueadoHasta: null });
  });

  it("el lockout es independiente por email — dos cuentas no se bloquean entre sí", async () => {
    for (let i = 0; i < 5; i++) await registrarIntentoLoginFallido("a@x.com");
    const estadoB = await leerLoginLockoutIDB("b@x.com");
    expect(estadoB.intentos).toBe(0);
  });
});
