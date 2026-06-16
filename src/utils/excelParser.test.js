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
// =====================================================================

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
  it("prioriza el turno detectado por el código de la hoja sobre el metadato de texto", async () => {
    const aoa = [
      ["Turno", "Diurno"],
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
