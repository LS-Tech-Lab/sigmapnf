import { describe, it, expect } from "vitest";
import { restarDias, formatFechaCorta, topN, CHART_COLORS } from "./helpers";

describe("restarDias", () => {
  it("resta días dentro del mismo mes", () => {
    expect(restarDias("2026-08-09", 5)).toBe("2026-08-04");
  });

  it("cruza el límite de mes correctamente (anclado en UTC)", () => {
    expect(restarDias("2026-08-01", 1)).toBe("2026-07-31");
  });

  it("cruza el límite de año correctamente", () => {
    expect(restarDias("2026-01-01", 1)).toBe("2025-12-31");
  });

  it("resta 29 días (rango por defecto del dashboard: últimos 30 días incluyendo hoy)", () => {
    expect(restarDias("2026-08-09", 29)).toBe("2026-07-11");
  });
});

describe("formatFechaCorta", () => {
  it("convierte 'YYYY-MM-DD' a 'DD/MM'", () => {
    expect(formatFechaCorta("2026-08-09")).toBe("09/08");
  });

  it("devuelve cadena vacía si no hay fecha", () => {
    expect(formatFechaCorta(null)).toBe("");
    expect(formatFechaCorta(undefined)).toBe("");
  });
});

describe("topN", () => {
  const filas = [
    { nombre: "Prof. Ana Pérez", dias_asistidos: "5" },
    { nombre: "Prof. Un Nombre Institucional Muy Largo De Verdad", dias_asistidos: "3" },
    { nombre: "Prof. Beto", dias_asistidos: "1" },
  ];

  it("recorta a los primeros n elementos, respetando el orden ya agregado del servidor", () => {
    const r = topN(filas, 2, "dias_asistidos", "nombre");
    expect(r).toHaveLength(2);
    expect(r[0].etiqueta).toBe("Prof. Ana Pérez");
    expect(r[1].etiqueta.startsWith("Prof. Un Nombre")).toBe(true);
  });

  it("convierte el valor numérico agregado a Number (llega como string/bigint del RPC)", () => {
    const r = topN(filas, 3, "dias_asistidos", "nombre");
    expect(r[0].dias_asistidos).toBe(5);
    expect(typeof r[0].dias_asistidos).toBe("number");
  });

  it("trunca etiquetas largas con elipsis para el eje del gráfico de barras", () => {
    const r = topN(filas, 3, "dias_asistidos", "nombre");
    const larga = r.find(x => x.nombre.includes("Institucional"));
    expect(larga.etiqueta.length).toBeLessThanOrEqual(22);
    expect(larga.etiqueta.endsWith("…")).toBe(true);
  });

  it("usa '—' como etiqueta cuando el valor de labelKey es null/undefined (ej. sede_id ausente)", () => {
    const r = topN([{ sede_id: null, dias_asistidos: 2 }], 1, "dias_asistidos", "sede_id");
    expect(r[0].etiqueta).toBe("—");
  });

  it("devuelve arreglo vacío si no hay filas", () => {
    expect(topN([], 5, "dias_asistidos", "nombre")).toEqual([]);
    expect(topN(null, 5, "dias_asistidos", "nombre")).toEqual([]);
  });
});

describe("CHART_COLORS", () => {
  it("expone al menos 4 colores distintos (tendencia + 3 gráficos de barras)", () => {
    expect(CHART_COLORS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(CHART_COLORS).size).toBe(CHART_COLORS.length);
  });
});
