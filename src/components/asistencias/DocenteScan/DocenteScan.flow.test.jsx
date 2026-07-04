// @vitest-environment jsdom
// =====================================================================
// DocenteScan.flow.test.jsx — ARCH-5 (auditoría julio 2026, continuación):
//
// F3 pedía pruebas de "flujo de usuario completo", no solo funciones
// puras u orquestación de hooks. Este archivo cubre el flujo real que
// más docentes usan en el sistema: escanear el QR y registrar su
// asistencia, renderizando los componentes tal como los ve el usuario
// (render + fireEvent + screen), sin mockear DocenteScan ni sus
// subcomponentes — solo se mockea el cliente de Supabase.
//
// Nota: se usa getByLabelText (el método recomendado por Testing Library,
// que imita cómo un lector de pantalla encuentra el campo) ahora que U-4
// está corregido — Campo.jsx asocia label/input vía useId(). Antes de ese
// fix este archivo usaba getByPlaceholderText como workaround; se dejó de
// usar en cuanto U-4 se cerró, precisamente para que este test sirviera de
// guardia contra que alguien rompa esa asociación en el futuro.
//
// No se usa @testing-library/jest-dom (no está en las dependencias del
// proyecto): las aserciones "está en pantalla" se hacen con los propios
// helpers de Testing Library (getBy/queryBy lanzan o devuelven null),
// no con matchers adicionales.
//
// Casos cubiertos:
//   1. Docente nuevo (sin datos guardados en este dispositivo):
//      selector de tipo → formulario → confirmación visual → registro
//      exitoso vía RPC → pantalla de resultado con su nombre.
//   2. Cédula con formato inválido: el formulario bloquea el envío y
//      muestra el mensaje de error sin llamar a Supabase.
//   3. Docente recurrente (con datos guardados y sesión QR vigente):
//      confirma sin tener que volver a escribir cédula/nombre.
// =====================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Builder de Supabase "todo-terreno": encadenable (select/eq/not/order/limit)
// y también awaitable directamente (thenable), porque el código real usa
// ambos patrones según la consulta (`.maybeSingle()` explícito en unas,
// `await` directo sobre el builder en otras — igual que el cliente real).
function makeTableMock(result = { data: null, error: null }) {
  const builder = {};
  ["select", "eq", "not", "order", "limit"].forEach((m) => {
    builder[m] = vi.fn(() => builder);
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
}

vi.mock("../../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from "../../../lib/supabase";
import DocenteScan from "./index.jsx";
import { LS_KEY } from "./cedula";

function irA(token) {
  window.history.pushState({}, "", token ? `/scan?token=${token}` : "/scan");
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
  // Sin fila de docente/asistencia previa: la búsqueda de autocompletado
  // (docentes / asistencias_diarias) no encuentra nada, pero no rompe el flujo.
  supabase.from.mockImplementation(() => makeTableMock({ data: null, error: null }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("DocenteScan — flujo de docente nuevo", () => {
  it("registra la entrada de principio a fin y muestra el resultado exitoso", async () => {
    irA("qr-token-123");
    supabase.rpc.mockResolvedValue({
      data: {
        ok: true,
        tipo: "ENTRADA",
        mensaje: "Entrada registrada correctamente.",
        horario_hoy: null,
        dia_semana: null,
      },
      error: null,
    });

    render(<DocenteScan />);

    // Paso 1: selector de tipo de registro
    const btnEntrada = await screen.findByRole("button", { name: /marcar entrada/i });
    fireEvent.click(btnEntrada);

    // Paso 2: formulario (primera vez)
    const inputCedula = await screen.findByLabelText(/cédula de identidad/i);
    const inputNombre = screen.getByLabelText(/nombre completo/i);
    fireEvent.change(inputCedula, { target: { value: "V-12345678" } });
    fireEvent.change(inputNombre, { target: { value: "Prof. Ana Pérez" } });
    fireEvent.click(screen.getByRole("button", { name: /^registrar mi entrada$/i }));

    // Paso 3: confirmación visual de los datos antes de enviarlos
    expect(await screen.findByText(/verifica tus datos/i)).toBeTruthy();
    expect(screen.getByText("12345678")).toBeTruthy();
    expect(screen.getByText("Prof. Ana Pérez")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /confirmar y registrar mi entrada/i }));

    // Paso 4: se llamó al RPC con el payload correcto (cédula normalizada)
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
    expect(supabase.rpc).toHaveBeenCalledWith(
      "registrar_asistencia",
      expect.objectContaining({
        p_token: "qr-token-123",
        p_cedula_docente: "12345678",
        p_nombre_docente: "Prof. Ana Pérez",
        p_tipo: "ENTRADA",
      })
    );

    // Paso 5: pantalla de resultado exitoso con el nombre del docente
    expect(await screen.findByText(/entrada registrada correctamente/i)).toBeTruthy();
    expect(screen.getByText("Prof. Ana Pérez")).toBeTruthy();

    // Efecto colateral esperado: los datos quedan guardados en este
    // dispositivo para la próxima vez que el mismo docente escanee.
    const guardado = JSON.parse(localStorage.getItem(LS_KEY));
    expect(guardado.cedula).toBe("12345678");
    expect(guardado.nombre).toBe("Prof. Ana Pérez");
  });

  it("bloquea el envío si la cédula no tiene un formato válido, sin llamar a Supabase", async () => {
    irA("qr-token-123");

    render(<DocenteScan />);

    fireEvent.click(await screen.findByRole("button", { name: /marcar entrada/i }));

    const inputCedula = await screen.findByLabelText(/cédula de identidad/i);
    const inputNombre = screen.getByLabelText(/nombre completo/i);
    // Cédula con letras y muy corta tras normalizar -> formato inválido
    fireEvent.change(inputCedula, { target: { value: "abc-12" } });
    fireEvent.change(inputNombre, { target: { value: "Prof. Ana Pérez" } });
    fireEvent.click(screen.getByRole("button", { name: /^registrar mi entrada$/i }));

    expect(
      await screen.findByText(/eso no parece una cédula válida/i)
    ).toBeTruthy();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("DocenteScan — flujo de docente recurrente con datos guardados", () => {
  it("usa los datos guardados en el dispositivo sin pedirlos de nuevo", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        cedula: "87654321",
        nombre: "Prof. Luis Rojas",
        fecha: new Date().toISOString().slice(0, 10),
        guardadoEn: Date.now(),
      })
    );
    // La validación inicial consulta qr_sessions para confirmar que el
    // token del QR corresponde al día de hoy antes de mostrar los datos guardados.
    supabase.from.mockImplementation((tabla) => {
      if (tabla === "qr_sessions") {
        return makeTableMock({ data: { id: "sesion-1" }, error: null });
      }
      return makeTableMock({ data: null, error: null });
    });
    supabase.rpc.mockResolvedValue({
      data: { ok: true, tipo: "ENTRADA", mensaje: "Entrada registrada correctamente." },
      error: null,
    });

    irA("qr-token-vigente");
    render(<DocenteScan />);

    fireEvent.click(await screen.findByRole("button", { name: /marcar entrada/i }));

    // No debe pedir el formulario: pasa directo a la pantalla de confirmación.
    expect(await screen.findByText(/confirma que eres tú para continuar/i)).toBeTruthy();
    expect(screen.getByText("Prof. Luis Rojas")).toBeTruthy();
    expect(screen.queryByLabelText(/cédula de identidad/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^confirmar mi entrada$/i }));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
    expect(supabase.rpc).toHaveBeenCalledWith(
      "registrar_asistencia",
      expect.objectContaining({ p_cedula_docente: "87654321", p_nombre_docente: "Prof. Luis Rojas" })
    );
  });
});
