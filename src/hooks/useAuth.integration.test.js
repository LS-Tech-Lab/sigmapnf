// @vitest-environment jsdom
// =====================================================================
// useAuth.integration.test.js — ARCH-8 (auditoría julio 2026):
// cobertura de FLUJO, no solo de función pura.
//
// useAuth.test.js ya cubre calcularPermisos() como función aislada.
// Lo que faltaba cubrir es la orquestación real de login que corre en
// cada carga de la app: getSession() → cargarProfile() → permisos, y
// sus tres desenlaces posibles para un usuario autenticado:
//   1. Perfil activo con rol válido  → acceso normal
//   2. Sin fila en user_profiles     → tratado como sin acceso
//   3. Sin sesión                     → pantalla de login
//
// Se mockea todo el cliente de Supabase (auth, from, channel, rpc) —
// nunca se conecta a un proyecto real. La suscripción realtime y el
// listener de auth se registran igual que en producción para detectar
// si un cambio futuro rompe el "shape" que ambos esperan.
// =====================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

function makeQueryBuilder(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    single: () => Promise.resolve(result),
  };
  return builder;
}

function makeChannelMock() {
  const channel = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return channel;
}

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from "../lib/supabase";
import useAuth from "./useAuth";

const authUser = { id: "user-1", email: "docente@unermb.edu.ve" };

beforeEach(() => {
  vi.clearAllMocks();
  supabase.channel.mockImplementation(() => makeChannelMock());
});

describe("useAuth — flujo de sesión con perfil activo", () => {
  it("carga el perfil, resuelve rol_info y calcula los permisos reales del rol", async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: authUser } } });
    supabase.from.mockReturnValue(
      makeQueryBuilder({
        data: {
          id: authUser.id,
          activo: true,
          rol: "coordinador",
          rol_info: {
            nombre: "coordinador",
            label: "Coordinador",
            restringe_programa: false,
            permisos: { puedeEditarHorarios: true, puedeImportarExcel: true },
          },
        },
        error: null,
      })
    );

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loadingProfile).toBe(false));

    expect(result.current.user).toEqual(authUser);
    expect(result.current.profile.rol_info.nombre).toBe("coordinador");
    // Permiso concedido explícitamente por el rol:
    expect(result.current.permisos.puedeEditarHorarios).toBe(true);
    // Permiso NO listado en el rol → debe caer al valor seguro por defecto (false),
    // no a `undefined`, que rompería checks como `if (permisos.puedeVerLogs)`.
    expect(result.current.permisos.puedeVerLogs).toBe(false);
  });
});

describe("useAuth — flujo de sesión sin fila en user_profiles", () => {
  it("trata al usuario como sin acceso en vez de crashear", async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: authUser } } });
    supabase.from.mockReturnValue(makeQueryBuilder({ data: null, error: { message: "no rows" } }));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loadingProfile).toBe(false));

    expect(result.current.user).toEqual(authUser);
    expect(result.current.profile).toBeNull();
    // Sin perfil → todos los permisos deben quedar en false, nunca undefined.
    expect(result.current.permisos.puedeGestionarUsuarios).toBe(false);
  });
});

describe("useAuth — flujo sin sesión activa", () => {
  it("no intenta cargar perfil y deja user/profile en null (pantalla de login)", async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    const { result } = renderHook(() => useAuth());

    // App.jsx decide mostrar el login en cuanto `user` deja de ser `undefined`
    // (sesión aún verificándose) y pasa a `null` (sesión verificada, sin
    // usuario) — es la señal real que consume la UI, por eso esperamos por
    // `user` y no por `loadingProfile`.
    await waitFor(() => expect(result.current.user).not.toBeUndefined());

    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
    // Sin usuario, no debería haberse consultado user_profiles.
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
