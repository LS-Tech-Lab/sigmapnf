// @vitest-environment jsdom
// =====================================================================
// exportPDF.security.test.js — SEC-25 (CodeQL, 15 de julio): regresión
// para el fix defensivo de `programa` en `exportarPDFDiario`. Hoy ese
// valor solo puede venir de un <select> con opciones fijas
// (DEFAULT_PROGRAMAS, ver ReporteAsistencias/index.jsx), así que no era
// explotable en la práctica — pero si esa restricción cambia alguna vez
// (ej. texto libre), este test evita que la regresión pase
// desapercibida.
// =====================================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import { exportarPDFDiario } from "./exportPDF";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportarPDFDiario — escapa 'programa' (defensa en profundidad)", () => {
  it("nunca escribe el valor de 'programa' sin escapar en el HTML impreso", () => {
    const fakeWin = { document: { write: vi.fn(), close: vi.fn() } };
    vi.spyOn(window, "open").mockReturnValue(fakeWin);

    const payload = "<script>alert('programa')</script>";
    exportarPDFDiario([], "2026-07-15", "DIURNO", payload, []);

    expect(fakeWin.document.write).toHaveBeenCalledTimes(1);
    const html = fakeWin.document.write.mock.calls[0][0];

    expect(html).not.toContain(payload);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert('programa')&lt;/script&gt;");
  });
});
