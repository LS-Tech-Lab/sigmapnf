// =====================================================================
// password.test.js — Fase 2, prioridad 2 (auditoría de cobertura,
// 10 ago 2026): validarPassword (SEC-5) no tenía ningún test pese a
// ser la única puerta de validación de contraseñas en 3 flujos
// distintos (crear usuario, resetear contraseña, cambiar la propia).
// =====================================================================

import { describe, it, expect } from "vitest";
import { validarPassword } from "./password";

describe("validarPassword", () => {
  it("rechaza vacío o undefined", () => {
    expect(validarPassword("")).toMatch(/al menos 10 caracteres/);
    expect(validarPassword(undefined)).toMatch(/al menos 10 caracteres/);
  });

  it("rechaza menos de 10 caracteres", () => {
    expect(validarPassword("Abc12345")).toMatch(/al menos 10 caracteres/);
  });

  it("rechaza sin mayúscula", () => {
    expect(validarPassword("abcdefgh12")).toMatch(/letra mayúscula/);
  });

  it("rechaza sin dígito", () => {
    expect(validarPassword("Abcdefghij")).toMatch(/al menos un número/);
  });

  it("acepta una contraseña que cumple las 3 reglas", () => {
    expect(validarPassword("Abcdefgh12")).toBeNull();
  });

  it("exactamente 10 caracteres es válido (límite inclusivo)", () => {
    const pwd = "Abcdefgh12";
    expect(pwd.length).toBe(10);
    expect(validarPassword(pwd)).toBeNull();
  });

  it("9 caracteres sigue siendo insuficiente (límite exclusivo por abajo)", () => {
    expect(validarPassword("Abcdefg12")).toMatch(/al menos 10 caracteres/);
  });
});
