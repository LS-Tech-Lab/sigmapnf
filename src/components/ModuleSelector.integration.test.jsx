// @vitest-environment jsdom
// =====================================================================
// ModuleSelector.integration.test.jsx — ARCH-25 (auditoría QA del 15 de
// julio): cobertura de flujo real de la pantalla post-login que decide
// qué módulos ve cada perfil (Horarios / Asistencias / Sistema).
//
// No hace falta mockear Supabase: ModuleSelector es puramente
// presentacional (recibe los 3 flags de acceso ya resueltos por
// useModuloActivo y no hace ninguna consulta propia) — la "integración"
// aquí es render + click reales sobre el DOM en vez de solo testear el
// filtrado de MODULES como función pura.
// =====================================================================

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import ModuleSelector from "./ModuleSelector";

function renderSelector(overrides = {}) {
  const onSelectModule = vi.fn();
  const onLogout = vi.fn();
  const utils = render(
    <ModuleSelector
      profile={{ nombre: "Prof. Ana Pérez", email: "ana@unermb.edu.ve" }}
      tieneHorarios={false}
      tieneQR={false}
      tieneAdmin={false}
      onSelectModule={onSelectModule}
      onLogout={onLogout}
      {...overrides}
    />
  );
  return { ...utils, onSelectModule, onLogout };
}

afterEach(() => {
  cleanup();
});

describe("ModuleSelector — filtrado real de módulos según acceso del perfil", () => {
  it("con acceso a un solo módulo (caso límite: normalmente useModuloActivo ya lo auto-selecciona), muestra solo esa tarjeta", () => {
    renderSelector({ tieneHorarios: true });

    expect(screen.getByText("Gestión de Horarios")).toBeTruthy();
    expect(screen.queryByText("Control de Asistencias")).toBeNull();
    expect(screen.queryByText("Sistema")).toBeNull();
  });

  it("con acceso a los 3 módulos, muestra las 3 tarjetas en el orden fijo de MODULES", () => {
    renderSelector({ tieneHorarios: true, tieneQR: true, tieneAdmin: true });

    const titulos = screen.getAllByText(/Gestión de Horarios|Control de Asistencias|^Sistema$/);
    expect(titulos.map((n) => n.textContent)).toEqual([
      "Gestión de Horarios",
      "Control de Asistencias",
      "Sistema",
    ]);
  });

  it("sin ningún acceso, no muestra ninguna tarjeta de módulo (caso defensivo, no debería ocurrir en la práctica)", () => {
    renderSelector();
    expect(screen.queryByText("Gestión de Horarios")).toBeNull();
    expect(screen.queryByText("Control de Asistencias")).toBeNull();
    expect(screen.queryByText("Sistema")).toBeNull();
  });

  it("clickear una tarjeta llama a onSelectModule con el id correcto del módulo", () => {
    const { onSelectModule } = renderSelector({ tieneQR: true, tieneAdmin: true });

    fireEvent.click(screen.getByText("Control de Asistencias").closest("button"));
    expect(onSelectModule).toHaveBeenCalledWith("asistencias");

    fireEvent.click(screen.getByText("Sistema").closest("button"));
    expect(onSelectModule).toHaveBeenCalledWith("admin");
  });

  it("muestra el nombre del perfil, o el correo si no tiene nombre, o 'Usuario' como último fallback", () => {
    const { rerender } = renderSelector({ profile: { nombre: "Prof. Ana Pérez" } });
    expect(screen.getByText("Prof. Ana Pérez")).toBeTruthy();

    rerender(
      <ModuleSelector
        profile={{ email: "ana@unermb.edu.ve" }}
        tieneHorarios tieneQR tieneAdmin
        onSelectModule={vi.fn()} onLogout={vi.fn()}
      />
    );
    expect(screen.getByText("ana@unermb.edu.ve")).toBeTruthy();

    rerender(
      <ModuleSelector
        profile={{}}
        tieneHorarios tieneQR tieneAdmin
        onSelectModule={vi.fn()} onLogout={vi.fn()}
      />
    );
    expect(screen.getByText("Usuario")).toBeTruthy();
  });

  it("el botón de cerrar sesión llama a onLogout", () => {
    const { onLogout } = renderSelector();
    fireEvent.click(screen.getByText(/cerrar sesión/i));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  // SEDE-6: badge de sede activa, solo para roles con puedeVerTodasLasSedes.
  it("sin puedeElegirSede, no muestra el badge de sede (mayoría de los roles, con sede fija)", () => {
    renderSelector({ tieneHorarios: true });
    expect(screen.queryByTitle("Cambiar de sede")).toBeNull();
  });

  it("con puedeElegirSede, muestra el nombre de la sede activa y despliega el dropdown al hacer click, sin navegar a otra pantalla", () => {
    const onSelectSede = vi.fn();
    const sedes = [
      { id: "cabimas", nombre: "Cabimas" },
      { id: "ciudad_ojeda", nombre: "Ciudad Ojeda" },
    ];
    renderSelector({
      tieneHorarios: true,
      puedeElegirSede: true,
      sedes,
      sedeActiva: "cabimas",
      onSelectSede,
    });

    const badge = screen.getByTitle("Cambiar de sede");
    expect(badge.textContent).toContain("Cabimas");

    // Antes de abrir el dropdown, la lista de sedes no está en el DOM.
    expect(screen.queryByText("Ciudad Ojeda")).toBeNull();

    fireEvent.click(badge);
    expect(screen.getByText("Ciudad Ojeda")).toBeTruthy();
    // La pantalla sigue siendo ModuleSelector — el dropdown no navega.
    expect(screen.getByText("Gestión de Horarios")).toBeTruthy();

    fireEvent.click(screen.getByText("Ciudad Ojeda").closest("button"));
    expect(onSelectSede).toHaveBeenCalledWith("ciudad_ojeda");
  });

  it("clickear la sede ya activa dentro del dropdown no vuelve a llamar a onSelectSede", () => {
    const onSelectSede = vi.fn();
    const sedes = [{ id: "cabimas", nombre: "Cabimas" }];
    renderSelector({
      tieneHorarios: true,
      puedeElegirSede: true,
      sedes,
      sedeActiva: "cabimas",
      onSelectSede,
    });

    fireEvent.click(screen.getByTitle("Cambiar de sede"));
    fireEvent.click(screen.getByText("Cabimas", { selector: ".module-sede-menu-item span" }).closest("button"));
    expect(onSelectSede).not.toHaveBeenCalled();
  });

  it("con puedeElegirSede pero sin sedeActiva resuelta todavía, muestra un fallback en vez de texto vacío", () => {
    renderSelector({ tieneHorarios: true, puedeElegirSede: true, sedes: [], sedeActiva: null });
    expect(screen.getByTitle("Cambiar de sede").textContent).toContain("Sin sede");
  });
});
