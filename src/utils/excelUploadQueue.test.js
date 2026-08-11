// =====================================================================
// excelUploadQueue.test.js — OFF-12 (auditoría de estrés operacional,
// 10 de agosto): cobertura de la cola de cargas de Excel interrumpidas
// por un corte de red, mismo criterio que manualAttendanceQueue.test.js.
// =====================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

import {
  encolarCargaExcel,
  obtenerCargasPendientes,
  eliminarCargaPendiente,
  contarCargasPendientes,
  purgarExpiradasExcel,
} from "./excelUploadQueue";

function makeArchivoFalso() {
  // fake-indexeddb persiste Blob/File igual que un navegador real —
  // no hace falta un File real del DOM, un Blob con el mismo contenido
  // alcanza para probar que la cola lo guarda y lo devuelve intacto.
  return new Blob(["contenido de prueba"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function makeCarga(overrides = {}) {
  return {
    file: makeArchivoFalso(),
    fileName: "horarios.xlsx",
    lapso: "2026-1",
    selectedPrograma: "todos",
    sedeActiva: "cabimas",
    ...overrides,
  };
}

describe("excelUploadQueue", () => {
  it("encola una carga de Excel y la recupera con id autoincremental", async () => {
    await encolarCargaExcel(makeCarga());
    const pendientes = await obtenerCargasPendientes();
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].fileName).toBe("horarios.xlsx");
    expect(pendientes[0].lapso).toBe("2026-1");
    expect(pendientes[0].id).toBeDefined();
    expect(pendientes[0].creadoEn).toBeTypeOf("number");
  });

  it("preserva el archivo original (Blob/File) intacto en la cola", async () => {
    await encolarCargaExcel(makeCarga());
    const [pendiente] = await obtenerCargasPendientes();
    expect(pendiente.file).toBeInstanceOf(Blob);
    const texto = await pendiente.file.text();
    expect(texto).toBe("contenido de prueba");
  });

  it("contarCargasPendientes refleja el total encolado", async () => {
    await encolarCargaExcel(makeCarga({ fileName: "a.xlsx" }));
    await encolarCargaExcel(makeCarga({ fileName: "b.xlsx" }));
    expect(await contarCargasPendientes()).toBe(2);
  });

  it("eliminarCargaPendiente borra solo la carga indicada", async () => {
    await encolarCargaExcel(makeCarga({ fileName: "a.xlsx" }));
    await encolarCargaExcel(makeCarga({ fileName: "b.xlsx" }));
    const [primera, segunda] = await obtenerCargasPendientes();

    await eliminarCargaPendiente(primera.id);

    const restantes = await obtenerCargasPendientes();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].id).toBe(segunda.id);
  });

  it("purgarExpiradasExcel elimina solo las cargas con más de 48h", async () => {
    await encolarCargaExcel(makeCarga({ fileName: "vigente.xlsx" }));
    await encolarCargaExcel(makeCarga({ fileName: "vieja.xlsx" }));

    const pendientes = await obtenerCargasPendientes();
    const vieja = pendientes.find(p => p.fileName === "vieja.xlsx");
    // Mismo patrón que manualAttendanceQueue.test.js: se fuerza a mano
    // una fecha de creación de 49h atrás.
    const db = await (await import("./idb")).abrirDBCompartida();
    const tx = db.transaction("cargas_excel_pendientes", "readwrite");
    tx.objectStore("cargas_excel_pendientes").put({
      ...vieja, creadoEn: Date.now() - 49 * 60 * 60 * 1000,
    });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });

    const n = await purgarExpiradasExcel();
    expect(n).toBe(1);

    const restantes = await obtenerCargasPendientes();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].fileName).toBe("vigente.xlsx");
  });

  it("no acumula entre tests (aislamiento de IDBFactory funcionando)", async () => {
    expect(await obtenerCargasPendientes()).toHaveLength(0);
  });
});
