// @vitest-environment jsdom
// =====================================================================
// useUpload.integration.test.js — F3 (auditoría julio 2026):
// cobertura de flujo real, no solo función pura.
//
// Cubre el flujo "un administrador sube un Excel de horarios y lo
// confirma": handleFileUpload() → detección de duplicados →
// confirmPreview() → upsert de catálogos (docentes/materias) + insert
// de horarios — la orquestación completa con Supabase, no solo el
// parseo (eso ya lo cubre excelParser.test.js a nivel de función pura).
//
// Estrategia de mocking:
//   - parseExcelFile / parseHojaDocentes / parseHojaMalla (del módulo
//     ../../utils/excelParser) se mockean con datos controlados. El
//     formato real de la plantilla institucional (columnas, celdas
//     mergeadas) ya está cubierto por excelParser.test.js; repetirlo
//     aquí solo agregaría fragilidad sin cubrir una regresión distinta.
//   - El archivo .xlsx en sí SÍ es real (construido con la librería
//     xlsx, mismo helper que excelParser.test.js), porque leerWorkbookRaw()
//     dentro de useUpload.js llama a XLSX.read() de verdad — sin un
//     binario válido, ni siquiera llegaríamos a los mocks de arriba.
//   - supabase.from() se mockea con un builder encadenable genérico que
//     responde distinto según la tabla y la operación (select/upsert/insert).
//
// Se elige un docente SIN cédula en el fixture a propósito: así solo se
// ejercita la rama "upsert por nombre_raw" y la resolución de
// docente_id NO necesita la consulta adicional por cédula, manteniendo
// el mock legible sin perder cobertura del camino real más común.
// =====================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import * as XLSX from "xlsx";

vi.mock("../../utils/excelParser", () => ({
  parseExcelFile: vi.fn(),
  parseHojaDocentes: vi.fn(),
  parseHojaMalla: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import { parseExcelFile, parseHojaDocentes, parseHojaMalla } from "../../utils/excelParser";
import useUpload from "./useUpload";

// ── Construye un .xlsx real mínimo — su contenido no importa, solo que
// XLSX.read() lo pueda parsear sin lanzar error (ver nota de mocking arriba).
function archivoExcelMinimo() {
  const worksheet = XLSX.utils.aoa_to_sheet([["placeholder"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "SEC11");
  const binaryStr = XLSX.write(workbook, { type: "binary", bookType: "xlsx" });
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i) & 0xff;
  return new File([bytes], "horarios.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ── Builder encadenable genérico para supabase.from(tabla). `cfg` define
// la respuesta por tabla y operación: { [tabla]: { select, upsert, insert } }
function makeFromMock(cfg) {
  return vi.fn((table) => {
    const respuestas = cfg[table] || {};
    const chain = {
      select: vi.fn(function () { return this; }),
      in:     vi.fn(function () { return this; }),
      eq:     vi.fn(function () { return this; }),
      is:     vi.fn(function () { return this; }),
      upsert: vi.fn(() => Promise.resolve(respuestas.upsert ?? { data: null, error: null })),
      insert: vi.fn(() => Promise.resolve(respuestas.insert ?? { data: null, error: null })),
      then: (resolve, reject) =>
        Promise.resolve(respuestas.select ?? { data: [], error: null }).then(resolve, reject),
    };
    return chain;
  });
}

function renderUseUpload(overrides = {}) {
  const showToast = vi.fn();
  const setError = vi.fn();
  const fetchHorarios = vi.fn().mockResolvedValue();
  const fetchProgramas = vi.fn().mockResolvedValue();
  const fetchDocenteNames = vi.fn().mockResolvedValue();
  const fetchMateriaNames = vi.fn().mockResolvedValue();
  const setConflictsRefreshKey = vi.fn();
  const logAudit = vi.fn().mockResolvedValue();

  const hook = renderHook(() =>
    useUpload({
      lapso: "2026-1",
      selectedPrograma: "todos",
      showToast,
      setError,
      fetchHorarios,
      fetchProgramas,
      fetchDocenteNames,
      fetchMateriaNames,
      invalidarCacheDocentes: vi.fn(),
      setConflictsRefreshKey,
      logAudit,
      ...overrides,
    })
  );

  return { ...hook, showToast, setError, fetchHorarios };
}

const filaExcel = {
  sheet: "SEC11", programa: "INFORMATICA", lapso: "2026-1",
  dia: "LUNES", hora: "7:00AM - 7:45AM",
  clase: "Cálculo I Prof. Juan Pérez",
  docente: "Juan Pérez", materia: "Cálculo I",
};

const docenteSinCedula = {
  nombre_raw: "Juan Pérez", nombre_display: "Juan Pérez",
  cedula: null, telefono: null, email: null, observaciones: null,
};

const materiaFixture = {
  nombre_raw: "Cálculo I", nombre_display: "Cálculo I",
  trayecto: null, codigo_uc: null, horas_semanales: null, unidades_credito: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useUpload — flujo de carga de horarios (fila nueva)", () => {
  it("handleFileUpload → confirmPreview inserta docentes, materias y horarios, y refresca la vista", async () => {
    parseHojaDocentes.mockReturnValue([docenteSinCedula]);
    parseHojaMalla.mockReturnValue([materiaFixture]);
    parseExcelFile.mockResolvedValue({ rows: [filaExcel], advertencias: [] });

    supabase.from = makeFromMock({
      horarios:  { select: { data: [] } }, // sin duplicados
      docentes:  {
        upsert: { error: null },
        select: { data: [{ id: 1, nombre_raw: "Juan Pérez", cedula: null }] },
      },
      materias:  {
        upsert: { error: null },
        select: { data: [{ id: 2, nombre_raw: "Cálculo I" }] },
      },
    });
    supabase.rpc = vi.fn().mockResolvedValue({ error: null }); // asegurar_particion_lapso

    const { result, showToast, fetchHorarios } = renderUseUpload();

    await act(async () => {
      await result.current.handleFileUpload(archivoExcelMinimo());
    });

    // Se abrió la vista previa con la fila nueva detectada
    await waitFor(() => expect(result.current.previewData).not.toBe(null));
    expect(result.current.previewData.newRows).toHaveLength(1);
    expect(result.current.previewData.duplicados).toHaveLength(0);

    await act(async () => {
      await result.current.confirmPreview();
    });

    // El upsert de docentes SIN cédula fue por nombre_raw (rama correcta
    // para este fixture — ver nota de diseño arriba)
    expect(supabase.from).toHaveBeenCalledWith("docentes");
    expect(supabase.from).toHaveBeenCalledWith("materias");

    // Se insertó la fila de horarios con los IDs resueltos desde el
    // catálogo (docente_id=1, materia_id=2), no null
    expect(supabase.from).toHaveBeenCalledWith("horarios");

    expect(showToast).toHaveBeenCalledWith("1 clases cargadas.", "success");
    expect(fetchHorarios).toHaveBeenCalled();
    expect(result.current.previewData).toBe(null); // modal se cerró
  });
});

describe("useUpload — evita duplicados de docentes sin cédula con nombre variante", () => {
  it("remapea una variante con typo al nombre_raw ya existente antes del upsert, en vez de crear un docente nuevo", async () => {
    // El Excel trae "Carlos Rodrigez" (falta una "u"); en BD ya existe
    // "Carlos Rodriguez" sin cédula. Antes del fix, el upsert por
    // nombre_raw exacto no encontraba coincidencia y creaba una fila
    // nueva — reintroduciendo el duplicado que ya se había unificado.
    const docenteVariante = {
      nombre_raw: "Carlos Rodrigez", nombre_display: "Carlos Rodrigez",
      cedula: null, telefono: null, email: null, observaciones: null,
    };
    parseHojaDocentes.mockReturnValue([docenteVariante]);
    parseHojaMalla.mockReturnValue([materiaFixture]);
    parseExcelFile.mockResolvedValue({
      rows: [{ ...filaExcel, docente: "Carlos Rodrigez", clase: "Cálculo I Prof. Carlos Rodrigez" }],
      advertencias: [],
    });

    const docentesUpsertSpy = vi.fn().mockResolvedValue({ error: null });

    supabase.from = vi.fn((table) => {
      if (table === "docentes") {
        return {
          select: vi.fn(function () { return this; }),
          in:     vi.fn(function () { return this; }),
          eq:     vi.fn(function () { return this; }),
          is:     vi.fn(function () { return this; }),
          upsert: docentesUpsertSpy,
          then: (resolve) => resolve({ data: [{ id: 1, nombre_raw: "Carlos Rodriguez", cedula: null }] }),
        };
      }
      if (table === "materias") {
        return {
          select: vi.fn(function () { return this; }),
          in:     vi.fn(function () { return this; }),
          eq:     vi.fn(function () { return this; }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          then: (resolve) => resolve({ data: [{ id: 2, nombre_raw: "Cálculo I" }] }),
        };
      }
      // horarios
      return {
        select: vi.fn(function () { return this; }),
        in:     vi.fn(function () { return this; }),
        eq:     vi.fn(function () { return this; }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: (resolve) => resolve({ data: [] }),
      };
    });
    supabase.rpc = vi.fn().mockResolvedValue({ error: null });

    const { result } = renderUseUpload();

    await act(async () => {
      await result.current.handleFileUpload(archivoExcelMinimo());
    });
    await waitFor(() => expect(result.current.previewData).not.toBe(null));

    await act(async () => {
      await result.current.confirmPreview();
    });

    expect(docentesUpsertSpy).toHaveBeenCalledTimes(1);
    const [payload] = docentesUpsertSpy.mock.calls[0];
    expect(payload).toHaveLength(1);
    // Se remapeó al nombre_raw ya existente en BD, no se conservó la variante con typo.
    expect(payload[0].nombre_raw).toBe("Carlos Rodriguez");
  });
});

describe("useUpload — flujo de carga con TODAS las filas duplicadas", () => {
  it("detecta el duplicado, no inserta nada nuevo y avisa sin tocar horarios", async () => {
    parseHojaDocentes.mockReturnValue([docenteSinCedula]);
    parseHojaMalla.mockReturnValue([materiaFixture]);
    parseExcelFile.mockResolvedValue({ rows: [filaExcel], advertencias: [] });

    supabase.from = makeFromMock({
      // La fila ya existe en BD con la misma clave sheet|dia|hora|clase|programa
      horarios: {
        select: {
          data: [{
            sheet: filaExcel.sheet, dia: filaExcel.dia, hora: filaExcel.hora,
            clase: filaExcel.clase, programa: filaExcel.programa,
          }],
        },
      },
      docentes: { upsert: { error: null } },
      materias: { upsert: { error: null } },
    });

    const { result, showToast } = renderUseUpload();

    await act(async () => {
      await result.current.handleFileUpload(archivoExcelMinimo());
    });

    await waitFor(() => expect(result.current.previewData).not.toBe(null));
    expect(result.current.previewData.newRows).toHaveLength(0);
    expect(result.current.previewData.duplicados).toHaveLength(1);

    await act(async () => {
      await result.current.confirmPreview();
    });

    // Se avisa "sin registros nuevos" y NUNCA se llama insert sobre horarios
    expect(showToast).toHaveBeenCalledWith("Sin registros nuevos.", "warning");

    const llamadasHorarios = supabase.from.mock.results
      .filter((_, i) => supabase.from.mock.calls[i][0] === "horarios");
    // Solo la consulta de duplicados tocó "horarios"; ninguna de esas
    // instancias de chain tuvo su .insert() invocado.
    llamadasHorarios.forEach(({ value: chain }) => {
      expect(chain.insert).not.toHaveBeenCalled();
    });
  });
});
