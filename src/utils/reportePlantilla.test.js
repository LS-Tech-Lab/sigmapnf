// @vitest-environment jsdom
// reportePlantilla.test.js — ADMIN-6 (auditoría 1 ago 2026)
//
// Cobertura del módulo compartido de membrete: escapado de texto libre
// (mismo criterio que SEC-25), fallback campo-por-campo a
// CONFIG_REPORTE_DEFAULT, y defensa en profundidad ante un color_clase
// fuera del enum (no debería poder pasar por el CHECK de la migración
// 0056, pero el módulo no confía ciegamente en eso).
import { describe, it, expect, vi, afterEach } from "vitest";
import { plantillaReporte, abrirVentanaImpresion, CONFIG_REPORTE_DEFAULT } from "./reportePlantilla";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plantillaReporte — fallback a valores por defecto", () => {
  it("sin config, usa CONFIG_REPORTE_DEFAULT completo", () => {
    const html = plantillaReporte({ titulo: "T", subtitulo: "S", seccionesHtml: "<p>x</p>" });
    expect(html).toContain(CONFIG_REPORTE_DEFAULT.nombre_institucion);
    expect(html).toContain(CONFIG_REPORTE_DEFAULT.subtitulo_1);
    expect(html).toContain(CONFIG_REPORTE_DEFAULT.pie_texto);
    expect(html).toContain(`class="${CONFIG_REPORTE_DEFAULT.color_clase}"`);
    // Sin logo_base64 configurado: cae al placeholder de letra, no <img>.
    expect(html).not.toContain("membrete-logo-img");
    expect(html).toContain('class="membrete-logo">U<');
  });

  it("con config parcial (solo nombre_institucion), el resto cae a default campo por campo", () => {
    const html = plantillaReporte({
      config: { nombre_institucion: "Instituto XYZ" },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).toContain("Instituto XYZ");
    expect(html).toContain(CONFIG_REPORTE_DEFAULT.subtitulo_1); // no se perdió por dar solo 1 campo
    expect(html).toContain('class="membrete-logo">I<'); // inicial del nuevo nombre, no "U"
  });
});

describe("plantillaReporte — logo real vs placeholder", () => {
  it("con logo_base64 configurado, renderiza <img>, no el placeholder de letra", () => {
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    const html = plantillaReporte({
      config: { logo_base64: logo },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).toContain(`src="${logo}"`);
    expect(html).toContain("membrete-logo-img");
    expect(html).not.toContain('class="membrete-logo">');
  });
});

describe("plantillaReporte — logo de la coordinación (migración 0092)", () => {
  it("con logo_coordinacion_base64 configurado, renderiza <img> aparte, a la derecha del banner institucional", () => {
    const logoCoordinacion = "data:image/png;base64,iVBORw0KGgoCoord=";
    const html = plantillaReporte({
      config: { logo_coordinacion_base64: logoCoordinacion },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).toContain(`src="${logoCoordinacion}"`);
    expect(html).toContain("membrete-logo-coordinacion-img");
    // Vive dentro de membrete-izq, después de membrete-texto -- a la
    // derecha del banner institucional, no en membrete-der (título/fecha).
    const idxTexto = html.indexOf("membrete-texto");
    const idxCoordinacion = html.indexOf("membrete-logo-coordinacion-img");
    const idxDer = html.indexOf("membrete-der");
    expect(idxTexto).toBeLessThan(idxCoordinacion);
    expect(idxCoordinacion).toBeLessThan(idxDer);
  });

  it("sin logo_coordinacion_base64, no renderiza nada (es opcional, a diferencia del institucional)", () => {
    const html = plantillaReporte({ titulo: "T", subtitulo: "S", seccionesHtml: "" });
    expect(html).not.toContain("membrete-logo-coordinacion-img");
  });

  it("un logo_coordinacion_base64 con formato inesperado igual se interpola dentro de un atributo escapado", () => {
    const html = plantillaReporte({
      config: { logo_coordinacion_base64: 'data:image/png;base64,x" onerror="alert(1)' },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).toContain("&quot;");
    expect(html).not.toContain('x" onerror="alert(1)"');
  });
});

describe("plantillaReporte — logo de UNERMB (migración 0094, reemplaza el nombre en texto)", () => {
  it("con logo_unermb_base64 configurado, renderiza <img> en vez del <h1> de texto", () => {
    const logo = "data:image/png;base64,iVBORw0KGgoUnermb=";
    const html = plantillaReporte({
      config: { nombre_institucion: "UNERMB", logo_unermb_base64: logo },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).toContain(`src="${logo}"`);
    expect(html).toContain("membrete-logo-unermb-img");
    expect(html).not.toContain("<h1>");
  });

  it("sin logo_unermb_base64, cae al <h1> de texto de siempre (compatibilidad hacia atrás)", () => {
    const html = plantillaReporte({
      config: { nombre_institucion: "UNERMB" },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).toContain("<h1>UNERMB</h1>");
    expect(html).not.toContain("membrete-logo-unermb-img");
  });

  it("con logo_unermb_base64 Y nombre_institucion, el logo gana -- no se muestran los dos", () => {
    const logo = "data:image/png;base64,iVBORw0KGgoUnermb=";
    const html = plantillaReporte({
      config: { nombre_institucion: "UNERMB", logo_unermb_base64: logo },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).not.toContain("<h1>UNERMB</h1>");
    expect(html).not.toContain("<h1>");
  });

  it("un logo_unermb_base64 con formato inesperado igual se interpola dentro de un atributo escapado", () => {
    const html = plantillaReporte({
      config: { logo_unermb_base64: 'data:image/png;base64,x" onerror="alert(1)' },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).toContain("&quot;");
    expect(html).not.toContain('x" onerror="alert(1)"');
  });
});

describe("plantillaReporte — los 3 logos comparten la misma proporción (14 ago)", () => {
  it("institucional, coordinación y UNERMB usan la misma regla agrupada de tamaño en reporte-print.css", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "../../public/reporte-print.css");
    const css = fs.readFileSync(cssPath, "utf-8");
    // Las 3 clases deben estar agrupadas bajo el mismo selector combinado
    // (no 3 bloques con los mismos valores repetidos a mano), para que no
    // se puedan desincronizar en un ajuste futuro.
    const reglaAgrupada = /\.membrete-logo-img,\s*\.membrete-logo-coordinacion-img,\s*\.membrete-logo-unermb-img\s*{/;
    expect(css).toMatch(reglaAgrupada);
  });
});

describe("plantillaReporte — nombre_institucion vacío (14 ago: el admin debe poder borrarlo)", () => {
  it("con nombre_institucion vacío, no imprime un <h1> vacío", () => {
    const html = plantillaReporte({
      config: { nombre_institucion: "" },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).not.toContain("<h1>");
  });

  it("con nombre_institucion configurado, sí imprime el <h1>", () => {
    const html = plantillaReporte({
      config: { nombre_institucion: "UNERMB" },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).toContain("<h1>UNERMB</h1>");
  });

  it("subtitulo_1/2 vacíos tampoco imprimen <p> vacíos", () => {
    const html = plantillaReporte({
      config: { nombre_institucion: "", subtitulo_1: "", subtitulo_2: "" },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).not.toContain("<p></p>");
  });
});

describe("plantillaReporte — color_clase fuera del enum (defensa en profundidad)", () => {
  it("un color_clase desconocido cae al default en vez de emitirse tal cual en el HTML", () => {
    const html = plantillaReporte({
      config: { color_clase: "rp-color--noexiste" },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).not.toContain("rp-color--noexiste");
    expect(html).toContain(`class="${CONFIG_REPORTE_DEFAULT.color_clase}"`);
  });
});

describe("plantillaReporte — escapado de texto libre (mismo criterio que SEC-25)", () => {
  it("escapa nombre_institucion, subtítulos, pie_texto y firma_label maliciosos", () => {
    const payload = (n) => `<script>alert(${n})</script>`;
    const html = plantillaReporte({
      config: {
        nombre_institucion: payload(1),
        subtitulo_1: payload(2),
        subtitulo_2: payload(3),
        pie_texto: payload(4),
        firma_label: payload(5),
      },
      titulo: payload(6),
      subtitulo: payload(7),
      seccionesHtml: "<p>contenido real, no se toca</p>",
    });

    for (let n = 1; n <= 7; n++) {
      expect(html).not.toContain(payload(n));
    }
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // El contenido específico del reporte (armado por el caller, ya
    // escapado ahí si corresponde) no se re-escapa ni se toca.
    expect(html).toContain("<p>contenido real, no se toca</p>");
  });

  it("un logo_base64 con formato inesperado igual se interpola dentro de un atributo escapado", () => {
    // No debería llegar acá dado el CHECK de la migración 0056, pero si
    // algo raro llegara, ESC() sobre el propio valor evita que un
    // atributo malicioso rompa fuera de las comillas del src.
    const html = plantillaReporte({
      config: { logo_base64: 'data:image/png;base64,x" onerror="alert(1)' },
      titulo: "T", subtitulo: "S", seccionesHtml: "",
    });
    expect(html).not.toContain('" onerror="alert(1)');
    expect(html).toContain("&quot;");
  });
});

describe("abrirVentanaImpresion", () => {
  it("escribe el HTML y cierra el documento; con autoPrint, además enfoca e imprime tras el timeout", () => {
    const fakeWin = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWin);
    vi.useFakeTimers();

    const ok = abrirVentanaImpresion("<html></html>", { autoPrint: true });

    expect(ok).toBe(true);
    expect(fakeWin.document.write).toHaveBeenCalledWith("<html></html>");
    expect(fakeWin.document.close).toHaveBeenCalled();
    expect(fakeWin.print).not.toHaveBeenCalled(); // aún no, hasta que corra el timeout

    vi.advanceTimersByTime(400);
    expect(fakeWin.focus).toHaveBeenCalled();
    expect(fakeWin.print).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("sin autoPrint (uso de exportPDF.js), no llama focus/print", () => {
    const fakeWin = { document: { write: vi.fn(), close: vi.fn() } };
    vi.spyOn(window, "open").mockReturnValue(fakeWin);

    abrirVentanaImpresion("<html></html>");

    expect(fakeWin.document.write).toHaveBeenCalled();
  });

  it("si el navegador bloquea la ventana emergente, devuelve false sin lanzar", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(abrirVentanaImpresion("<html></html>")).toBe(false);
  });
});
