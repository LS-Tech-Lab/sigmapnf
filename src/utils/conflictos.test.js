// =====================================================================
// conflictos.test.js — Mejora 9: cobertura de tests para detección de
// conflictos de horario
//
// calcularConflictosLocal es el fallback que entra en juego si la RPC
// SQL conflictos_horario_detalle no está disponible. Es lógica
// sensible: un falso negativo deja pasar un conflicto real (un docente
// con dos clases superpuestas) sin que el coordinador lo note; un
// falso positivo genera ruido y desconfianza en la herramienta.
// =====================================================================

import { describe, it, expect } from "vitest";
import { parseRango, solapan, tienenConflicto, calcularConflictosLocal } from "./conflictos";

describe("parseRango", () => {
  it("parsea un rango completo con hora de inicio y fin", () => {
    expect(parseRango("7:00AM - 7:45AM")).toEqual({ inicio: 420, fin: 465 });
  });

  it("usa un bloque de 45 minutos por defecto si no hay hora de fin", () => {
    expect(parseRango("7:00AM")).toEqual({ inicio: 420, fin: 465 });
  });

  it("acepta el guion largo (–) como separador", () => {
    expect(parseRango("7:00AM – 7:45AM")).toEqual({ inicio: 420, fin: 465 });
  });

  it("devuelve null para entrada vacía o nula", () => {
    expect(parseRango("")).toBeNull();
    expect(parseRango(null)).toBeNull();
  });

  it("devuelve null si la hora de inicio no es reconocible (timeToMin devuelve 0)", () => {
    expect(parseRango("formato-invalido")).toBeNull();
  });

  it("si la hora de fin es anterior o igual al inicio, usa 45 minutos por defecto", () => {
    expect(parseRango("7:00AM - 6:00AM")).toEqual({ inicio: 420, fin: 465 });
  });

  it("Fix formato de hora compartido: '3:15-5:30PM' (sin AM/PM en el inicio) se parsea igual que '3:15PM-5:30PM', antes se descartaba como null", () => {
    expect(parseRango("3:15-5:30PM")).toEqual(parseRango("3:15PM-5:30PM"));
    expect(parseRango("3:15-5:30PM")).not.toBeNull();
  });
});

describe("solapan", () => {
  it("detecta solapamiento cuando los rangos se cruzan", () => {
    expect(solapan({ inicio: 420, fin: 465 }, { inicio: 450, fin: 500 })).toBe(true);
  });

  it("no detecta solapamiento cuando los rangos son consecutivos sin cruce", () => {
    expect(solapan({ inicio: 420, fin: 465 }, { inicio: 465, fin: 510 })).toBe(false);
  });

  it("no detecta solapamiento cuando los rangos están completamente separados", () => {
    expect(solapan({ inicio: 420, fin: 465 }, { inicio: 600, fin: 645 })).toBe(false);
  });

  it("detecta solapamiento cuando un rango contiene completamente al otro", () => {
    expect(solapan({ inicio: 420, fin: 600 }, { inicio: 450, fin: 480 })).toBe(true);
  });
});

describe("tienenConflicto", () => {
  it("detecta conflicto entre dos entradas con horas solapadas", () => {
    const a = { hora: "7:00AM - 7:45AM" };
    const b = { hora: "7:30AM - 8:15AM" };
    expect(tienenConflicto(a, b)).toBe(true);
  });

  it("no detecta conflicto entre horas consecutivas", () => {
    const a = { hora: "7:00AM - 7:45AM" };
    const b = { hora: "7:45AM - 8:30AM" };
    expect(tienenConflicto(a, b)).toBe(false);
  });

  it("cae a comparación de texto si alguna hora no es parseable", () => {
    const a = { hora: "Bloque especial" };
    const b = { hora: "Bloque especial" };
    expect(tienenConflicto(a, b)).toBe(true);
  });

  it("no detecta conflicto en textos no parseables distintos", () => {
    const a = { hora: "Bloque A" };
    const b = { hora: "Bloque B" };
    expect(tienenConflicto(a, b)).toBe(false);
  });
});

describe("calcularConflictosLocal", () => {
  it("detecta conflicto cuando el mismo docente tiene horas solapadas el mismo día", () => {
    const data = [
      { clase: "Programación I Prof. Juan Pérez", dia: "LUNES", hora: "7:00AM - 7:45AM" },
      { clase: "Bases de Datos Prof. Juan Pérez",  dia: "LUNES", hora: "7:30AM - 8:15AM" },
    ];
    const conflictos = calcularConflictosLocal(data);
    expect(conflictos).toHaveLength(1);
    expect(conflictos[0].docente).toBe("Juan Pérez");
    expect(conflictos[0].dia).toBe("LUNES");
    expect(conflictos[0].entries).toHaveLength(2);
  });

  it("no detecta conflicto si las clases son en días distintos", () => {
    const data = [
      { clase: "Programación I Prof. Juan Pérez", dia: "LUNES",  hora: "7:00AM - 7:45AM" },
      { clase: "Bases de Datos Prof. Juan Pérez",  dia: "MARTES", hora: "7:00AM - 7:45AM" },
    ];
    expect(calcularConflictosLocal(data)).toHaveLength(0);
  });

  it("no detecta conflicto entre docentes distintos en el mismo horario", () => {
    const data = [
      { clase: "Programación I Prof. Juan Pérez", dia: "LUNES", hora: "7:00AM - 7:45AM" },
      { clase: "Bases de Datos Prof. Ana Gómez",   dia: "LUNES", hora: "7:00AM - 7:45AM" },
    ];
    expect(calcularConflictosLocal(data)).toHaveLength(0);
  });

  it("agrupa en un solo conflicto cuando un docente tiene 3+ clases solapadas el mismo día", () => {
    const data = [
      { clase: "Materia A Prof. Juan Pérez", dia: "LUNES", hora: "7:00AM - 8:00AM" },
      { clase: "Materia B Prof. Juan Pérez", dia: "LUNES", hora: "7:30AM - 8:30AM" },
      { clase: "Materia C Prof. Juan Pérez", dia: "LUNES", hora: "7:45AM - 8:45AM" },
    ];
    const conflictos = calcularConflictosLocal(data);
    expect(conflictos).toHaveLength(1);
    expect(conflictos[0].entries).toHaveLength(3);
  });

  it("ignora registros sin docente reconocible (parseClase no encuentra separador)", () => {
    const data = [
      { clase: "Solo el nombre de la materia sin profesor", dia: "LUNES", hora: "7:00AM" },
      { clase: "Otra materia sin profesor también",          dia: "LUNES", hora: "7:00AM" },
    ];
    expect(calcularConflictosLocal(data)).toHaveLength(0);
  });

  it("devuelve un arreglo vacío para datos vacíos o nulos", () => {
    expect(calcularConflictosLocal([])).toEqual([]);
    expect(calcularConflictosLocal(null)).toEqual([]);
    expect(calcularConflictosLocal(undefined)).toEqual([]);
  });

  it("no marca conflicto cuando un docente tiene una sola clase en el día", () => {
    const data = [
      { clase: "Programación I Prof. Juan Pérez", dia: "LUNES", hora: "7:00AM - 7:45AM" },
    ];
    expect(calcularConflictosLocal(data)).toHaveLength(0);
  });
});
