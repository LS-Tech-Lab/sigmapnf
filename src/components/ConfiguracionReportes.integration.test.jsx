// @vitest-environment jsdom
// =====================================================================
// ConfiguracionReportes.integration.test.jsx — ADMIN-6 (auditoría 1 ago
// 2026): cobertura de flujo real de la pantalla de personalización de
// reportes — carga desde configuracion_reportes, guardado vía UPDATE +
// logAudit, y las 2 validaciones de logo del lado cliente (tipo/tamaño)
// antes de convertir a base64.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}));

import { supabase } from "../lib/supabase";
import ConfiguracionReportes from "./ConfiguracionReportes";

const FILA_DB = {
  nombre_institucion: "UNERMB",
  subtitulo_1: "Programas Nacionales de Formación",
  subtitulo_2: "Control de Asistencia Docente",
  pie_texto: "Documento generado automáticamente por el sistema SigmaPNF",
  firma_label: "Firma y sello del Coordinador(a)",
  logo_base64: null,
  color_clase: "rp-color--azul",
};

// Builder encadenable + thenable, mismo patrón que el resto de la suite
// (ver ReporteRango.integration.test.jsx).
function makeSelectBuilder(result) {
  const b = {};
  ["select", "eq"].forEach(m => { b[m] = vi.fn(() => b); });
  b.maybeSingle = vi.fn(() => Promise.resolve(result));
  return b;
}
function makeUpdateBuilder(result) {
  const b = {};
  b.update = vi.fn(() => b);
  b.eq = vi.fn(() => Promise.resolve(result));
  return b;
}

function mockCargaOk(fila = FILA_DB) {
  supabase.from.mockImplementation((tabla) => {
    expect(tabla).toBe("configuracion_reportes");
    return makeSelectBuilder({ data: fila, error: null });
  });
}

beforeEach(() => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConfiguracionReportes — carga inicial", () => {
  it("carga la fila real y la muestra en el formulario y la vista previa", async () => {
    mockCargaOk();
    render(<ConfiguracionReportes showToast={vi.fn()} logAudit={vi.fn()} />);

    await waitFor(() => expect(screen.getByDisplayValue("UNERMB")).toBeTruthy());
    expect(screen.getByDisplayValue("Programas Nacionales de Formación")).toBeTruthy();
    // Sin logo configurado: placeholder de letra "U", no <img>.
    expect(screen.queryByAltText("Logo actual")).toBeNull();
  });

  it("si falla la carga, muestra el error sin romper la pantalla (se queda en los valores por defecto)", async () => {
    supabase.from.mockImplementation(() => makeSelectBuilder({ data: null, error: { message: "Error de red." } }));
    render(<ConfiguracionReportes showToast={vi.fn()} logAudit={vi.fn()} />);

    await waitFor(() => screen.getByText("Error de red."));
    // Sigue mostrando el default, la pantalla no queda en blanco.
    expect(screen.getByDisplayValue("UNERMB")).toBeTruthy();
  });
});

describe("ConfiguracionReportes — guardar cambios", () => {
  it("el botón Guardar está deshabilitado sin cambios, y se habilita al editar un campo", async () => {
    mockCargaOk();
    render(<ConfiguracionReportes showToast={vi.fn()} logAudit={vi.fn()} />);
    await waitFor(() => screen.getByDisplayValue("UNERMB"));

    expect(screen.getByText("Guardar cambios").closest("button").disabled).toBe(true);

    fireEvent.change(screen.getByDisplayValue("UNERMB"), { target: { value: "Instituto XYZ" } });
    expect(screen.getByText("Guardar cambios").closest("button").disabled).toBe(false);
  });

  it("guardar hace UPDATE sobre id=1, registra auditoría y avisa por toast", async () => {
    const updateBuilder = makeUpdateBuilder({ data: null, error: null });
    supabase.from.mockImplementation((tabla) => {
      expect(tabla).toBe("configuracion_reportes");
      return { ...makeSelectBuilder({ data: FILA_DB, error: null }), ...updateBuilder };
    });

    const showToast = vi.fn();
    const logAudit = vi.fn();
    render(<ConfiguracionReportes showToast={showToast} logAudit={logAudit} />);
    await waitFor(() => screen.getByDisplayValue("UNERMB"));

    fireEvent.change(screen.getByDisplayValue("UNERMB"), { target: { value: "Instituto XYZ" } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => expect(updateBuilder.update).toHaveBeenCalled());
    const payload = updateBuilder.update.mock.calls[0][0];
    expect(payload.nombre_institucion).toBe("Instituto XYZ");
    expect(payload.updated_by).toBe("admin-1");
    expect(updateBuilder.eq).toHaveBeenCalledWith("id", 1);

    await waitFor(() => expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: "CONFIGURAR_REPORTES" })));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Configuración de reportes guardada.", "success"));
  });

  it("descartar cambios restaura el valor original sin llamar a Supabase", async () => {
    mockCargaOk();
    render(<ConfiguracionReportes showToast={vi.fn()} logAudit={vi.fn()} />);
    await waitFor(() => screen.getByDisplayValue("UNERMB"));

    fireEvent.change(screen.getByDisplayValue("UNERMB"), { target: { value: "Otro nombre" } });
    fireEvent.click(screen.getByText("Descartar cambios"));

    expect(screen.getByDisplayValue("UNERMB")).toBeTruthy();
    expect(screen.getByText("Guardar cambios").closest("button").disabled).toBe(true);
  });
});

describe("ConfiguracionReportes — validación de logo del lado cliente", () => {
  it("rechaza un archivo con tipo no soportado (ej. SVG) sin tocar el estado", async () => {
    mockCargaOk();
    const showToast = vi.fn();
    render(<ConfiguracionReportes showToast={showToast} logAudit={vi.fn()} />);
    await waitFor(() => screen.getByDisplayValue("UNERMB"));

    const input = screen.getByLabelText("Subir logo institucional");
    const archivo = new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(input, { target: { files: [archivo] } });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Formato no soportado"), "error"));
    expect(screen.getByText("Guardar cambios").closest("button").disabled).toBe(true); // no se marcó como "hay cambios"
  });

  it("rechaza un archivo que excede el tamaño máximo", async () => {
    mockCargaOk();
    const showToast = vi.fn();
    render(<ConfiguracionReportes showToast={showToast} logAudit={vi.fn()} />);
    await waitFor(() => screen.getByDisplayValue("UNERMB"));

    const input = screen.getByLabelText("Subir logo institucional");
    const grande = new File([new Uint8Array(1_600_000)], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [grande] } });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining("1.5 MB"), "error"));
  });

  it("acepta un PNG válido, lo convierte a base64 y lo muestra en el preview", async () => {
    mockCargaOk();
    render(<ConfiguracionReportes showToast={vi.fn()} logAudit={vi.fn()} />);
    await waitFor(() => screen.getByDisplayValue("UNERMB"));

    const input = screen.getByLabelText("Subir logo institucional");
    const archivo = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [archivo] } });

    await waitFor(() => expect(screen.getByAltText("Logo actual")).toBeTruthy());
    const src = screen.getByAltText("Logo actual").getAttribute("src");
    expect(src.startsWith("data:image/png;base64,")).toBe(true);
    // "Quitar" aparece una vez hay logo, y el botón de guardar ya no está disabled
    expect(screen.getByText("Quitar")).toBeTruthy();
    expect(screen.getByText("Guardar cambios").closest("button").disabled).toBe(false);
  });
});

describe("ConfiguracionReportes — selección de color institucional", () => {
  it("elegir un swatch de color lo marca como activo y habilita Guardar", async () => {
    mockCargaOk();
    render(<ConfiguracionReportes showToast={vi.fn()} logAudit={vi.fn()} />);
    await waitFor(() => screen.getByDisplayValue("UNERMB"));

    const swatchVerde = screen.getByLabelText("Verde");
    fireEvent.click(swatchVerde);

    expect(swatchVerde.className).toContain("cr-color-swatch--active");
    expect(screen.getByText("Guardar cambios").closest("button").disabled).toBe(false);
  });
});
