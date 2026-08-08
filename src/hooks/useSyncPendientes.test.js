// @vitest-environment jsdom
// =====================================================================
// useSyncPendientes.test.js — OFF-10: el hook no tenía cobertura previa;
// se agrega enfocada en lo que cambió (sincronización de la cola manual
// y el contador combinado), no en re-probar sync() de la cola normal
// (ya cubierta indirectamente por offlineQueue.test.js + el diseño
// documentado en el propio archivo fuente).
//
// Es lógica sensible: toca registros reales de asistencia. Un bug acá
// puede perder datos (purgar de más) o dejarlos atascados para siempre
// (nunca purgar lo irrecuperable).
//
// Mismo patrón que useQRSession.off10.test.js: unmount() explícito al
// final de cada test — este repo no depende de auto-cleanup de RTL, así
// que un hook no desmontado deja su listener de 'online' vivo y
// contamina los tests siguientes dentro del mismo archivo.
// =====================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "../lib/supabase";
import useSyncPendientes from "./useSyncPendientes";
import { encolarAsistenciaManual, obtenerPendientesManuales } from "../utils/manualAttendanceQueue";
import { encolarAsistencia } from "../utils/offlineQueue";

beforeEach(() => {
  supabase.rpc.mockReset();
});

function registroManual(overrides = {}) {
  return {
    cedula: "V-1", nombre: "Docente Uno", tipo: "ENTRADA",
    turno: "DIURNO", programa: null, fecha: "2026-08-07", sede_id: "cabimas",
    ...overrides,
  };
}

describe("useSyncPendientes — OFF-10: sincronización de la cola manual", () => {
  it("sincroniza un registro manual exitoso y lo elimina de IDB", async () => {
    await encolarAsistenciaManual(registroManual());
    supabase.rpc.mockResolvedValue({ data: { ok: true, asistencia_id: "a1" } });
    const showToast = vi.fn();

    const { unmount } = renderHook(() => useSyncPendientes(showToast));

    // Esperar la señal de que el ciclo completo terminó (toast final),
    // no solo el estado intermedio de IDB — evita dejar la promesa en
    // vuelo cuando el próximo test ya reseteó los mocks.
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/sincronizado/), "success");
    });
    expect(await obtenerPendientesManuales()).toHaveLength(0);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "registrar_asistencia_manual",
      expect.objectContaining({ p_cedula_docente: "V-1", p_tipo: "ENTRADA", p_fecha: "2026-08-07" })
    );

    unmount();
  });

  it("purga un registro con código irrecuperable (dato inválido) sin reintentar", async () => {
    await encolarAsistenciaManual(registroManual());
    supabase.rpc.mockResolvedValue({ data: { ok: false, codigo: "TURNO_INVALIDO" } });
    const showToast = vi.fn();

    const { unmount } = renderHook(() => useSyncPendientes(showToast));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/datos inválidos/), "warning");
    });
    expect(await obtenerPendientesManuales()).toHaveLength(0);

    unmount();
  });

  it("deja en cola un registro con SIN_ENTRADA_PREVIA para reintentar más tarde", async () => {
    await encolarAsistenciaManual(registroManual({ tipo: "SALIDA" }));
    supabase.rpc.mockResolvedValue({ data: { ok: false, codigo: "SIN_ENTRADA_PREVIA" } });
    const showToast = vi.fn();

    const { unmount } = renderHook(() => useSyncPendientes(showToast));

    // Señal de que syncManuales() terminó su ciclo completo (loop +
    // refreshCount + el toast de "fallidos" que dispara al final) — más
    // confiable que un setTimeout arbitrario para no dejar la promesa
    // en vuelo cuando el test siguiente ya reseteó los mocks.
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/no se pudo sincronizar todavía/), "warning");
    });
    expect(await obtenerPendientesManuales()).toHaveLength(1);

    unmount();
  });

  it("deja en cola un registro con SIN_PERMISO en vez de descartarlo en silencio", async () => {
    await encolarAsistenciaManual(registroManual());
    supabase.rpc.mockResolvedValue({ data: { ok: false, codigo: "SIN_PERMISO" } });
    const showToast = vi.fn();

    const { unmount } = renderHook(() => useSyncPendientes(showToast));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/no se pudo sincronizar todavía/), "warning");
    });
    expect(await obtenerPendientesManuales()).toHaveLength(1);

    unmount();
  });

  it("pendientesCount suma la cola normal y la cola manual, y no llama al RPC sin red", async () => {
    await encolarAsistencia({ qr_session_id: "s1", p_cedula_docente: "V-9" });
    await encolarAsistenciaManual(registroManual({ cedula: "V-2" }));
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });

    const { result, unmount } = renderHook(() => useSyncPendientes(vi.fn()));

    await waitFor(() => {
      expect(result.current.pendientesCount).toBe(2);
    });
    expect(supabase.rpc).not.toHaveBeenCalled();

    unmount();
  });
});
