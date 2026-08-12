import { describe, it, expect } from "vitest";
import { rangoTrimestre } from "./lapso";

describe("rangoTrimestre (ASIST-4)", () => {
  it("recorta fin a hoy cuando el trimestre sigue en curso (fecha_fin futura)", () => {
    const trimestre = { fecha_inicio: "2026-05-11", fecha_fin: "2026-08-31", estado: "activo" };
    expect(rangoTrimestre(trimestre, "2026-08-12")).toEqual({ inicio: "2026-05-11", fin: "2026-08-12" });
  });

  it("usa el rango completo tal cual para un trimestre cerrado (fecha_fin ya pasó)", () => {
    const trimestre = { fecha_inicio: "2026-05-11", fecha_fin: "2026-07-31", estado: "cerrado" };
    expect(rangoTrimestre(trimestre, "2026-08-12")).toEqual({ inicio: "2026-05-11", fin: "2026-07-31" });
  });

  it("caso real ASIST-1/2: trimestre activo cuya fecha_inicio todavía no llegó -- no invierte el rango", () => {
    // Datos de prueba reales (12 ago 2026): trimestre "3-2026" ya está
    // marcado 'activo' pero fecha_inicio (28-sep) es futura respecto a
    // hoy -- sin el clamp, fin (=hoy, recortado) quedaría antes que
    // inicio, un rango inválido para cualquier query de fecha.
    const trimestre = { fecha_inicio: "2026-09-28", fecha_fin: "2026-12-11", estado: "activo" };
    expect(rangoTrimestre(trimestre, "2026-08-12")).toEqual({ inicio: "2026-09-28", fin: "2026-09-28" });
  });

  it("devuelve null si el trimestre no trae fechas (fallback heurístico sin fila real)", () => {
    expect(rangoTrimestre({ fecha_inicio: null, fecha_fin: null }, "2026-08-12")).toBeNull();
    expect(rangoTrimestre(null, "2026-08-12")).toBeNull();
  });
});
