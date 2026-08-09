// @vitest-environment jsdom
// =====================================================================
// useModuloActivo.test.js — ADMIN-7: la PWA "SIGMA Proyección" instalada
// (manifest-proyeccion.webmanifest, start_url "/?proyeccion=1") necesita
// que abrir su ícono lleve directo a la proyección QR, sin importar
// cuántos módulos tenga el usuario logueado — antes, un admin/coordinador
// con 2+ módulos caía en el ModuleSelector y el query param se perdía
// (solo lo consumía AsistenciasModulo, que nunca llegaba a montarse).
// =====================================================================

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import useModuloActivo from "./useModuloActivo";

function setSearch(search) {
  window.history.replaceState({}, "", `/${search}`);
}

function permisos(overrides = {}) {
  return {
    puedeVerTodo: false,
    puedeVerSoloSuPrograma: false,
    puedeGestionarQR: false,
    puedeVerReporteAsistencias: false,
    puedeGestionarUsuarios: false,
    puedeGestionarRoles: false,
    puedeVerLogs: false,
    puedeVerAuditoria: false,
    puedeGestionarTrimestres: false,
    ...overrides,
  };
}

afterEach(() => {
  setSearch("");
});

describe("useModuloActivo — deep-link ?proyeccion=1 (ADMIN-7)", () => {
  it("con ?proyeccion=1 y acceso a QR, salta directo a 'asistencias' aunque tenga varios módulos", async () => {
    setSearch("?proyeccion=1");
    const { result } = renderHook(() =>
      useModuloActivo({
        efectiveProfile: { id: "u1" },
        efectivePermisos: permisos({ puedeGestionarQR: true, puedeVerTodo: true, puedeGestionarUsuarios: true }),
      })
    );

    await waitFor(() => expect(result.current.moduloActivo).toBe("asistencias"));
  });

  it("con ?proyeccion=1 pero SIN acceso a QR, sigue el flujo normal (no fuerza un módulo al que no tiene acceso)", async () => {
    setSearch("?proyeccion=1");
    const { result } = renderHook(() =>
      useModuloActivo({
        efectiveProfile: { id: "u1" },
        efectivePermisos: permisos({ puedeVerTodo: true }), // solo Horarios
      })
    );

    await waitFor(() => expect(result.current.moduloActivo).toBe("horarios"));
  });

  it("sin ?proyeccion=1, un usuario con 2+ módulos queda en null (ModuleSelector) — comportamiento previo intacto", async () => {
    setSearch("");
    const { result } = renderHook(() =>
      useModuloActivo({
        efectiveProfile: { id: "u1" },
        efectivePermisos: permisos({ puedeGestionarQR: true, puedeVerTodo: true }),
      })
    );

    // Da tiempo a que el efecto corra; debe seguir en null.
    await waitFor(() => expect(result.current.tieneQR).toBe(true));
    expect(result.current.moduloActivo).toBeNull();
  });

  it("sin ?proyeccion=1, un usuario con un solo módulo se sigue auto-seleccionando igual que antes", async () => {
    setSearch("");
    const { result } = renderHook(() =>
      useModuloActivo({
        efectiveProfile: { id: "u1" },
        efectivePermisos: permisos({ puedeGestionarQR: true }),
      })
    );

    await waitFor(() => expect(result.current.moduloActivo).toBe("asistencias"));
  });
});
