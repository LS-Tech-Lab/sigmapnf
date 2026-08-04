// @vitest-environment jsdom
// =====================================================================
// excelParser.test.js — Mejora 9: cobertura de tests para el parser

// =====================================================================
// excelParser.test.js — Mejora 9: cobertura de tests para el parser
// de Excel
//
// excelParser.js es la pieza más frágil del sistema: cualquier cambio
// en el formato de la plantilla institucional (orden de columnas,
// texto de etiquetas, celdas mergeadas) puede romper la importación
// de forma silenciosa. Estos tests fijan el comportamiento esperado
// contra fixtures construidos con la librería xlsx real, para detectar
// regresiones de formato antes de que lleguen a producción.
//
// Estrategia: en lugar de mockear XLSX, se construyen workbooks reales
// en memoria con XLSX.utils.aoa_to_sheet (array de arrays → hoja) y se
// envuelven en un objeto File de jsdom, exactamente como llegaría desde
// un <input type="file">. Esto prueba el camino completo: File →
// FileReader → XLSX.read → parseo de filas.


import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseExcelFile, TEMPLATE_VERSION } from "./excelParser";

function construirArchivoExcel(aoa, merges = [], sheetName = "SEC11") {
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  if (merges.length > 0) {
    worksheet["!merges"] = merges.map(({ s, e }) => ({
      s: { r: s[0], c: s[1] },
      e: { r: e[0], c: e[1] },
    }));
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const binaryStr = XLSX.write(workbook, { type: "binary", bookType: "xlsx" });
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i) & 0xff;

  return new File([bytes], "horarios.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function plantillaBasica() {
  return [
    ["PROGRAMA", "Informática"],
    ["TRAYECTO", "2-1"],
    ["Sede:", "Sede Central"],
    ["AULA", "Lab 3"],
    ["Sección", "A", "01"],
    ["Turno", "Diurno"],
    ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
    ["7:00AM - 7:45AM", "Programación I Prof. Juan Pérez", "", "", "", ""],
  ];
}

describe("TEMPLATE_VERSION", () => {
  it("expone una versión de plantilla numérica", () => {
    expect(typeof TEMPLATE_VERSION).toBe("number");
  });
});

describe("parseExcelFile — caso básico", () => {
  it("parsea una hoja válida y extrae la fila de clase", async () => {
    const file = construirArchivoExcel(plantillaBasica());
    const { rows, rechazadas, advertencias } = await parseExcelFile(file, {
      lapso: "1-2026",
      selectedPrograma: "todos",
    });

    expect(rechazadas).toHaveLength(0);
    expect(advertencias).toHaveLength(0);
    expect(rows).toHaveLength(1);

    const fila = rows[0];
    expect(fila.dia).toBe("LUNES");
    expect(fila.hora).toBe("7:00AM - 7:45AM");
    expect(fila.clase).toBe("Programación I Prof. Juan Pérez");
    expect(fila.lapso).toBe("1-2026");
    expect(fila.trayecto).toBe("2-1");
    expect(fila.sede).toBe("Sede Central");
    expect(fila.aula).toBe("Lab 3");
  });

  it("asigna lapso null si no se provee", async () => {
    const file = construirArchivoExcel(plantillaBasica());
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows[0].lapso).toBeNull();
  });

  it("respeta selectedPrograma sobre el programa detectado en el Excel", async () => {
    const file = construirArchivoExcel(plantillaBasica());
    const { rows } = await parseExcelFile(file, {
      lapso: "1-2026",
      selectedPrograma: "PNF Contaduría Pública",
    });
    expect(rows[0].programa).toBe("PNF Contaduría Pública");
  });
});

describe("parseExcelFile — múltiples días y celdas vacías", () => {
  it("extrae una fila por cada día que tenga clase, ignorando celdas vacías", async () => {
    const aoa = [
      ["PROGRAMA", "Informática"],
      ["TRAYECTO", "2-1"],
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      [
        "7:00AM - 7:45AM",
        "Programación I Prof. Juan Pérez",
        "",
        "Bases de Datos Prof. Ana Gómez",
        "",
        "",
      ],
    ];
    const file = construirArchivoExcel(aoa);
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });

    expect(rows).toHaveLength(2);
    const dias = rows.map((r) => r.dia).sort();
    expect(dias).toEqual(["LUNES", "MIÉRCOLES"]);
  });

  it("ignora filas de datos completamente vacías", async () => {
    const aoa = [
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "", "", "", "", ""],
      ["7:45AM - 8:30AM", "Programación I Prof. Juan Pérez", "", "", "", ""],
    ];
    const file = construirArchivoExcel(aoa);
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows).toHaveLength(1);
    expect(rows[0].hora).toBe("7:45AM - 8:30AM");
  });
});

describe("parseExcelFile — celdas mergeadas", () => {
  it("calcula el rango horario completo de un bloque mergeado verticalmente", async () => {
    const aoa = [
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Programación I Prof. Juan Pérez", "", "", "", ""],
      ["7:45AM - 8:30AM", "Programación I Prof. Juan Pérez", "", "", "", ""],
    ];
    const merges = [
      { s: [1, 0], e: [2, 0] },
      { s: [1, 1], e: [2, 1] },
    ];
    const file = construirArchivoExcel(aoa, merges);
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });

    expect(rows).toHaveLength(1);
    expect(rows[0].hora).toBe("7:00AM - 8:30AM");
  });

  it("no duplica el bloque mergeado al iterar las filas que abarca", async () => {
    const aoa = [
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Materia Prof. Juan Pérez", "", "", "", ""],
      ["7:45AM - 8:30AM", "Materia Prof. Juan Pérez", "", "", "", ""],
      ["8:30AM - 9:15AM", "Materia Prof. Juan Pérez", "", "", "", ""],
    ];
    const merges = [
      { s: [1, 0], e: [3, 0] },
      { s: [1, 1], e: [3, 1] },
    ];
    const file = construirArchivoExcel(aoa, merges);
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows).toHaveLength(1);
  });
});

describe("parseExcelFile — hojas sin encabezado reconocible", () => {
  it("rechaza una hoja sin la columna HORA y la reporta en advertencias", async () => {
    const aoa = [
      ["Esto", "no", "es", "una", "plantilla", "válida"],
      ["Datos", "sin", "sentido", "", "", ""],
    ];
    const file = construirArchivoExcel(aoa, [], "HOJA_INVALIDA");
    const { rows, rechazadas, advertencias } = await parseExcelFile(file, {
      selectedPrograma: "todos",
    });

    expect(rows).toHaveLength(0);
    expect(rechazadas).toHaveLength(1);
    expect(rechazadas[0].hoja).toBe("HOJA_INVALIDA");
    expect(advertencias.length).toBeGreaterThan(0);
    expect(advertencias[0]).toContain("HOJA_INVALIDA");
  });

  it("rechaza una hoja que tiene HORA pero ningún día reconocible", async () => {
    const aoa = [["HORA", "COLUMNA_RARA", "OTRA_COLUMNA"]];
    const file = construirArchivoExcel(aoa, [], "SIN_DIAS");
    const { rows, rechazadas } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows).toHaveLength(0);
    expect(rechazadas).toHaveLength(1);
  });
});

describe("parseExcelFile — turno", () => {
  // Fix (caso PNF Agroalimentación, turno "MIXTO"): antes, el código
  // adivinado del NOMBRE DE HOJA ("SEC21" → dígito penúltimo '2' →
  // VESPERTINO) ganaba SIEMPRE sobre el metadato de texto TURNO, aunque
  // ese metadato viniera explícito y correcto. Eso funcionaba mientras el
  // nombre de hoja fuera literalmente un código de sección (convención
  // vieja), pero en la plantilla v2 el nombre de hoja es una etiqueta
  // legible como "1-1 (11)" — sus dígitos coinciden por pura casualidad
  // con el patrón y producían un turno equivocado, pisando en silencio
  // el turno real (ej. "MIXTO", que ni siquiera tiene equivalente en el
  // esquema DIURNO/VESPERTINO de códigos). El metadato de texto explícito
  // ahora tiene prioridad; el código de hoja queda como respaldo solo
  // para plantillas viejas que no traen la celda TURNO (ver siguiente
  // test y el describe "caso Agroalimentación" más abajo).
  it("prioriza el metadato de texto TURNO sobre el turno adivinado del nombre de la hoja", async () => {
    const aoa = [
      ["Turno", "Diurno"],
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Materia Prof. Juan Pérez", "", "", "", ""],
    ];
    const file = construirArchivoExcel(aoa, [], "SEC21");
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows[0].turno).toBe("DIURNO");
  });

  it("usa el código de la hoja si no hay metadato de texto TURNO", async () => {
    const aoa = [
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Materia Prof. Juan Pérez", "", "", "", ""],
    ];
    const file = construirArchivoExcel(aoa, [], "SEC21");
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows[0].turno).toBe("VESPERTINO");
  });

  it("usa el metadato de texto si el código de la hoja no aporta turno", async () => {
    const aoa = [
      ["Turno", "Vespertino"],
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Materia Prof. Juan Pérez", "", "", "", ""],
    ];
    const file = construirArchivoExcel(aoa, [], "HOJASINCODIGO");
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows[0].turno).toBe("VESPERTINO");
  });

  // Caso real: plantilla estándar de PNF Agroalimentación (Cabimas). El
  // nombre de hoja "1-1 (11)" es una etiqueta de trayecto-sección legible,
  // NO un código — pero sus dígitos ("1111") coinciden con el patrón de
  // getTurnoByCodigo (penúltimo dígito '1' → DIURNO), igual que el código
  // de SECCIÓN real (4411111, penúltimo dígito también '1'). Sin la
  // prioridad correcta, el turno real "MIXTO" (continuo 7:00am-4:00pm,
  // declarado explícito en la celda TURNO) se perdía y todo terminaba en
  // DIURNO — truncando cualquier clase que cruzara mediodía o cayera de
  // tarde.
  it("caso Agroalimentación: reconoce el turno MIXTO explícito aunque el nombre de hoja y la sección adivinen DIURNO", async () => {
    const aoa = [
      ["PROGRAMA", "PNF EN AGROALIMENTACIÓN", "", "PERIODO", "2-2026"],
      ["TRAYECTO", "1-1", "", "SECCIÓN", "4411111"],
      ["SEDE", "CABIMAS", "", "TURNO", "MIXTO"],
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["11:30 - 12:15 PM", "Química Aplicada\nProf. Lisbeth Brito", "", "", "", ""],
    ];
    const file = construirArchivoExcel(aoa, [], "1-1 (11)");
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows[0].turno).toBe("MIXTO");
  });
});

describe("parseExcelFile — múltiples hojas", () => {
  it("procesa todas las hojas válidas del workbook y acumula sus filas", async () => {
    const worksheet1 = XLSX.utils.aoa_to_sheet([
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Materia A Prof. Juan Pérez", "", "", "", ""],
    ]);
    const worksheet2 = XLSX.utils.aoa_to_sheet([
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Materia B Prof. Ana Gómez", "", "", "", ""],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet1, "SEC11");
    XLSX.utils.book_append_sheet(workbook, worksheet2, "SEC21");

    const binaryStr = XLSX.write(workbook, { type: "binary", bookType: "xlsx" });
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i) & 0xff;
    const file = new File([bytes], "horarios.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sheet).sort()).toEqual(["SEC11", "SEC21"]);
  });
});

describe("parseExcelFile — errores de lectura", () => {
  it("trata bytes corruptos como una hoja no reconocible en lugar de lanzar una excepción no controlada", async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], "corrupto.xlsx");
    const { rows, rechazadas } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows).toHaveLength(0);
    expect(rechazadas.length).toBeGreaterThan(0);
  });

  it("rechaza la promesa si el archivo no se puede leer (error de FileReader)", async () => {
    const originalRead = FileReader.prototype.readAsBinaryString;
    FileReader.prototype.readAsBinaryString = function () {
      this.onerror(new Error("Fallo simulado de lectura"));
    };
    try {
      const file = new File(["contenido"], "horarios.xlsx");
      await expect(parseExcelFile(file, { selectedPrograma: "todos" })).rejects.toThrow(
        "No se pudo leer el archivo."
      );
    } finally {
      FileReader.prototype.readAsBinaryString = originalRead;
    }
  });
});

// =====================================================================
// Tests del formato v2 (nuevo formato unificado)
// =====================================================================

import {
  parseHojaConfiguracion,
  parseHojaDocentes,
  parseHojaMalla,
} from "./excelParser";

// ── Helper: construir workbook con múltiples hojas ───────────────────
function construirWorkbookConHojas(hojas) {
  // hojas: [{ name, aoa }]
  const wb = XLSX.utils.book_new();
  hojas.forEach(({ name, aoa }) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  });
  return wb;
}

function workbookToFile(wb) {
  const bin = XLSX.write(wb, { type: "binary", bookType: "xlsx" });
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return new File([bytes], "test.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ── parseHojaConfiguracion ────────────────────────────────────────────
describe("parseHojaConfiguracion", () => {
  it("extrae sede y programa de la hoja CONFIGURACIÓN", () => {
    const wb = construirWorkbookConHojas([{
      name: "CONFIGURACIÓN",
      aoa: [
        ["Sede:", "Sede Central"],
        ["Programa:", "PNF Educación Especial"],
        ["Trimestre académico:", "II-2026"],
      ],
    }]);
    const cfg = parseHojaConfiguracion(wb);
    expect(cfg.sede).toBe("Sede Central");
    expect(cfg.programa).toBe("PNF Educación Especial");
    expect(cfg.trimestre).toBe("II-2026");
  });

  it("devuelve campos vacíos si la hoja no existe (workbook v1)", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A", "B"]]), "SEC11");
    const cfg = parseHojaConfiguracion(wb);
    expect(cfg.sede).toBe("");
    expect(cfg.programa).toBe("");
  });
});

// ── parseHojaDocentes ─────────────────────────────────────────────────
describe("parseHojaDocentes", () => {
  it("extrae docentes con todos los campos del catálogo", () => {
    const wb = construirWorkbookConHojas([{
      name: "DOCENTES",
      aoa: [
        ["ID", "Apellidos y Nombres", "Cédula", "Teléfono", "Email", "Observaciones"],
        [1, "García Pérez Juan", "V-12345678", "0414-1234567", "juan@mail.com", ""],
        [2, "López María", "V-87654321", "", "", "Activa"],
      ],
    }]);
    const docs = parseHojaDocentes(wb);
    expect(docs).toHaveLength(2);
    expect(docs[0].nombre_raw).toBe("García Pérez Juan");
    expect(docs[0].cedula).toBe("V-12345678");
    expect(docs[0].email).toBe("juan@mail.com");
    expect(docs[1].nombre_raw).toBe("López María");
    expect(docs[1].observaciones).toBe("Activa");
  });

  it("devuelve [] si la hoja DOCENTES no existe (workbook v1)", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A"]]), "SEC11");
    expect(parseHojaDocentes(wb)).toEqual([]);
  });

  it("omite filas sin nombre", () => {
    const wb = construirWorkbookConHojas([{
      name: "DOCENTES",
      aoa: [
        ["ID", "Apellidos y Nombres", "Cédula"],
        [1, "García Juan", "V-111"],
        [2, "", "V-222"],
      ],
    }]);
    expect(parseHojaDocentes(wb)).toHaveLength(1);
  });
});

// ── parseHojaMalla ────────────────────────────────────────────────────
describe("parseHojaMalla", () => {
  it("extrae unidades curriculares con trayecto y código UC", () => {
    const wb = construirWorkbookConHojas([{
      name: "MALLA",
      aoa: [
        ["ID", "Unidad Curricular", "Trayecto", "Código UC", "Horas Semanales", "Unidades de Crédito"],
        [1, "Proyecto I", "1-1", "UC-001", "6", "4"],
        [2, "Matemáticas", "1-2", "UC-002", "4", "3"],
      ],
    }]);
    const mats = parseHojaMalla(wb);
    expect(mats).toHaveLength(2);
    expect(mats[0].nombre_raw).toBe("Proyecto I");
    expect(mats[0].trayecto).toBe("1-1");
    expect(mats[0].codigo_uc).toBe("UC-001");
    expect(mats[1].horas_semanales).toBe("4");
  });

  it("devuelve [] si la hoja MALLA no existe (workbook v1)", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A"]]), "SEC11");
    expect(parseHojaMalla(wb)).toEqual([]);
  });
});

// ── Hojas ignoradas silenciosamente ──────────────────────────────────
describe("parseExcelFile — hojas ignoradas (formato v2)", () => {
  it("no reporta advertencia por DOCENTES, MALLA, INSTRUCCIONES, CONFIGURACIÓN", async () => {
    const hojaHorario = XLSX.utils.aoa_to_sheet([
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Matemáticas Prof. Juan García", "", "", "", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hojaHorario, "SEC11");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "DOCENTES");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "MALLA");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "INSTRUCCIONES");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "CONFIGURACIÓN");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "BASE DIURNO");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "BASE VESP.");

    const file = workbookToFile(wb);
    const { rows, advertencias, rechazadas } = await parseExcelFile(file, { selectedPrograma: "todos" });

    expect(rows).toHaveLength(1);
    expect(rechazadas).toHaveLength(0);
    expect(advertencias).toHaveLength(0);
  });

  it("usa CONFIGURACIÓN como fallback de sede cuando la hoja de horario no la tiene", async () => {
    const hojaHorario = XLSX.utils.aoa_to_sheet([
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Matemáticas Prof. Juan García", "", "", "", ""],
    ]);
    const hojaConfig = XLSX.utils.aoa_to_sheet([
      ["Sede:", "Sede Los Puertos"],
      ["Programa:", "PNF Educación Especial"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hojaHorario, "SEC11");
    XLSX.utils.book_append_sheet(wb, hojaConfig, "CONFIGURACIÓN");

    const file = workbookToFile(wb);
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows[0].sede).toBe("Sede Los Puertos");
  });

  it("acepta etiquetas en mayúsculas (SEDE, SECCIÓN, TURNO) del nuevo formato", async () => {
    const aoa = [
      ["SEDE", "Sede Maracaibo"],
      ["SECCIÓN", "B"],
      ["TURNO", "VESPERTINO"],
      ["HORA", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"],
      ["7:00AM - 7:45AM", "Proyecto I Prof. García", "", "", "", ""],
    ];
    const file = construirArchivoExcel(aoa, [], "SEC21");
    const { rows } = await parseExcelFile(file, { selectedPrograma: "todos" });
    expect(rows[0].sede).toBe("Sede Maracaibo");
    expect(rows[0].seccion).toBe("B");
  });
});

// ── parseClase con catálogo ───────────────────────────────────────────
import { parseClase } from "./parsing";

describe("parseClase — estrategia 2: catálogo de docentes", () => {
  const catalogo = ["ANILETH CALDERA", "GLORIA FALCON", "FRANCISCO VILCHEZ"];

  it("separa materia y docente cuando no hay prefijo Prof pero hay match en catálogo", () => {
    const { materia, docente } = parseClase("PROYECTO II ANILETH CALDERA", catalogo);
    expect(materia).toBe("PROYECTO II");
    expect(docente).toBe("ANILETH CALDERA");
  });

  it("prioriza el separador Prof sobre el catálogo", () => {
    const { materia, docente } = parseClase("Matemáticas Prof. GLORIA FALCON", catalogo);
    expect(materia).toBe("Matemáticas");
    expect(docente).toBe("GLORIA FALCON");
  });

  it("devuelve toda la cadena como materia si no hay Prof ni match en catálogo", () => {
    const { materia, docente } = parseClase("ORIENTACION Y TUTORIA", catalogo);
    expect(materia).toBe("ORIENTACION Y TUTORIA");
    expect(docente).toBe("");
  });

  it("funciona sin catálogo (backward compatible)", () => {
    const { materia, docente } = parseClase("Materia Prof. López");
    expect(materia).toBe("Materia");
    expect(docente).toBe("López");
  });
});
