// @vitest-environment jsdom
// =====================================================================
// manualAttendanceQueue.test.js — OFF-10 (opción C): cobertura de la
// cola de registros manuales, mismo criterio que ARCH-7 aplicó a
// offlineQueue.test.js — esta es la capa de persistencia crítica del
// modo de respaldo cuando ni siquiera hay una sesión QR pre-generada.
// =====================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

import {
  encolarAsistenciaManual,
  obtenerPendientesManuales,
  eliminarPendienteManual,
  contarPendientesManuales,
  purgarExpiradosManuales,
} from "./manualAttendanceQueue";

function makeRegistroManual(overrides = {}) {
  return {
    cedula: "V-12345678",
    nombre: "Docente de Prueba",
    tipo: "ENTRADA",
    turno: "DIURNO",
    programa: null,
    fecha: "2026-08-07",
    sede_id: "cabimas",
    ...overrides,
  };
}

describe("manualAttendanceQueue", () => {
  it("encola un registro manual y lo recupera con id autoincremental", async () => {
    await encolarAsistenciaManual(makeRegistroManual());
    const pendientes = await obtenerPendientesManuales();
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].cedula).toBe("V-12345678");
    expect(pendientes[0].id).toBeDefined();
    expect(pendientes[0].creadoEn).toBeTypeOf("number");
  });

  it("contarPendientesManuales refleja el total encolado", async () => {
    await encolarAsistenciaManual(makeRegistroManual({ cedula: "V-1" }));
    await encolarAsistenciaManual(makeRegistroManual({ cedula: "V-2" }));
    expect(await contarPendientesManuales()).toBe(2);
  });

  it("eliminarPendienteManual borra solo el registro indicado", async () => {
    await encolarAsistenciaManual(makeRegistroManual({ cedula: "V-1" }));
    await encolarAsistenciaManual(makeRegistroManual({ cedula: "V-2" }));
    const [primero, segundo] = await obtenerPendientesManuales();

    await eliminarPendienteManual(primero.id);

    const restantes = await obtenerPendientesManuales();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].id).toBe(segundo.id);
  });

  it("purgarExpiradosManuales elimina solo los registros con más de 48h", async () => {
    await encolarAsistenciaManual(makeRegistroManual({ cedula: "V-vigente" }));
    await encolarAsistenciaManual(makeRegistroManual({ cedula: "V-vieja" }));

    const pendientes = await obtenerPendientesManuales();
    const viejo = pendientes.find(p => p.cedula === "V-vieja");
    // Forzar manualmente una fecha de creación de 49h atrás (el helper
    // no expone un parámetro de fecha — se simula igual que en
    // offlineQueue.test.js para el mismo escenario).
    const db = await (await import("./idb")).abrirDBCompartida();
    const tx = db.transaction("asistencias_manuales_pendientes", "readwrite");
    tx.objectStore("asistencias_manuales_pendientes").put({
      ...viejo, creadoEn: Date.now() - 49 * 60 * 60 * 1000,
    });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });

    const n = await purgarExpiradosManuales();
    expect(n).toBe(1);

    const restantes = await obtenerPendientesManuales();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].cedula).toBe("V-vigente");
  });

  it("no acumula entre tests (aislamiento de IDBFactory funcionando)", async () => {
    expect(await obtenerPendientesManuales()).toHaveLength(0);
  });
});
