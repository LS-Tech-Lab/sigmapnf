// =====================================================================
// errorMessages.test.js — UX-31 / UX-32 (auditoría 6 de agosto)
//
// mensajeAmigable() intercepta un set explícito de mensajes técnicos de
// Postgres y los traduce (trigger de sede, constraint único, foreign key);
// cualquier otro mensaje no cubierto debe pasar sin cambios, para no
// inventar traducciones sobre errores no verificados.
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

  it("traduce una violación de constraint único (UX-32)", () => {
    const error = {
      message: 'duplicate key value violates unique constraint "horarios_pkey"',
    };
    expect(mensajeAmigable(error)).toBe(
      "Ya existe un registro con esos mismos datos. Verifica antes de guardar de nuevo."
    );
  });

  it("traduce una violación de foreign key (UX-32)", () => {
    const error = {
      message:
        'update or delete on table "docentes" violates foreign key constraint "horarios_docente_id_fkey" on table "horarios"',
    };
    expect(mensajeAmigable(error)).toBe(
      "Ese registro está siendo usado por otro dato del sistema y no se puede eliminar todavía."
    );
  });

  it("deja pasar sin cambios un mensaje de error no cubierto por ninguna regla", () => {
    const error = { message: "connection timeout while contacting the database" };
    expect(mensajeAmigable(error)).toBe("connection timeout while contacting the database");
  });

  it("no revienta si el error no trae message", () => {
    expect(mensajeAmigable({})).toBe("");
    expect(mensajeAmigable(null)).toBe("");
  });
});
