import { describe, it, expect } from "vitest";
import { diaSemanaVE } from "./time";

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
