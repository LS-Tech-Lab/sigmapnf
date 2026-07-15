// =====================================================================
// useAuth.test.js — ARCH-7: cobertura de tests para lógica crítica
// de autenticación y autorización.
//
// calcularPermisos() es la función pura que transforma el perfil del
// usuario (con rol_info embebido desde la BD) en un objeto de booleanos
// que toda la app usa para habilitar o deshabilitar acciones. Un error
// aquí puede:
//   - Dar acceso a funciones protegidas a usuarios sin permiso
//   - Bloquear acceso legítimo a coordinadores o admins
//   - Romper silenciosamente al agregar un permiso nuevo a la BD
//
// PERMISOS_BASE actúa como fallback seguro (todo en false) cuando el
// rol del usuario no define explícitamente un permiso. Este archivo
// verifica que el fallback funciona correctamente y que los permisos
// de la BD se aplican sin pisar el baseline.
// =====================================================================

import { describe, it, expect } from "vitest";
import { calcularPermisos, PERMISOS_BASE } from "./useAuth";

// ── Helpers de fixtures ────────────────────────────────────────────
function makeProfile(overrides = {}) {
  return {
    id:       "user-123",
    nombre:   "Test User",
    programa: "INGENIERIA",
    activo:   true,
    rol:      "coordinador",
    rol_info: {
      nombre:              "coordinador",
      label:               "Coordinador",
      restringe_programa:  false,
      permisos: {
        puedeVerTodo:              false,
        puedeImportarExcel:        true,
        puedeEditarHorarios:       true,
        puedeBorrarHorarios:       false,
        puedeEditarDocentes:       true,
        puedeEditarMaterias:       true,
        puedeGestionarTrimestres:  false,
        puedeHacerBackup:          false,
        puedeRestaurarBackup:      false,
        puedeGestionarUsuarios:    false,
        puedeGestionarRoles:       false,
        puedeVerLogs:              false,
        puedeVerAuditoria:         false,
        puedeGestionarQR:          false,
        puedeVerReporteAsistencias: false,
        puedeBorrarSesiones:       false,
        puedeBorrarReportes:       false,
      },
    },
    ...overrides,
  };
}

// ── Tests: perfil nulo o sin rol_info ─────────────────────────────
describe("calcularPermisos — sin perfil", () => {
  it("devuelve todos los permisos en false cuando el perfil es null", () => {
    const result = calcularPermisos(null);
    // Verificar que todos los permisos base están en false
    Object.keys(PERMISOS_BASE).forEach(key => {
      expect(result[key], `permiso: ${key}`).toBe(false);
    });
    expect(result.puedeVerSoloSuPrograma).toBe(false);
    expect(result.programaRestringido).toBeNull();
  });

  it("devuelve todos los permisos en false cuando el perfil es undefined", () => {
    const result = calcularPermisos(undefined);
    Object.keys(PERMISOS_BASE).forEach(key => {
      expect(result[key], `permiso: ${key}`).toBe(false);
    });
    expect(result.puedeVerSoloSuPrograma).toBe(false);
    expect(result.programaRestringido).toBeNull();
  });

  it("devuelve todos los permisos en false cuando rol_info es null", () => {
    const result = calcularPermisos({ id: "x", rol_info: null });
    Object.keys(PERMISOS_BASE).forEach(key => {
      expect(result[key], `permiso: ${key}`).toBe(false);
    });
    expect(result.puedeVerSoloSuPrograma).toBe(false);
    expect(result.programaRestringido).toBeNull();
  });
});

// ── Tests: permisos aplicados desde BD ────────────────────────────
describe("calcularPermisos — perfil con rol_info", () => {
  it("aplica los permisos del rol correctamente", () => {
    const result = calcularPermisos(makeProfile());
    expect(result.puedeImportarExcel).toBe(true);
    expect(result.puedeEditarHorarios).toBe(true);
    expect(result.puedeEditarDocentes).toBe(true);
    expect(result.puedeEditarMaterias).toBe(true);
  });

  it("mantiene en false los permisos que el rol no otorga", () => {
    const result = calcularPermisos(makeProfile());
    expect(result.puedeVerTodo).toBe(false);
    expect(result.puedeBorrarHorarios).toBe(false);
    expect(result.puedeGestionarUsuarios).toBe(false);
    expect(result.puedeGestionarRoles).toBe(false);
    expect(result.puedeVerLogs).toBe(false);
  });

  it("permite que un rol administrador tenga todos los permisos en true", () => {
    const todosTrue = Object.fromEntries(
      Object.keys(PERMISOS_BASE).map(k => [k, true])
    );
    const profile = makeProfile({
      rol: "admin",
      rol_info: {
        nombre: "admin",
        label: "Administrador",
        restringe_programa: false,
        permisos: todosTrue,
      },
    });
    const result = calcularPermisos(profile);
    Object.keys(PERMISOS_BASE).forEach(key => {
      expect(result[key], `permiso: ${key}`).toBe(true);
    });
  });

  it("trata un permiso no definido en el rol como false (PERMISOS_BASE como fallback)", () => {
    // Simula un rol antiguo al que aún no se le ha agregado un permiso nuevo
    const profile = makeProfile({
      rol_info: {
        nombre: "docente",
        label: "Docente",
        restringe_programa: false,
        permisos: {
          // Solo un permiso definido — el resto usa PERMISOS_BASE (false)
          puedeVerReporteAsistencias: true,
        },
      },
    });
    const result = calcularPermisos(profile);
    expect(result.puedeVerReporteAsistencias).toBe(true);
    expect(result.puedeEditarHorarios).toBe(false);    // no definido → false
    expect(result.puedeGestionarUsuarios).toBe(false); // no definido → false
  });

  it("trata permisos: null en rol_info como si fueran todos false", () => {
    const profile = makeProfile({
      rol_info: {
        nombre: "invitado",
        label: "Invitado",
        restringe_programa: false,
        permisos: null,
      },
    });
    const result = calcularPermisos(profile);
    Object.keys(PERMISOS_BASE).forEach(key => {
      expect(result[key], `permiso: ${key}`).toBe(false);
    });
  });
});

// ── Tests: restricción de programa ────────────────────────────────
describe("calcularPermisos — restringe_programa", () => {
  it("puedeVerSoloSuPrograma es false cuando restringe_programa es false", () => {
    const result = calcularPermisos(makeProfile({ programa: "INGENIERIA" }));
    expect(result.puedeVerSoloSuPrograma).toBe(false);
    expect(result.programaRestringido).toBeNull();
  });

  it("puedeVerSoloSuPrograma es true y programaRestringido es el programa del usuario cuando restringe_programa es true", () => {
    const profile = makeProfile({
      programa: "INFORMATICA",
      rol_info: {
        nombre: "coord_programa",
        label: "Coordinador de Programa",
        restringe_programa: true,
        permisos: { puedeVerTodo: false },
      },
    });
    const result = calcularPermisos(profile);
    expect(result.puedeVerSoloSuPrograma).toBe(true);
    expect(result.programaRestringido).toBe("INFORMATICA");
  });

  it("programaRestringido es null cuando restringe_programa es true pero el usuario no tiene programa", () => {
    const profile = makeProfile({
      programa: null,
      rol_info: {
        nombre: "coord_sin_programa",
        label: "Coordinador sin programa asignado",
        restringe_programa: true,
        permisos: {},
      },
    });
    const result = calcularPermisos(profile);
    expect(result.puedeVerSoloSuPrograma).toBe(true);
    // null porque profile.programa es null
    expect(result.programaRestringido).toBeNull();
  });
});

// ── Tests: PERMISOS_BASE como contrato ────────────────────────────
describe("PERMISOS_BASE", () => {
  it("contiene exactamente las claves de permisos esperadas", () => {
    const clavesEsperadas = [
      "puedeVerTodo",
      "puedeImportarExcel",
      "puedeEditarHorarios",
      "puedeBorrarHorarios",
      "puedeEditarDocentes",
      "puedeEditarMaterias",
      "puedeGestionarTrimestres",
      "puedeHacerBackup",
      "puedeRestaurarBackup",
      "puedeGestionarUsuarios",
      "puedeGestionarRoles",
      "puedeVerLogs",
      "puedeVerAuditoria",
      "puedeGestionarQR",
      "puedeVerReporteAsistencias",
      "puedeBorrarSesiones",
      "puedeBorrarReportes",
    ];
    expect(Object.keys(PERMISOS_BASE).sort()).toEqual(clavesEsperadas.sort());
  });

  it("todos los valores por defecto son false", () => {
    Object.entries(PERMISOS_BASE).forEach(([key, val]) => {
      expect(val, `PERMISOS_BASE.${key} debe ser false`).toBe(false);
    });
  });
});
