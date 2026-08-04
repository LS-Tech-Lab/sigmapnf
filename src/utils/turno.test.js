// =====================================================================
// turno.test.js — Mejora 9: cobertura para detección de turno
//
// getTurnoByCodigo y normalizeTurno determinan si una hoja del Excel
// corresponde al turno diurno o vespertino. Un error aquí asigna mal
// el turno de secciones completas durante la importación.
// =====================================================================

import { describe, it, expect } from "vitest";
import { getTurnoByCodigo, normalizeTurno, getTurnoFromHora } from "./turno";

describe("getTurnoByCodigo", () => {
  it("detecta DIURNO cuando el penúltimo dígito es 1", () => {
    expect(getTurnoByCodigo("SEC11")).toBe("DIURNO");
  });

  it("detecta VESPERTINO cuando el penúltimo dígito es 2", () => {
    expect(getTurnoByCodigo("SEC21")).toBe("VESPERTINO");
  });

  it("ignora dígitos que no corresponden a la posición penúltima", () => {
    // dígitos extraídos de "SEC202" son "202"; el penúltimo es "0" → null
    expect(getTurnoByCodigo("SEC202")).toBeNull();
  });

  it("devuelve null si el penúltimo dígito no es 1 ni 2", () => {
    expect(getTurnoByCodigo("SEC303")).toBeNull();
  });

  it("devuelve null si no hay suficientes dígitos en el nombre", () => {
    expect(getTurnoByCodigo("SEC1")).toBeNull();
    expect(getTurnoByCodigo("ABC")).toBeNull();
  });

  it("devuelve null para entrada vacía o nula", () => {
    expect(getTurnoByCodigo("")).toBeNull();
    expect(getTurnoByCodigo(null)).toBeNull();
  });
});

describe("normalizeTurno", () => {
  it("normaliza MATUTINO y DIURNO al mismo valor", () => {
    expect(normalizeTurno("MATUTINO")).toBe("DIURNO");
    expect(normalizeTurno("DIURNO")).toBe("DIURNO");
  });

  it("normaliza VESPERTINO (y la variante con error de tipeo histórico)", () => {
    expect(normalizeTurno("VESPERTINO")).toBe("VESPERTINO");
    expect(normalizeTurno("VESPETINO")).toBe("VESPERTINO");
  });

  it("es insensible a mayúsculas/minúsculas y espacios", () => {
    expect(normalizeTurno("  diurno  ")).toBe("DIURNO");
  });

  it("devuelve null para un valor no reconocido", () => {
    expect(normalizeTurno("NOCTURNO")).toBeNull();
  });

  it("devuelve null para entrada vacía o nula", () => {
    expect(normalizeTurno("")).toBeNull();
    expect(normalizeTurno(null)).toBeNull();
  });
});

describe("getTurnoFromHora", () => {
  it("detecta DIURNO para horas dentro del rango matutino", () => {
    expect(getTurnoFromHora("7:00AM-7:45AM")).toBe("DIURNO");
    expect(getTurnoFromHora("12:00PM-12:45PM")).toBe("DIURNO");
  });

  it("detecta VESPERTINO para horas dentro del rango de tarde", () => {
    expect(getTurnoFromHora("1:00PM-1:45PM")).toBe("VESPERTINO");
    expect(getTurnoFromHora("5:30PM-6:15PM")).toBe("VESPERTINO");
  });

  it("devuelve null para horas fuera de ambos rangos", () => {
    expect(getTurnoFromHora("9:00PM-9:45PM")).toBeNull();
  });

  it("devuelve null para entrada vacía", () => {
    expect(getTurnoFromHora("")).toBeNull();
  });
});

// =====================================================================
// Fix (bug reportado por el usuario, encontrado investigando la grilla de
// Horarios): un `hora` con formato compartido "3:15-5:30PM" (sin AM/PM en
// el inicio — atajo común en carga manual, cuando ambas horas caen en el
// mismo AM/PM) hacía que timeToMin(inicio) devolviera 0 en silencio. Ese
// 0 se usaba tal cual en findStartBlock/countBlocks, lo que posicionaba
// la clase en el primer bloque del turno con un span estirado hasta
// cubrir toda la grilla — síntoma real: al mover UNA clase de día, la
// clase siguiente (con este formato) se veía "subir" a ocupar toda la
// columna desde la primera fila, sin que su horario real hubiera
// cambiado.
// =====================================================================
import { findStartBlock } from "./turno";
import { countBlocks, partesHoraNormalizadas } from "./time";
import { BLOQUES_VESPERTINO } from "../constants";

describe("partesHoraNormalizadas — Fix formato de hora compartido", () => {
  it("hereda el AM/PM del final cuando el inicio no trae el suyo propio", () => {
    expect(partesHoraNormalizadas("3:15-5:30PM")).toEqual(["3:15PM", "5:30PM"]);
  });

  it("no toca nada si el inicio ya trae su propio AM/PM", () => {
    expect(partesHoraNormalizadas("3:15PM-5:30PM")).toEqual(["3:15PM", "5:30PM"]);
  });

  it("funciona igual con guion largo (–)", () => {
    expect(partesHoraNormalizadas("3:15–5:30PM")).toEqual(["3:15PM", "5:30PM"]);
  });
});

describe("partesHoraNormalizadas — Fix 2: formato compartido cruzando el mediodía (caso MIXTO)", () => {
  it("'11:30 - 12:15 PM' se lee como 11:30 AM (no 11:30 PM) — bloque MIXTO que cruza el mediodía", () => {
    expect(partesHoraNormalizadas("11:30 - 12:15 PM")).toEqual(["11:30AM", "12:15 PM"]);
  });

  it("'11:30 - 1:45 PM' (clase mergeada que cruza el mediodía) también se lee con inicio AM", () => {
    expect(partesHoraNormalizadas("11:30 - 1:45 PM")).toEqual(["11:30AM", "1:45 PM"]);
  });

  it("sigue funcionando igual que antes para rangos que NO cruzan el mediodía", () => {
    expect(partesHoraNormalizadas("3:15-5:30PM")).toEqual(["3:15PM", "5:30PM"]);
    expect(partesHoraNormalizadas("07:00 - 11:30 AM")).toEqual(["07:00AM", "11:30 AM"]);
  });
});

describe("findStartBlock — Fix formato de hora compartido", () => {
  it("con formato compartido ('3:15-5:30PM'), encuentra el bloque real (3:15), no el bloque 0", () => {
    // BLOQUES_VESPERTINO[3] = 3:15PM-4:00PM
    expect(findStartBlock(BLOQUES_VESPERTINO, "3:15-5:30PM")).toBe(3);
  });

  it("con formato explícito ('3:15PM-5:30PM'), da el mismo resultado que con formato compartido", () => {
    expect(findStartBlock(BLOQUES_VESPERTINO, "3:15PM-5:30PM"))
      .toBe(findStartBlock(BLOQUES_VESPERTINO, "3:15-5:30PM"));
  });
});

describe("countBlocks — Fix formato de hora compartido", () => {
  it("con formato compartido, da 3 bloques (45 min c/u) para 3:15-5:30PM, no 6", () => {
    expect(countBlocks("3:15-5:30PM")).toBe(3);
  });

  it("con formato explícito, da el mismo resultado que con formato compartido", () => {
    expect(countBlocks("3:15PM-5:30PM")).toBe(countBlocks("3:15-5:30PM"));
  });
});

// =====================================================================
// Caso particular PNF Agroalimentación — turno "MIXTO" y grilla dinámica
// =====================================================================
import { normalizeTurno as _normalizeTurno, getTurnoDeRegistro, buildBloquesDinamicos, countBlocksEnBloques } from "./turno";
import { BLOQUES_DIURNO, BLOQUES_MIXTO } from "../constants";

describe("normalizeTurno — turno MIXTO", () => {
  it("reconoce 'MIXTO' (mayúsculas o minúsculas)", () => {
    expect(_normalizeTurno("MIXTO")).toBe("MIXTO");
    expect(_normalizeTurno("mixto")).toBe("MIXTO");
    expect(_normalizeTurno("  Mixto  ")).toBe("MIXTO");
  });
});

describe("getTurnoDeRegistro — respeta MIXTO explícito", () => {
  it("usa d.turno='MIXTO' aunque la hora caiga en el rango típico de DIURNO", () => {
    expect(getTurnoDeRegistro({ turno: "MIXTO", hora: "7:00AM-7:45AM", sheet: "1-1 (11)" })).toBe("MIXTO");
  });

  it("usa d.turno='MIXTO' aunque la hora caiga en el rango típico de VESPERTINO", () => {
    expect(getTurnoDeRegistro({ turno: "MIXTO", hora: "1:45PM-2:30PM", sheet: "1-1 (11)" })).toBe("MIXTO");
  });
});

describe("buildBloquesDinamicos — caso Agroalimentación (bloques irregulares)", () => {
  it("con datos ya alineados a bloquesBase, produce exactamente los mismos límites inicio/fin (sin cambios para programas estándar)", () => {
    const filtered = [
      { turno: "DIURNO", dia: "LUNES", hora: "7:30AM-8:15AM" },
      { turno: "DIURNO", dia: "LUNES", hora: "8:15AM-9:00AM" },
    ];
    const dinamicos = buildBloquesDinamicos(BLOQUES_DIURNO, filtered, "DIURNO");
    // No se compara `.label` (formato cosmético, no se renderiza en TurnoGrid,
    // que arma su propio display a partir de `.inicio`/`.fin`) — solo los
    // límites reales de cada bloque, que son lo que determina la grilla.
    expect(dinamicos.map(b => [b.inicio, b.fin])).toEqual(BLOQUES_DIURNO.map(b => [b.inicio, b.fin]));
  });

  it("agrega un bloque más temprano si la data empieza antes que bloquesBase (Agro arranca 7:00, no 7:30)", () => {
    const filtered = [
      { turno: "MIXTO", dia: "LUNES", hora: "7:00AM-7:45AM" },
    ];
    const dinamicos = buildBloquesDinamicos(BLOQUES_MIXTO, filtered, "MIXTO");
    expect(dinamicos[0]).toEqual({ inicio: "7:00AM", fin: "7:45AM", label: "7:00AM – 7:45AM" });
  });

  it("una clase de varios bloques (ej. Proyecto Formativo 7:00am-11:30am, 4h30) no se trunca: el fin real queda como límite exacto", () => {
    const filtered = [
      { turno: "MIXTO", dia: "LUNES", hora: "7:00AM-11:30AM" },
    ];
    const dinamicos = buildBloquesDinamicos(BLOQUES_MIXTO, filtered, "MIXTO");
    const finesMin = dinamicos.map(b => b.fin);
    expect(finesMin).toContain("11:30AM");
  });

  it("ignora entradas de otro turno al construir los límites", () => {
    const filtered = [
      { turno: "VESPERTINO", dia: "LUNES", hora: "1:00PM-3:15PM" }, // no debería afectar la grilla MIXTO
    ];
    const dinamicos = buildBloquesDinamicos(BLOQUES_MIXTO, filtered, "MIXTO");
    expect(dinamicos.map(b => [b.inicio, b.fin])).toEqual(BLOQUES_MIXTO.map(b => [b.inicio, b.fin]));
  });
});

describe("countBlocksEnBloques — span real sobre bloques dinámicos", () => {
  it("una clase de 2h15 (11:30am-1:45pm, 3 bloques de 45 min) da span=3, no se trunca a 1", () => {
    const filtered = [{ turno: "MIXTO", dia: "LUNES", hora: "11:30AM-1:45PM" }];
    const dinamicos = buildBloquesDinamicos(BLOQUES_MIXTO, filtered, "MIXTO");
    expect(countBlocksEnBloques(dinamicos, "11:30AM-1:45PM")).toBe(3);
  });

  it("una clase de 4h30 (Proyecto Formativo, 07:00-11:30am) da span=6", () => {
    const filtered = [{ turno: "MIXTO", dia: "LUNES", hora: "7:00AM-11:30AM" }];
    const dinamicos = buildBloquesDinamicos(BLOQUES_MIXTO, filtered, "MIXTO");
    expect(countBlocksEnBloques(dinamicos, "7:00AM-11:30AM")).toBe(6);
  });
});
