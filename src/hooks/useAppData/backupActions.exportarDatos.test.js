// @vitest-environment jsdom
// =====================================================================
// backupActions.exportarDatos.test.js — PERM-7 (auditoría 8 ago 2026,
// reabre PERM-4):
//
// PERM-4 documentaba `exportarDatos()` como corregido para consultar
// `asistencias_diarias` en vez de una tabla `asistencias` que nunca
// existió en el esquema. El código real seguía apuntando a la tabla
// inexistente, y como ninguna de las 4 consultas revisaba `.error`, todo
// backup exportado quedaba con `asistencias: []` en silencio, igual
// marcado `asistencias_incluidas: true` -- sin ningún aviso visible.
// =====================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBackupActions } from "./backupActions";

vi.mock("../../lib/supabase", () => ({ supabase: { from: vi.fn() } }));
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

// Builder encadenable para supabase.from(tabla).select(...)[.eq(...)],
// resuelve directamente con { data, error } sin pasar por .then thenable
// (exportarDatos usa await Promise.all([...queries]) directo, no
// encadena nada después de select/eq).
function makeQueryMock(response) {
  const q = Promise.resolve(response);
  q.eq = vi.fn(() => q);
  q.select = vi.fn(() => q);
  return q;
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

describe("exportarDatos — PERM-7", () => {
  it("consulta asistencias_diarias, NO la tabla inexistente 'asistencias'", async () => {
    const tablasConsultadas = [];
    supabase.from.mockImplementation((tabla) => {
      tablasConsultadas.push(tabla);
      return makeQueryMock({ data: [], error: null });
    });
    espiarDescarga();

    const { exportarDatos } = createBackupActions(makeDeps());
    await exportarDatos();

    expect(tablasConsultadas).toContain("asistencias_diarias");
    expect(tablasConsultadas).not.toContain("asistencias");
  });

  it("arma el backup con los 4 datasets cuando todas las consultas responden bien", async () => {
    const filasPorTabla = {
      horarios: [{ id: "h1" }],
      docentes: [{ id: "d1" }],
      materias: [{ id: "m1" }],
      asistencias_diarias: [{ id: "a1" }],
    };
    supabase.from.mockImplementation((tabla) =>
      makeQueryMock({ data: filasPorTabla[tabla] || [], error: null })
    );
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
    expect(backup.asistencias_incluidas).toBe(true);
  });

  it("si alguna consulta falla, NO descarga un backup incompleto y avisa con un error claro", async () => {
    supabase.from.mockImplementation((tabla) => {
      if (tabla === "asistencias_diarias") {
        return makeQueryMock({ data: null, error: { message: "relation does not exist" } });
      }
      return makeQueryMock({ data: [], error: null });
    });
    const clickSpy = espiarDescarga();
    const showToast = vi.fn();

    const { exportarDatos } = createBackupActions(makeDeps({ showToast }));
    await exportarDatos();

    // Antes de este fix: el error se descartaba (`.data || []`) y el
    // backup se descargaba igual, marcado como completo pese a faltarle
    // datos enteros. Ahora: ni se descarga, ni se llama a success.
    expect(clickSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("asistencias"), "error");
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("descargado"), "success");
  });

  it("si fallan varias tablas a la vez, las nombra todas en el mismo mensaje", async () => {
    supabase.from.mockImplementation((tabla) => {
      if (tabla === "docentes" || tabla === "materias") {
        return makeQueryMock({ data: null, error: { message: "boom" } });
      }
      return makeQueryMock({ data: [], error: null });
    });
    const showToast = vi.fn();
    espiarDescarga();

    const { exportarDatos } = createBackupActions(makeDeps({ showToast }));
    await exportarDatos();

    const [mensaje] = showToast.mock.calls.find(([, tipo]) => tipo === "error");
    expect(mensaje).toContain("docentes");
    expect(mensaje).toContain("materias");
  });
});
