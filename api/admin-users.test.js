// api/admin-users.test.js — Fase 2, prioridad 2 (auditoría de cobertura,
// 10 ago 2026): endpoint más sensible del sistema sin ningún test —
// crea/borra cuentas y resetea contraseñas con la Service Role Key,
// fuera de RLS. Mismo enfoque que api/csp-report.test.js: invocar
// `handler` directo con req/res mínimos, mockeando `fetch` global.
//
// No cubre: el contenido exacto de cada payload hacia Supabase Auth
// Admin API línea por línea (ya se verifica lo esencial por acción);
// prioriza los guardrails de seguridad (origen, sesión, permiso, rate
// limit, jerarquía admin, auto-eliminación) porque ahí es donde un bug
// tiene consecuencias reales.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function makeReq({ method = "POST", headers = {}, body = {} } = {}) {
  return {
    method,
    headers: { host: "sigmapnf.vercel.app", authorization: "Bearer user-token", ...headers },
    body,
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return res;
}

// Router de fetch: revisa `overrides` (array de [substring, handler]) antes
// que los defaults, así cada test solo pisa lo que le importa. Los
// defaults representan el camino feliz completo del preámbulo de guardas
// (sesión válida, permiso de gestión, rate limit ok, actor no-admin).
function makeFetchRouter(overrides = []) {
  const defaultHandlers = [
    ["/auth/v1/user", () => ({ ok: true, json: async () => ({ id: "actor-1", email: "actor@unermb.edu.ve" }) })],
    ["/rpc/admin_caller_puede_gestionar_usuarios", () => ({ ok: true, json: async () => true })],
    ["/rpc/registrar_admin_action_rate_limit", () => ({ ok: true, json: async () => ({ permitido: true }) })],
    ["/user_profiles?id=eq.actor-1&select=rol", () => ({ ok: true, json: async () => [{ rol: "coordinador" }] })],
    ["/auth/v1/admin/users", () => ({ ok: true, json: async () => ({ id: "nuevo-user-id" }) })],
    ["/rest/v1/user_profiles", () => ({ ok: true, json: async () => ({}) })],
    ["/rest/v1/user_profiles_programas", () => ({ ok: true, json: async () => ({}) })],
  ];
  const handlers = [...overrides, ...defaultHandlers];
  return vi.fn(async (url) => {
    const urlStr = String(url);
    const match = handlers.find(([key]) => urlStr.includes(key));
    if (!match) throw new Error("URL no mockeada en el test: " + urlStr);
    return match[1](url);
  });
}

describe("api/admin-users", () => {
  let handler;

  beforeEach(async () => {
    vi.resetModules();
    process.env.VITE_SUPABASE_URL = "https://proyecto.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    ({ default: handler } = await import("./admin-users.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  describe("guardrails comunes (corren antes de cualquier acción)", () => {
    it("rechaza métodos distintos de POST", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ method: "GET" }), res);
      expect(res.statusCode).toBe(405);
    });

    it("SEC-19: rechaza si el Origin no coincide con el host", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ headers: { origin: "https://sitio-atacante.com" }, body: { action: "create" } }), res);
      expect(res.statusCode).toBe(403);
    });

    it("rechaza sin header Authorization", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: "" }, body: { action: "create" } }), res);
      expect(res.statusCode).toBe(401);
    });

    it("rechaza si la sesión del token no es válida", async () => {
      vi.stubGlobal("fetch", makeFetchRouter([
        ["/auth/v1/user", () => ({ ok: false, json: async () => ({}) })],
      ]));
      const res = makeRes();
      await handler(makeReq({ body: { action: "create" } }), res);
      expect(res.statusCode).toBe(401);
    });

    it("rechaza si el caller no tiene permiso de gestión de usuarios", async () => {
      vi.stubGlobal("fetch", makeFetchRouter([
        ["/rpc/admin_caller_puede_gestionar_usuarios", () => ({ ok: true, json: async () => false })],
      ]));
      const res = makeRes();
      await handler(makeReq({ body: { action: "create" } }), res);
      expect(res.statusCode).toBe(403);
    });

    it("SEC-16: fail-closed si la RPC de rate limit responde error", async () => {
      vi.stubGlobal("fetch", makeFetchRouter([
        ["/rpc/registrar_admin_action_rate_limit", () => ({ ok: false, json: async () => ({}) })],
      ]));
      const res = makeRes();
      await handler(makeReq({ body: { action: "create" } }), res);
      expect(res.statusCode).toBe(500);
    });

    it("SEC-16: rechaza con 429 si el rate limit dice no permitido", async () => {
      vi.stubGlobal("fetch", makeFetchRouter([
        ["/rpc/registrar_admin_action_rate_limit", () => ({ ok: true, json: async () => ({ permitido: false, reintentar_en_seg: 42 }) })],
      ]));
      const res = makeRes();
      await handler(makeReq({ body: { action: "create" } }), res);
      expect(res.statusCode).toBe(429);
      expect(res.body.error).toContain("42s");
    });

    it("acción desconocida devuelve 400", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ body: { action: "volar_a_la_luna" } }), res);
      expect(res.statusCode).toBe(400);
    });
  });

  describe("action: create", () => {
    const bodyValido = {
      action: "create", email: "nuevo@unermb.edu.ve", password: "Abcdefgh12",
      nombre: "Nuevo Docente", rol: "coordinador", programas: ["INFORMATICA"], sede_id: "cabimas",
    };

    it("exige los campos obligatorios", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ body: { action: "create", email: "x@x.com" } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("valida la contraseña con las mismas reglas que validarPassword (SEC-5)", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ body: { ...bodyValido, password: "corta1" } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/10 caracteres/);
    });

    it("SEC-15: un actor NO-admin no puede crear una cuenta con rol admin", async () => {
      // default: actor con rol "coordinador" (no admin)
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ body: { ...bodyValido, rol: "admin" } }), res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/solo una cuenta con rol admin/i);
    });

    it("un actor admin SÍ puede crear una cuenta con rol admin", async () => {
      const fetchMock = makeFetchRouter([
        ["/user_profiles?id=eq.actor-1&select=rol", () => ({ ok: true, json: async () => [{ rol: "admin" }] })],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: { ...bodyValido, rol: "admin" } }), res);
      expect(res.statusCode).toBe(200);
    });

    it("camino feliz: crea en Auth, crea el perfil, registra programas y devuelve el user_id", async () => {
      const fetchMock = makeFetchRouter();
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: bodyValido }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.user_id).toBe("nuevo-user-id");

      const llamadaAuth = fetchMock.mock.calls.find(([url]) => String(url).includes("/auth/v1/admin/users") && String(url).endsWith("/admin/users"));
      expect(llamadaAuth).toBeTruthy();
      const llamadaProgramas = fetchMock.mock.calls.find(([url]) => String(url).includes("user_profiles_programas"));
      expect(llamadaProgramas).toBeTruthy();
    });

    it("si falla la creación del perfil, revierte (borra) el usuario de Auth ya creado", async () => {
      const fetchMock = makeFetchRouter([
        ["/rest/v1/user_profiles", (url) => {
          // Distinguir el POST de creación de perfil del POST de programas
          // (ambos matchean "/rest/v1/user_profiles" por substring, así
          // que aquí solo se intercepta la ruta exacta de user_profiles).
          if (String(url).endsWith("/rest/v1/user_profiles")) {
            return { ok: false, json: async () => ({ message: "email duplicado" }) };
          }
          return { ok: true, json: async () => ({}) };
        }],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: bodyValido }), res);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("email duplicado");
      const llamadaBorrarAuth = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes("/auth/v1/admin/users/nuevo-user-id") && opts?.method === "DELETE"
      );
      expect(llamadaBorrarAuth).toBeTruthy();
    });
  });

  describe("action: reset_password", () => {
    it("exige user_id y password", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ body: { action: "reset_password" } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("SEC-15: un actor NO-admin no puede resetear la contraseña de una cuenta admin", async () => {
      const fetchMock = makeFetchRouter([
        ["/user_profiles?id=eq.target-1&select=rol", () => ({ ok: true, json: async () => [{ rol: "admin" }] })],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: { action: "reset_password", user_id: "target-1", password: "Abcdefgh12" } }), res);
      expect(res.statusCode).toBe(403);
    });

    it("valida la contraseña nueva con las mismas reglas (SEC-5)", async () => {
      const fetchMock = makeFetchRouter([
        ["/user_profiles?id=eq.target-1&select=rol", () => ({ ok: true, json: async () => [{ rol: "coordinador" }] })],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: { action: "reset_password", user_id: "target-1", password: "corta" } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("camino feliz: llama al PUT de Auth Admin con la contraseña nueva", async () => {
      const fetchMock = makeFetchRouter([
        ["/user_profiles?id=eq.target-1&select=rol", () => ({ ok: true, json: async () => [{ rol: "coordinador" }] })],
        ["/auth/v1/admin/users/target-1", () => ({ ok: true, json: async () => ({}) })],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: { action: "reset_password", user_id: "target-1", password: "Abcdefgh12" } }), res);

      expect(res.statusCode).toBe(200);
      const llamada = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes("/auth/v1/admin/users/target-1") && opts?.method === "PUT"
      );
      expect(llamada).toBeTruthy();
    });
  });

  describe("action: delete", () => {
    it("exige user_id", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ body: { action: "delete" } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("no permite auto-eliminación", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ body: { action: "delete", user_id: "actor-1" } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/no puedes eliminar tu propia cuenta/i);
    });

    it("SEC-15: un actor NO-admin no puede eliminar una cuenta admin", async () => {
      const fetchMock = makeFetchRouter([
        ["/user_profiles?id=eq.target-1&select=rol", () => ({ ok: true, json: async () => [{ rol: "admin" }] })],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: { action: "delete", user_id: "target-1" } }), res);
      expect(res.statusCode).toBe(403);
    });

    it("camino feliz: borra el perfil y luego la cuenta de Auth", async () => {
      const fetchMock = makeFetchRouter([
        ["/user_profiles?id=eq.target-1&select=rol", () => ({ ok: true, json: async () => [{ rol: "coordinador" }] })],
        ["/rest/v1/user_profiles?id=eq.target-1", () => ({ ok: true, json: async () => ({}) })],
        ["/auth/v1/admin/users/target-1", () => ({ ok: true, json: async () => ({}) })],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: { action: "delete", user_id: "target-1" } }), res);

      expect(res.statusCode).toBe(200);
      const borroPerfil = fetchMock.mock.calls.some(
        ([url, opts]) => String(url).includes("/rest/v1/user_profiles?id=eq.target-1") && opts?.method === "DELETE"
      );
      const borroAuth = fetchMock.mock.calls.some(
        ([url, opts]) => String(url).includes("/auth/v1/admin/users/target-1") && opts?.method === "DELETE"
      );
      expect(borroPerfil).toBe(true);
      expect(borroAuth).toBe(true);
    });

    it("tolera 404 al borrar de Auth (perfil huérfano ya sin cuenta de Auth) sin devolver error", async () => {
      const fetchMock = makeFetchRouter([
        ["/user_profiles?id=eq.target-1&select=rol", () => ({ ok: true, json: async () => [{ rol: "coordinador" }] })],
        ["/rest/v1/user_profiles?id=eq.target-1", () => ({ ok: true, json: async () => ({}) })],
        ["/auth/v1/admin/users/target-1", () => ({ ok: false, status: 404, json: async () => ({}) })],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: { action: "delete", user_id: "target-1" } }), res);
      expect(res.statusCode).toBe(200);
    });
  });

  describe("action: delete_orphan", () => {
    it("no permite auto-eliminación", async () => {
      vi.stubGlobal("fetch", makeFetchRouter());
      const res = makeRes();
      await handler(makeReq({ body: { action: "delete_orphan", user_id: "actor-1" } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("borra directo de Auth sin consultar user_profiles (por diseño, es huérfano)", async () => {
      const fetchMock = makeFetchRouter([
        ["/auth/v1/admin/users/target-1", () => ({ ok: true, json: async () => ({}) })],
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const res = makeRes();
      await handler(makeReq({ body: { action: "delete_orphan", user_id: "target-1" } }), res);

      expect(res.statusCode).toBe(200);
      const consultoPerfil = fetchMock.mock.calls.some(([url]) => String(url).includes("user_profiles?id=eq.target-1"));
      expect(consultoPerfil).toBe(false);
    });
  });

  it("un error no capturado en cualquier punto responde 500 en vez de romper el proceso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const res = makeRes();
    await handler(makeReq({ body: { action: "create" } }), res);
    expect(res.statusCode).toBe(500);
  });
});
