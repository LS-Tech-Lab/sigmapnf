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
