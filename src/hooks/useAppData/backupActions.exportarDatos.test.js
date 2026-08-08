// @vitest-environment jsdom
// =====================================================================
// backupActions.exportarDatos.test.js — PERM-6 (auditoría 8 ago 2026):
//
// puedeHacerBackup solo gateaba el botón en la UI; exportarDatos() hacía
// 4 consultas directas del cliente sin ningún chequeo server-side del
// permiso -- cualquier usuario con lectura normal a esas tablas podía
// exportar el mismo dataset sin tenerlo. Se reemplazaron las 4 consultas
// por un solo RPC (exportar_backup_completo, 0076) que revisa el permiso
// antes de devolver nada.
//
// De paso mantiene la cobertura de PERM-7 (backup incompleto en
// silencio): ahora la responsabilidad de no devolver `asistencias: []`
// en silencio recae en el RPC del backend (no testeable acá sin DB real),
// pero el frontend sigue debiendo mostrar un error visible y NO descargar
// nada si el RPC devuelve un error -- eso sí se cubre acá.
// =====================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBackupActions } from "./backupActions";

vi.mock("../../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("../../utils/cache", () => ({ limpiarCache: vi.fn() }));
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { supabase } from "../../lib/supabase";

function makeDeps(overrides = {}) {
  return {
    lapso: "2026-1", selectedPrograma: "todos", showToast: vi.fn(),
    openConfirm: vi.fn(), closeConfirm: vi.fn(), setLoading: vi.fn(),
    fetchHorarios: vi.fn(), fetchProgramas: vi.fn(),
    fetchDocenteNames: vi.fn(), fetchMateriaNames: vi.fn(),
    logAudit: vi.fn(), sedeActiva: "cabimas",
    ...overrides,
  };
}

// jsdom no implementa URL.createObjectURL/revokeObjectURL de forma nativa
// (a diferencia de un navegador real) — hay que definirlos antes de poder
// espiarlos con vi.spyOn.
if (typeof URL.createObjectURL !== "function") URL.createObjectURL = () => "blob:mock-url";
if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};

// Espía document.createElement("a") sin tocar el resto del DOM real,
// para no descargar un archivo de verdad durante el test.
function espiarDescarga() {
  const clickSpy = vi.fn();
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag) => {
    const el = realCreateElement(tag);
    if (tag === "a") el.click = clickSpy;
    return el;
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return clickSpy;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportarDatos — PERM-6: permiso y datos vía RPC server-side", () => {
  it("llama al RPC con lapso/programa/sede correctos, NO con consultas directas a las tablas", async () => {
    supabase.rpc.mockResolvedValue({
      data: { horarios: [], docentes: [], materias: [], asistencias: [] }, error: null,
    });
    espiarDescarga();

    const { exportarDatos } = createBackupActions(makeDeps({
      lapso: "2026-1", selectedPrograma: "PNF Informática", sedeActiva: "cabimas",
    }));
    await exportarDatos();

    expect(supabase.rpc).toHaveBeenCalledWith("exportar_backup_completo", {
      p_lapso: "2026-1", p_programa: "PNF Informática", p_sede_id: "cabimas",
    });
  });

  it('con selectedPrograma "todos", manda p_programa: null (no la palabra "todos")', async () => {
    supabase.rpc.mockResolvedValue({
      data: { horarios: [], docentes: [], materias: [], asistencias: [] }, error: null,
    });
    espiarDescarga();

    const { exportarDatos } = createBackupActions(makeDeps({ selectedPrograma: "todos" }));
    await exportarDatos();

    expect(supabase.rpc).toHaveBeenCalledWith("exportar_backup_completo",
      expect.objectContaining({ p_programa: null })
    );
  });

  it("arma y descarga el backup con los 4 datasets que devuelve el RPC", async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        horarios: [{ id: "h1" }], docentes: [{ id: "d1" }],
        materias: [{ id: "m1" }], asistencias: [{ id: "a1" }],
      },
      error: null,
    });
    const clickSpy = espiarDescarga();
    const showToast = vi.fn();

    let contenidoCapturado = null;
    const OriginalBlob = global.Blob;
    vi.spyOn(global, "Blob").mockImplementation((parts, opts) => {
      contenidoCapturado = parts[0];
      return new OriginalBlob(parts, opts);
    });

    const { exportarDatos } = createBackupActions(makeDeps({ showToast }));
    await exportarDatos();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("descargado"), "success");
    const backup = JSON.parse(contenidoCapturado);
    expect(backup.asistencias).toEqual([{ id: "a1" }]);
    expect(backup.horarios).toEqual([{ id: "h1" }]);
    expect(backup.asistencias_incluidas).toBe(true);
  });

  it("si el usuario no tiene puedeHacerBackup, el RPC lo rechaza y NO se descarga nada", async () => {
    supabase.rpc.mockResolvedValue({
      data: null, error: { message: "No tienes permiso para exportar un backup." },
    });
    const clickSpy = espiarDescarga();
    const showToast = vi.fn();

    const { exportarDatos } = createBackupActions(makeDeps({ showToast }));
    await exportarDatos();

    expect(clickSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("No tienes permiso"), "error"
    );
  });

  it("si el RPC todavía no existe en la base (migración no aplicada), da un mensaje accionable — sin fallback inseguro", async () => {
    supabase.rpc.mockResolvedValue({
      data: null, error: { code: "PGRST202", message: "Could not find the function" },
    });
    const clickSpy = espiarDescarga();
    const showToast = vi.fn();

    const { exportarDatos } = createBackupActions(makeDeps({ showToast }));
    await exportarDatos();

    // A propósito NO hay fallback a una consulta directa acá (a
    // diferencia de borrar_horarios en clearAllData): ese fallback
    // reabriría el hueco de permiso que este RPC existe para cerrar.
    expect(clickSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("migración pendiente"), "error"
    );
  });

  it("si el RPC falla por otro motivo, NO descarga un backup incompleto", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    const clickSpy = espiarDescarga();
    const showToast = vi.fn();

    const { exportarDatos } = createBackupActions(makeDeps({ showToast }));
    await exportarDatos();

    expect(clickSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Error al generar"), "error");
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("descargado"), "success");
  });
});
