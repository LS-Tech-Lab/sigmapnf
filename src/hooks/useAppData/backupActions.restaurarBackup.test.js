// @vitest-environment jsdom
// =====================================================================
// backupActions.restaurarBackup.test.js — Fase 2, prioridad 1
// (auditoría de cobertura, 10 ago 2026):
//
// restaurar_backup() era la RPC más crítica sin ningún test: pérdida
// de datos si falla en silencio. Este archivo cubre importarDatos(),
// que es el único punto del frontend que la invoca.
//
// Incluye test de regresión específico para el bug del mismo día: el
// flujo de fallback (cuando restaurar_backup no existe todavía en la
// base, código PGRST202) hacía un upsert directo a asistencias_diarias
// con onConflict "cedula_docente,fecha,tipo" — el mismo mismatch de
// constraint que registrar_asistencia() / registrar_asistencia_manual()
// / restaurar_backup() (RPC). Se corrigió a
// "sede_id,cedula_docente,fecha,tipo" junto con este test.
//
// Nota de mocking: importarDatos() NO es async — llama a openConfirm()
// y retorna de inmediato; todo el trabajo real ocurre dentro del
// callback onConfirm (async), que en la app real corre cuando el
// usuario confirma el modal. openConfirm se mockea para invocar
// onConfirm() automáticamente (como si el usuario ya hubiera
// confirmado) y el test espera explícitamente esa promesa — awaitear
// importarDatos() directamente NO alcanza a esperar el trabajo interno.
// =====================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBackupActions } from "./backupActions";

vi.mock("../../lib/supabase", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));
vi.mock("../../utils/cache", () => ({ limpiarCache: vi.fn() }));
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { supabase } from "../../lib/supabase";

// ── Builder encadenable genérico para supabase.from(tabla), mismo
// patrón que useUpload.integration.test.js.
function makeFromMock(cfg = {}) {
  return vi.fn((table) => {
    const respuestas = cfg[table] || {};
    const chain = {
      eq:      vi.fn(function () { return this; }),
      neq:     vi.fn(function () { return this; }),
      delete:  vi.fn(function () { return this; }),
      upsert:  vi.fn(() => Promise.resolve(respuestas.upsert ?? { data: null, error: null })),
      insert:  vi.fn(() => Promise.resolve(respuestas.insert ?? { data: null, error: null })),
      then: (resolve, reject) =>
        Promise.resolve(respuestas.delete ?? { data: null, error: null }).then(resolve, reject),
    };
    return chain;
  });
}

function makeDeps(overrides = {}) {
  return {
    lapso: "2026-1", selectedPrograma: "todos", showToast: vi.fn(),
    // Auto-confirma (como si el usuario hiciera clic en "Sí, restaurar")
    // y expone la promesa del trabajo real para que el test la espere.
    openConfirm: vi.fn((cfg) => cfg.onConfirm()),
    closeConfirm: vi.fn(), setLoading: vi.fn(),
    fetchHorarios: vi.fn().mockResolvedValue(), fetchProgramas: vi.fn().mockResolvedValue(),
    fetchDocenteNames: vi.fn().mockResolvedValue(), fetchMateriaNames: vi.fn().mockResolvedValue(),
    logAudit: vi.fn(), sedeActiva: "cabimas",
    ...overrides,
  };
}

function backupValido(overrides = {}) {
  return {
    version: "2.0",
    lapso: "2026-1",
    horarios: [{ lapso: "2026-1", programa: "PNF Informática", dia: "LUNES", hora: "8:00-9:00", clase: "Materia X" }],
    docentes: [{ nombre_raw: "Juan Perez" }],
    materias: [{ nombre_raw: "Materia X" }],
    asistencias: [],
    ...overrides,
  };
}

function makeFile(obj) {
  return { text: () => Promise.resolve(JSON.stringify(obj)) };
}

// Dispara importarDatos y espera el trabajo real (dentro de onConfirm).
async function ejecutarImportar(deps, importarDatos, file) {
  importarDatos(file, { setUploading: vi.fn() });
  await deps.openConfirm.mock.results[0].value;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importarDatos — validación de payload antes de llamar a cualquier RPC", () => {
  it("rechaza un backup sin las claves principales, sin llamar al RPC", async () => {
    const deps = makeDeps();
    const { importarDatos } = createBackupActions(deps);
    await ejecutarImportar(deps, importarDatos, makeFile({ version: "2.0" }));
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rechaza una versión de backup incompatible", async () => {
    const deps = makeDeps();
    const { importarDatos } = createBackupActions(deps);
    await ejecutarImportar(deps, importarDatos, makeFile(backupValido({ version: "1.0" })));
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining("no compatible"), "error");
  });

  it("rechaza horarios con tipos de campo incorrectos", async () => {
    const deps = makeDeps();
    const { importarDatos } = createBackupActions(deps);
    await ejecutarImportar(deps, importarDatos, makeFile(
      backupValido({ horarios: [{ lapso: "2026-1", programa: "X", dia: 1, hora: "8:00", clase: "Y" }] })
    ));
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining("tipos de campo"), "error");
  });
});

describe("importarDatos — camino feliz (RPC restaurar_backup disponible)", () => {
  it("llama al RPC con los parámetros correctos, incluida sede_id", async () => {
    supabase.rpc.mockResolvedValue({ data: { horarios_insertados: 1, asistencias_insertadas: 0 }, error: null });
    const deps = makeDeps({ sedeActiva: "cabimas", lapso: "2026-1" });
    const { importarDatos } = createBackupActions(deps);

    await ejecutarImportar(deps, importarDatos, makeFile(backupValido()));

    expect(supabase.rpc).toHaveBeenCalledWith("restaurar_backup", expect.objectContaining({
      p_lapso: "2026-1",
      p_sede_id: "cabimas",
      p_docentes: backupValido().docentes,
      p_materias: backupValido().materias,
    }));
  });

  it("con éxito, refresca horarios/programas/nombres y registra auditoría", async () => {
    supabase.rpc.mockResolvedValue({ data: { horarios_insertados: 3, asistencias_insertadas: 2 }, error: null });
    const deps = makeDeps();
    const { importarDatos } = createBackupActions(deps);

    await ejecutarImportar(deps, importarDatos, makeFile(backupValido()));

    expect(deps.fetchHorarios).toHaveBeenCalled();
    expect(deps.fetchProgramas).toHaveBeenCalled();
    expect(deps.fetchDocenteNames).toHaveBeenCalled();
    expect(deps.fetchMateriaNames).toHaveBeenCalled();
    expect(deps.logAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: "RESTAURAR_BACKUP" }));
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining("restaurado"), "success");
  });

  it("si el RPC falla por un motivo real (no PGRST202), NO cae al fallback inseguro — muestra error", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "permiso denegado" } });
    const deps = makeDeps();
    supabase.from = makeFromMock();
    const { importarDatos } = createBackupActions(deps);

    await ejecutarImportar(deps, importarDatos, makeFile(backupValido()));

    expect(supabase.from).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining("Error al restaurar"), "error");
    expect(deps.fetchHorarios).not.toHaveBeenCalled();
  });
});

describe("importarDatos — fallback multi-llamada (RPC no aplicada todavía, PGRST202)", () => {
  it("usa onConflict correcto (con sede_id) al reinsertar asistencias — regresión del bug 2026-08-10", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const fromMock = makeFromMock();
    supabase.from = fromMock;
    const deps = makeDeps({ sedeActiva: "cabimas" });
    const { importarDatos } = createBackupActions(deps);

    await ejecutarImportar(deps, importarDatos, makeFile(
      backupValido({ asistencias: [{ cedula_docente: "12345678", fecha: "2026-08-01", tipo: "ENTRADA" }] })
    ));

    const idx = fromMock.mock.calls.findIndex(([tabla]) => tabla === "asistencias_diarias");
    expect(idx).toBeGreaterThanOrEqual(0);

    const chainAsistencias = fromMock.mock.results[idx].value;
    expect(chainAsistencias.upsert).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ onConflict: "sede_id,cedula_docente,fecha,tipo" })
    );
  });

  it("usa onConflict sede_id,nombre_raw al reinsertar docentes y materias en el fallback", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find" } });
    const fromMock = makeFromMock();
    supabase.from = fromMock;
    const deps = makeDeps({ sedeActiva: "cabimas" });
    const { importarDatos } = createBackupActions(deps);

    await ejecutarImportar(deps, importarDatos, makeFile(backupValido()));

    // from("docentes")/from("materias") se llama dos veces en el fallback:
    // una para el DELETE previo y otra para el upsert — se toma la última.
    const tablas = fromMock.mock.calls.map(([tabla]) => tabla);
    const idxD = tablas.lastIndexOf("docentes");
    const idxM = tablas.lastIndexOf("materias");
    expect(fromMock.mock.results[idxD].value.upsert).toHaveBeenCalledWith(
      expect.any(Array), expect.objectContaining({ onConflict: "sede_id,nombre_raw" })
    );
    expect(fromMock.mock.results[idxM].value.upsert).toHaveBeenCalledWith(
      expect.any(Array), expect.objectContaining({ onConflict: "sede_id,nombre_raw" })
    );
  });

  it("etiqueta cada docente/materia/asistencia reinsertado con la sede activa", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find" } });
    const fromMock = makeFromMock();
    supabase.from = fromMock;
    const deps = makeDeps({ sedeActiva: "cabimas" });
    const { importarDatos } = createBackupActions(deps);

    await ejecutarImportar(deps, importarDatos, makeFile(
      backupValido({ asistencias: [{ cedula_docente: "1", fecha: "2026-08-01", tipo: "ENTRADA" }] })
    ));

    const idx = fromMock.mock.calls.findIndex(([tabla]) => tabla === "asistencias_diarias");
    const [filas] = fromMock.mock.results[idx].value.upsert.mock.calls[0];
    expect(filas[0].sede_id).toBe("cabimas");
  });
});
