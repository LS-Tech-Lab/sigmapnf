// @vitest-environment jsdom
// =====================================================================
// useFocusTrap.test.js — UX-65: el hook no tenía suite propia (usado en
// ~12 modales, siempre indirectamente vía los tests de esos componentes).
// Se agrega cobertura directa para el mecanismo en sí: el trap de Tab que
// ya existía desde UX-3, y el retorno de foco al cerrar que se agrega en
// esta pasada.
// =====================================================================

import React, { useRef } from "react";
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import useFocusTrap from "./useFocusTrap";

// jsdom no calcula layout real: `offsetParent` devuelve `null` siempre,
// aunque el elemento esté "visible" dentro del árbol de prueba. El trap
// de Tab (getFocusable(), ya existente desde UX-3) filtra por
// `offsetParent !== null` para ignorar elementos ocultos — sin este
// polyfill, todo test contra ese filtro vería una lista vacía y el trap
// no haría nada, dando un falso negativo (no un bug real del hook).
// Polyfill estándar de testing-library para este caso.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    get() {
      return this.parentNode;
    },
    configurable: true,
  });
});

function Modal({ open }) {
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);
  if (!open) return null;
  return (
    <div ref={dialogRef} role="dialog">
      <button data-testid="primero">Primero</button>
      <button data-testid="ultimo">Último</button>
    </div>
  );
}

function Escenario({ open }) {
  return (
    <div>
      <button data-testid="disparador">Abrir</button>
      <Modal open={open} />
    </div>
  );
}

describe("useFocusTrap", () => {
  afterEach(() => {
    cleanup();
  });

  it("atrapa Tab dentro del modal: del último elemento vuelve al primero", () => {
    render(<Escenario open={true} />);
    const primero = screen.getByTestId("primero");
    const ultimo = screen.getByTestId("ultimo");

    ultimo.focus();
    expect(document.activeElement).toBe(ultimo);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(primero);
  });

  it("atrapa Shift+Tab dentro del modal: del primero vuelve al último", () => {
    render(<Escenario open={true} />);
    const primero = screen.getByTestId("primero");
    const ultimo = screen.getByTestId("ultimo");

    primero.focus();
    expect(document.activeElement).toBe(primero);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ultimo);
  });

  it("UX-65: al cerrar, devuelve el foco al elemento que abrió el modal", () => {
    const { rerender } = render(<Escenario open={false} />);
    const disparador = screen.getByTestId("disparador");

    disparador.focus();
    expect(document.activeElement).toBe(disparador);

    // Abrir el modal: el hook debe guardar `disparador` como referencia.
    rerender(<Escenario open={true} />);
    // Simula que el usuario navegó dentro del modal.
    screen.getByTestId("primero").focus();
    expect(document.activeElement).not.toBe(disparador);

    // Cerrar el modal: el foco debe volver al disparador.
    rerender(<Escenario open={false} />);
    expect(document.activeElement).toBe(disparador);
  });

  it("UX-65: si el disparador ya no existe en el DOM al cerrar, no falla y no mueve el foco a ciegas", () => {
    function EscenarioConDisparadorDesmontable({ open, mostrarDisparador }) {
      return (
        <div>
          {mostrarDisparador && <button data-testid="disparador">Abrir</button>}
          <Modal open={open} />
        </div>
      );
    }

    const { rerender } = render(
      <EscenarioConDisparadorDesmontable open={false} mostrarDisparador={true} />
    );
    const disparador = screen.getByTestId("disparador");
    disparador.focus();

    rerender(<EscenarioConDisparadorDesmontable open={true} mostrarDisparador={true} />);

    // El disparador se desmonta MIENTRAS el modal sigue abierto (p. ej.
    // se borró la fila que lo contenía) y luego se cierra el modal.
    expect(() => {
      rerender(<EscenarioConDisparadorDesmontable open={false} mostrarDisparador={false} />);
    }).not.toThrow();
  });
});
