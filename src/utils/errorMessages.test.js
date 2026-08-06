// =====================================================================
// errorMessages.test.js — UX-31 (auditoría 6 de agosto)
//
// mensajeAmigable() intercepta el mensaje técnico del trigger de sede
// (0063) y lo traduce; cualquier otro mensaje debe pasar sin cambios,
// para no inventar traducciones sobre errores no verificados.
// =====================================================================

import { describe, it, expect } from "vitest";
import { mensajeAmigable } from "./errorMessages";

describe("mensajeAmigable", () => {
  it("traduce el mensaje del trigger autocompletar_sede_id (0063)", () => {
    const error = {
      message:
        "No se pudo determinar la sede para esta fila: tu perfil no tiene una " +
        "sede fija asignada. Si tu rol ve todas las sedes, manda sede_id explícito.",
    };
    expect(mensajeAmigable(error)).toBe(
      "Tu cuenta no tiene una sede asignada todavía. Contacta a un administrador antes de continuar."
    );
  });

  it("deja pasar sin cambios cualquier otro mensaje de error", () => {
    const error = { message: "duplicate key value violates unique constraint" };
    expect(mensajeAmigable(error)).toBe("duplicate key value violates unique constraint");
  });

  it("no revienta si el error no trae message", () => {
    expect(mensajeAmigable({})).toBe("");
    expect(mensajeAmigable(null)).toBe("");
  });
});
