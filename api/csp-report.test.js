// api/csp-report.test.js
// SEC-24 (auditoría QA del 15 de julio): cobertura del endpoint receptor
// de reportes de violación de CSP. Se invoca `handler` directamente con
// un req/res mínimos (mismo enfoque que usaría cualquier función
// serverless de Vercel en Node), sin levantar un servidor HTTP real.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function makeReq({ method = "POST", headers = {}, bodyChunks = [], remoteAddress = "1.2.3.4" } = {}) {
  return {
    method,
    headers: { host: "sigmapnf.vercel.app", ...headers },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      for (const chunk of bodyChunks) yield Buffer.from(chunk);
    },
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; },
  };
  return res;
}

describe("api/csp-report — parseo y persistencia de reportes CSP", () => {
  let handler;

  beforeEach(async () => {
    vi.resetModules();
    process.env.VITE_SUPABASE_URL = "https://proyecto.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
    ({ default: handler } = await import("./csp-report.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("rechaza métodos distintos de POST", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("acepta un reporte formato report-uri (legado) y lo inserta en audit_logs vía REST con service role", async () => {
    const reporte = {
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "https://evil.example.com/x.js",
        "document-uri": "https://sigmapnf.vercel.app/login",
      },
    };
    const req = makeReq({ bodyChunks: [JSON.stringify(reporte)] });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(fetch).toHaveBeenCalledWith(
      "https://proyecto.supabase.co/rest/v1/audit_logs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer service-role-test-key",
          apikey: "service-role-test-key",
        }),
      })
    );
    const sentBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sentBody.accion).toBe("CSP_VIOLATION");
    expect(sentBody.entidad).toBe("csp_report");
    expect(sentBody.entidad_id).toBe("https://sigmapnf.vercel.app/login");
    expect(sentBody.resumen).toContain("script-src");
    expect(sentBody.resumen).toContain("https://evil.example.com/x.js");
  });

  it("acepta un reporte formato report-to (Reporting API moderna)", async () => {
    const reporte = [
      {
        type: "csp-violation",
        body: {
          violatedDirective: "style-src",
          blockedURL: "inline",
          documentURL: "https://sigmapnf.vercel.app/",
        },
      },
    ];
    const req = makeReq({ bodyChunks: [JSON.stringify(reporte)] });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    const sentBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sentBody.resumen).toContain("style-src");
    expect(sentBody.resumen).toContain("inline");
  });

  it("descarta silenciosamente (204) un payload con forma desconocida, sin insertar nada", async () => {
    const req = makeReq({ bodyChunks: [JSON.stringify({ algo: "no es un reporte CSP" })] });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("descarta silenciosamente un body no-JSON en vez de romper", async () => {
    const req = makeReq({ bodyChunks: ["esto no es json{{{"] });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechaza (204, sin insertar) si el Origin no coincide con el host", async () => {
    const reporte = { "csp-report": { "violated-directive": "script-src", "blocked-uri": "x" } };
    const req = makeReq({
      headers: { origin: "https://sitio-atacante.com" },
      bodyChunks: [JSON.stringify(reporte)],
    });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aplica rate limit best-effort por IP: la request número 21 en la ventana se descarta", async () => {
    const reporte = { "csp-report": { "violated-directive": "script-src", "blocked-uri": "x" } };

    for (let i = 0; i < 20; i++) {
      const req = makeReq({ headers: { "x-forwarded-for": "9.9.9.9" }, bodyChunks: [JSON.stringify(reporte)] });
      await handler(req, makeRes());
    }
    expect(fetch).toHaveBeenCalledTimes(20);

    const req21 = makeReq({ headers: { "x-forwarded-for": "9.9.9.9" }, bodyChunks: [JSON.stringify(reporte)] });
    const res21 = makeRes();
    await handler(req21, res21);

    expect(res21.statusCode).toBe(204);
    expect(fetch).toHaveBeenCalledTimes(20); // no creció: la 21ª no llegó a insertar

    // Una IP distinta no comparte el contador.
    const reqOtraIp = makeReq({ headers: { "x-forwarded-for": "8.8.8.8" }, bodyChunks: [JSON.stringify(reporte)] });
    await handler(reqOtraIp, makeRes());
    expect(fetch).toHaveBeenCalledTimes(21);
  });

  it("si faltan las variables de entorno de Supabase, responde 204 sin lanzar (no rompe el navegador reportante)", async () => {
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
    ({ default: handler } = await import("./csp-report.js"));

    const reporte = { "csp-report": { "violated-directive": "script-src", "blocked-uri": "x" } };
    const req = makeReq({ bodyChunks: [JSON.stringify(reporte)] });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });
});
