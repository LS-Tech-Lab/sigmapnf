// @vitest-environment jsdom
/**
 * useSedes.test.js
 *
 * SEDE-7: regresión del bug donde useSedes() disparaba su fetch en el
 * primer montaje de <App/> -- antes de que existiera sesión autenticada
 * -- y nunca volvía a intentarlo tras el login, dejando `sedes` vacío
 * para toda la sesión del navegador sin ningún error visible (RLS
 * deniega en silencio, no lanza excepción).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../lib/supabase";
import useSedes from "./useSedes";

function makeSelectBuilder(result) {
  const builder = {
    select: () => builder,
    order: () => Promise.resolve(result),
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSedes", () => {
  it("sin userId (sin sesión todavía), no consulta la tabla y devuelve lista vacía sin quedarse cargando", async () => {
    const { result } = renderHook(() => useSedes(undefined));

    await waitFor(() => expect(result.current.loadingSedes).toBe(false));

    expect(result.current.sedes).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("con userId, consulta `sedes` y filtra las inactivas", async () => {
    supabase.from.mockReturnValue(
      makeSelectBuilder({
        data: [
          { id: "cabimas", nombre: "Cabimas", activa: true, orden: 1 },
          { id: "coro", nombre: "Coro", activa: false, orden: 2 },
        ],
        error: null,
      })
    );

    const { result } = renderHook(() => useSedes("user-1"));

    await waitFor(() => expect(result.current.loadingSedes).toBe(false));

    expect(supabase.from).toHaveBeenCalledWith("sedes");
    expect(result.current.sedes).toEqual([
      { id: "cabimas", nombre: "Cabimas", activa: true, orden: 1 },
    ]);
  });

  it("SEDE-7: vuelve a consultar cuando userId aparece después del primer montaje (login resolviendo tarde)", async () => {
    supabase.from.mockReturnValue(
      makeSelectBuilder({
        data: [{ id: "cabimas", nombre: "Cabimas", activa: true, orden: 1 }],
        error: null,
      })
    );

    const { result, rerender } = renderHook(({ userId }) => useSedes(userId), {
      initialProps: { userId: undefined },
    });

    // Primer render: sin sesión todavía -- no debe haber consultado nada.
    await waitFor(() => expect(result.current.loadingSedes).toBe(false));
    expect(supabase.from).not.toHaveBeenCalled();
    expect(result.current.sedes).toEqual([]);

    // El login termina de resolver -- userId aparece.
    rerender({ userId: "user-1" });

    await waitFor(() => expect(result.current.sedes.length).toBe(1));
    expect(supabase.from).toHaveBeenCalledWith("sedes");
    expect(result.current.sedes[0].id).toBe("cabimas");
  });

  it("ante un error del query, loguea y deja la lista vacía en vez de romper la pantalla", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase.from.mockReturnValue(
      makeSelectBuilder({ data: null, error: new Error("network error") })
    );

    const { result } = renderHook(() => useSedes("user-1"));

    await waitFor(() => expect(result.current.loadingSedes).toBe(false));

    expect(result.current.sedes).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "useSedes: error al cargar catálogo de sedes",
      expect.any(Error)
    );
    consoleErrorSpy.mockRestore();
  });

  it("SEDE-17: refetchSedes vuelve a consultar la tabla a demanda (ej. tras crear/editar una sede)", async () => {
    supabase.from
      .mockReturnValueOnce(
        makeSelectBuilder({
          data: [{ id: "cabimas", nombre: "Cabimas", activa: true, orden: 1 }],
          error: null,
        })
      )
      .mockReturnValueOnce(
        makeSelectBuilder({
          data: [
            { id: "cabimas", nombre: "Cabimas", activa: true, orden: 1 },
            { id: "bobures", nombre: "Bobures", activa: true, orden: 2 },
          ],
          error: null,
        })
      );

    const { result } = renderHook(() => useSedes("user-1"));
    await waitFor(() => expect(result.current.sedes.length).toBe(1));

    await result.current.refetchSedes();

    await waitFor(() => expect(result.current.sedes.length).toBe(2));
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });
});
