// @vitest-environment jsdom
// =====================================================================
// offlineQueue.test.js — ARCH-4: cobertura de tests para la cola
// offline de asistencias.
//
// offlineQueue.js es la capa de persistencia crítica del módulo QR:
// cuando no hay red, las marcas de asistencia se almacenan aquí y se
// sincronizan al recuperar la conexión. Un bug en esta capa puede:
//   - Perder registros de asistencia que el docente ya marcó
//   - Duplicar sincronizaciones si eliminarPendiente no funciona
//   - Acumular registros expirados indefinidamente si purgarExpirados falla
//   - Reportar conteos incorrectos en el badge de "pendientes"
//
// Estrategia de aislamiento: se crea una IDBFactory nueva antes de cada
// test y se reasigna a global.indexedDB. De esta forma cada test parte
// de una base de datos en memoria completamente vacía sin necesidad de
// llamar a deleteDatabase (cuya promesa puede colgarse en jsdom).
// =====================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

// Re-asignar a globals ANTES de cada test para obtener un IDB limpio
beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

// Importar las funciones bajo test DESPUÉS del beforeEach. Como vitest
// carga el módulo una sola vez, offlineQueue.js llama a abrirDB() en
// tiempo de ejecución (no de importación), por lo que siempre usará el
// global.indexedDB vigente en ese momento.
import {
  encolarAsistencia,
  obtenerPendientes,
  eliminarPendiente,
  contarPendientes,
  purgarExpirados,
} from "./offlineQueue";

// ── Fixture de asistencia ──────────────────────────────────────────
function makeAsistencia(overrides = {}) {
  return {
    qr_session_id: "session-abc-123",
    cedula:        "12345678",
    tipo:          "ENTRADA",
    timestamp:     new Date().toISOString(),
    ...overrides,
  };
}

// ── encolarAsistencia ──────────────────────────────────────────────
describe("encolarAsistencia", () => {
  it("agrega un registro a la cola", async () => {
    await encolarAsistencia(makeAsistencia());
    const pendientes = await obtenerPendientes();
    expect(pendientes).toHaveLength(1);
  });

  it("agrega el campo creadoEn automáticamente", async () => {
    const antes = Date.now();
    await encolarAsistencia(makeAsistencia());
    const [item] = await obtenerPendientes();
    expect(item.creadoEn).toBeGreaterThanOrEqual(antes);
    expect(item.creadoEn).toBeLessThanOrEqual(Date.now());
  });

  it("preserva todos los campos del payload original", async () => {
    const payload = makeAsistencia({ tipo: "SALIDA", cedula: "87654321" });
    await encolarAsistencia(payload);
    const [item] = await obtenerPendientes();
    expect(item.tipo).toBe("SALIDA");
    expect(item.cedula).toBe("87654321");
    expect(item.qr_session_id).toBe("session-abc-123");
  });

  it("puede encolar múltiples registros independientes", async () => {
    await encolarAsistencia(makeAsistencia({ cedula: "111" }));
    await encolarAsistencia(makeAsistencia({ cedula: "222" }));
    await encolarAsistencia(makeAsistencia({ cedula: "333" }));
    const pendientes = await obtenerPendientes();
    expect(pendientes).toHaveLength(3);
    const cedulas = pendientes.map(p => p.cedula);
    expect(cedulas).toContain("111");
    expect(cedulas).toContain("222");
    expect(cedulas).toContain("333");
  });
});

// ── obtenerPendientes ──────────────────────────────────────────────
describe("obtenerPendientes", () => {
  it("devuelve un array vacío cuando la cola está vacía", async () => {
    const result = await obtenerPendientes();
    expect(result).toEqual([]);
  });

  it("devuelve todos los registros encolados", async () => {
    await encolarAsistencia(makeAsistencia({ cedula: "A" }));
    await encolarAsistencia(makeAsistencia({ cedula: "B" }));
    const result = await obtenerPendientes();
    expect(result).toHaveLength(2);
  });

  it("cada registro tiene un id autogenerado", async () => {
    await encolarAsistencia(makeAsistencia());
    const [item] = await obtenerPendientes();
    expect(item.id).toBeDefined();
    expect(typeof item.id).toBe("number");
  });
});

// ── contarPendientes ───────────────────────────────────────────────
describe("contarPendientes", () => {
  it("devuelve 0 cuando la cola está vacía", async () => {
    expect(await contarPendientes()).toBe(0);
  });

  it("devuelve el número exacto de registros encolados", async () => {
    await encolarAsistencia(makeAsistencia());
    await encolarAsistencia(makeAsistencia());
    expect(await contarPendientes()).toBe(2);
  });

  it("se actualiza correctamente al agregar registros sucesivamente", async () => {
    expect(await contarPendientes()).toBe(0);
    await encolarAsistencia(makeAsistencia());
    expect(await contarPendientes()).toBe(1);
    await encolarAsistencia(makeAsistencia());
    expect(await contarPendientes()).toBe(2);
  });
});

// ── eliminarPendiente ──────────────────────────────────────────────
describe("eliminarPendiente", () => {
  it("elimina el registro con el id indicado", async () => {
    await encolarAsistencia(makeAsistencia({ cedula: "BORRAR" }));
    await encolarAsistencia(makeAsistencia({ cedula: "CONSERVAR" }));
    const pendientes = await obtenerPendientes();
    const aEliminar = pendientes.find(p => p.cedula === "BORRAR");

    await eliminarPendiente(aEliminar.id);

    const restantes = await obtenerPendientes();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].cedula).toBe("CONSERVAR");
  });

  it("no lanza error al eliminar un id que no existe", async () => {
    await expect(eliminarPendiente(99999)).resolves.not.toThrow();
  });

  it("deja la cola vacía al eliminar el único registro", async () => {
    await encolarAsistencia(makeAsistencia());
    const [item] = await obtenerPendientes();
    await eliminarPendiente(item.id);
    expect(await contarPendientes()).toBe(0);
  });
});

// ── purgarExpirados ────────────────────────────────────────────────
describe("purgarExpirados", () => {
  const DB_NAME = "sigma_offline";
  const STORE   = "asistencias_pendientes";
  const TTL_MS  = 48 * 60 * 60 * 1000;

  // Helper: insertar un registro con timestamp personalizado directamente en IDB
  async function insertarConTimestamp(cedula, creadoEn) {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e =>
        e.target.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      req.onsuccess = e => {
        const db  = e.target.result;
        const tx  = db.transaction(STORE, "readwrite");
        const add = tx.objectStore(STORE).add({ ...makeAsistencia({ cedula }), creadoEn });
        add.onsuccess = res;
        add.onerror   = rej;
      };
      req.onerror = rej;
    });
  }

  it("devuelve 0 purgados cuando la cola está vacía", async () => {
    expect(await purgarExpirados()).toBe(0);
  });

  it("no purga registros recientes (dentro del TTL de 48 h)", async () => {
    await encolarAsistencia(makeAsistencia());
    const purgados = await purgarExpirados();
    expect(purgados).toBe(0);
    expect(await contarPendientes()).toBe(1);
  });

  it("purga registros cuyo creadoEn supera el TTL de 48 h", async () => {
    await insertarConTimestamp("EXPIRADO", Date.now() - TTL_MS - 1000);
    const purgados = await purgarExpirados();
    expect(purgados).toBe(1);
    expect(await contarPendientes()).toBe(0);
  });

  it("solo purga los registros expirados y conserva los recientes", async () => {
    await insertarConTimestamp("VIEJO",    Date.now() - TTL_MS - 5000);
    await insertarConTimestamp("RECIENTE", Date.now());

    const purgados = await purgarExpirados();
    expect(purgados).toBe(1);

    const restantes = await obtenerPendientes();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].cedula).toBe("RECIENTE");
  });

  it("purga múltiples registros expirados en una sola llamada", async () => {
    await insertarConTimestamp("EXP-1", Date.now() - TTL_MS - 1000);
    await insertarConTimestamp("EXP-2", Date.now() - TTL_MS - 2000);
    await insertarConTimestamp("EXP-3", Date.now() - TTL_MS - 3000);
    await encolarAsistencia(makeAsistencia({ cedula: "VIVO" }));

    const purgados = await purgarExpirados();
    expect(purgados).toBe(3);
    expect(await contarPendientes()).toBe(1);
  });
});
