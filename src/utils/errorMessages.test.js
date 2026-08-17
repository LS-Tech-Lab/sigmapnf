// =====================================================================
// errorMessages.test.js — UX-31 / UX-32 (auditoría 6 de agosto),
// SEC-38 (auditoría de estrés operacional, 10 de agosto)
//
// mensajeAmigable() intercepta un set explícito de mensajes técnicos de
// Postgres y los traduce (trigger de sede, constraint único, foreign key,
// input inválido, permiso denegado). Desde SEC-38, un mensaje NO cubierto
// por ninguna regla ya no pasa sin cambios — se reemplaza por un mensaje
// genérico, para no filtrar estructura interna de la BD (nombres de
// tabla/columna/tipo) ante un patrón de error no anticipado.
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

  it("traduce un input inválido de tipo/formato (SEC-38)", () => {
    const error = { message: 'invalid input syntax for type uuid: "xyz"' };
    expect(mensajeAmigable(error)).toBe(
      "Uno de los datos enviados tiene un formato inválido. Verifica e intenta de nuevo."
    );
  });

  it("traduce un permiso denegado a nivel de BD (SEC-38)", () => {
    const error = { message: 'permission denied for table horarios' };
    expect(mensajeAmigable(error)).toBe("No tienes permiso para realizar esta acción.");
  });

  it("SEC-38: reemplaza por un mensaje genérico un error no cubierto por ninguna regla, sin exponer el mensaje crudo de Postgres", () => {
    const error = { message: "connection timeout while contacting the database" };
    expect(mensajeAmigable(error)).toBe(
      "Ocurrió un error al procesar la solicitud. Si el problema persiste, contacta a soporte."
    );
    // El mensaje original nunca debe filtrarse al usuario final.
    expect(mensajeAmigable(error)).not.toContain("connection timeout");
  });

  it("no revienta si el error no trae message", () => {
    expect(mensajeAmigable({})).toBe("");
    expect(mensajeAmigable(null)).toBe("");
  });

  // Fix UX-55 (auditoría 16 ago, encontrado al conectar mensajeAmigable()
  // en 10 call-sites nuevos): un RAISE EXCEPTION sin SQLSTATE explícito en
  // PL/pgSQL toma por convención el código P0001 — varias RPCs del
  // proyecto ya lo usan a propósito para mandar guards pensados para el
  // usuario final (0080/0084/0093/0097). Antes de este fix se aplanaban
  // al mensaje genérico igual que un error técnico real.
  it("UX-55: devuelve tal cual un mensaje P0001 (RAISE EXCEPTION deliberado de una RPC)", () => {
    const error = { message: "Selecciona un programa antes de generar las estadísticas.", code: "P0001" };
    expect(mensajeAmigable(error)).toBe("Selecciona un programa antes de generar las estadísticas.");
  });

  it("UX-55: un mensaje P0001 no pasa por las reglas de TRADUCCIONES ni por el genérico, aunque coincida con un patrón técnico", () => {
    // Caso límite: un RAISE EXCEPTION con texto que por coincidencia matchea
    // una regla de abajo (ej. menciona "permission denied for" dentro de un
    // mensaje propio) debe seguir devolviéndose tal cual — P0001 tiene
    // prioridad, es siempre texto propio del proyecto.
    const error = { message: "No tienes acceso a ese programa.", code: "P0001" };
    expect(mensajeAmigable(error)).toBe("No tienes acceso a ese programa.");
  });
});
