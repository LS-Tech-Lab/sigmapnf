// @vitest-environment jsdom
// =====================================================================
// cedula.test.js — UX-33 (auditoría 7 ago 2026):
//
// Cubre los helpers de borrador (leerBorrador/guardarBorrador/borrarBorrador)
// que persisten lo que el docente primerizo va tecleando en el formulario,
// separados de LS_KEY (identidad ya confirmada por un registro exitoso).
// Ver DocenteScan/index.jsx para el flujo completo end-to-end.
// =====================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  LS_KEY, LS_KEY_BORRADOR, LS_BORRADOR_TTL_MIN,
  leerBorrador, guardarBorrador, borrarBorrador,
} from "./cedula";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("guardarBorrador / leerBorrador", () => {
  it("guarda y recupera cédula y nombre tecleados", () => {
    guardarBorrador("12345678", "Prof. Ana Pérez");
    const borrador = leerBorrador();
    expect(borrador.cedula).toBe("12345678");
    expect(borrador.nombre).toBe("Prof. Ana Pérez");
  });

  it("no persiste nada si ambos campos están vacíos", () => {
    guardarBorrador("", "");
    expect(localStorage.getItem(LS_KEY_BORRADOR)).toBeNull();
    expect(leerBorrador()).toBeNull();
  });

  it("usa una clave distinta a LS_KEY (identidad confirmada)", () => {
    guardarBorrador("12345678", "Prof. Ana Pérez");
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(localStorage.getItem(LS_KEY_BORRADOR)).not.toBeNull();
  });

  it("no devuelve un borrador vencido (TTL superado)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T10:00:00"));
    guardarBorrador("12345678", "Prof. Ana Pérez");

    vi.setSystemTime(new Date(
      new Date("2026-08-07T10:00:00").getTime() + (LS_BORRADOR_TTL_MIN + 1) * 60000
    ));
    expect(leerBorrador()).toBeNull();
    // Efecto colateral esperado: el TTL vencido se limpia solo, para no
    // quedar reintentando leer un JSON viejo en cada mount.
    expect(localStorage.getItem(LS_KEY_BORRADOR)).toBeNull();
  });

  it("sí devuelve un borrador dentro del TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T10:00:00"));
    guardarBorrador("12345678", "Prof. Ana Pérez");

    vi.setSystemTime(new Date(
      new Date("2026-08-07T10:00:00").getTime() + (LS_BORRADOR_TTL_MIN - 1) * 60000
    ));
    expect(leerBorrador()).not.toBeNull();
  });

  it("no lanza si el JSON guardado está corrupto", () => {
    localStorage.setItem(LS_KEY_BORRADOR, "{esto no es json");
    expect(() => leerBorrador()).not.toThrow();
    expect(leerBorrador()).toBeNull();
  });
});

describe("borrarBorrador", () => {
  it("elimina el borrador guardado", () => {
    guardarBorrador("12345678", "Prof. Ana Pérez");
    expect(leerBorrador()).not.toBeNull();
    borrarBorrador();
    expect(leerBorrador()).toBeNull();
  });

  it("no lanza si no había nada que borrar", () => {
    expect(() => borrarBorrador()).not.toThrow();
  });
});
