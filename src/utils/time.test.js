import { describe, it, expect } from "vitest";
import { diaSemanaVE, partesHoraNormalizadas, timeToMin } from "./time";

describe("diaSemanaVE", () => {
  it("mapea fechas conocidas a su día de la semana en Venezuela", () => {
    // 3 de agosto de 2026 es lunes (verificado contra calendario real)
    expect(diaSemanaVE("2026-08-03")).toBe("LUNES");
    expect(diaSemanaVE("2026-08-04")).toBe("MARTES");
    expect(diaSemanaVE("2026-08-05")).toBe("MIÉRCOLES");
    expect(diaSemanaVE("2026-08-06")).toBe("JUEVES");
    expect(diaSemanaVE("2026-08-07")).toBe("VIERNES");
    expect(diaSemanaVE("2026-08-08")).toBe("SÁBADO");
    expect(diaSemanaVE("2026-08-09")).toBe("DOMINGO");
  });

  it("coincide con el mismo cálculo ISODOW que usa el backend (0064)", () => {
    // EXTRACT(ISODOW FROM date '2026-08-07') = 5 (viernes). Chequeo cruzado
    // manual contra ese mapeo para no divergir silenciosamente del backend.
    expect(diaSemanaVE("2026-08-07")).toBe("VIERNES");
  });

  it("devuelve null para entradas vacías o inválidas, sin lanzar", () => {
    expect(diaSemanaVE("")).toBeNull();
    expect(diaSemanaVE(null)).toBeNull();
    expect(diaSemanaVE(undefined)).toBeNull();
    expect(diaSemanaVE("no-es-una-fecha")).toBeNull();
  });
});

// Regresión: reporte de LS (ago 2026) — bloque fantasma "9:45 PM - 10:30 PM"
// en el turno Diurno, con el header estirado a "7:30 AM - 10:30 PM". Causa
// raíz: 48 registros de PNF Informática (sede Cabimas - Los Laureles, lapso
// 2-2026) con `hora` tipo "9:45 - 12:00 AM" (typo: mediodía tipeado como
// medianoche). El heurístico de meridiano de partesHoraNormalizadas, al ver
// fin="12:00AM" (0 min, menor que cualquier candidato AM), reinterpretaba el
// inicio como PM. Datos ya corregidos en producción (12:00 AM -> 12:00 PM);
// esta suite blinda el parser para que un futuro re-upload con el mismo
// typo no vuelva a corromper la grilla.
describe("partesHoraNormalizadas — typo '12:00 AM' con inicio ambiguo (regresión bloque fantasma Diurno)", () => {
  it("'9:45 - 12:00 AM' se interpreta como '9:45 AM - 12:00 PM', no como PM", () => {
    expect(partesHoraNormalizadas("9:45 - 12:00 AM")).toEqual(["9:45AM", "12:00 PM"]);
  });

  it("'10:30 - 12:00 AM' (el caso reportado) se interpreta como '10:30 AM - 12:00 PM'", () => {
    expect(partesHoraNormalizadas("10:30 - 12:00 AM")).toEqual(["10:30AM", "12:00 PM"]);
  });

  it("'09:00 - 12:00 AM' se interpreta como '9:00 AM - 12:00 PM'", () => {
    const [inicio, fin] = partesHoraNormalizadas("09:00 - 12:00 AM");
    expect(timeToMin(inicio)).toBe(timeToMin("9:00AM"));
    expect(timeToMin(fin)).toBe(timeToMin("12:00PM"));
  });

  it("NO toca rangos con inicio explícito que cruzan medianoche real ('8:00PM - 12:00AM')", () => {
    // Caso legítimo reservado para un futuro turno NOCTURNO — ver
    // cruceMedianocheVE.test.js. Como el inicio YA trae su propio AM/PM,
    // esta rama del blindaje ni siquiera se activa.
    expect(partesHoraNormalizadas("8:00PM - 12:00AM")).toEqual(["8:00PM", "12:00AM"]);
  });

  it("un '12:00 PM' correcto (sin typo) sigue funcionando igual que antes", () => {
    expect(partesHoraNormalizadas("11:15 - 12:00 PM")).toEqual(["11:15AM", "12:00 PM"]);
  });
});
