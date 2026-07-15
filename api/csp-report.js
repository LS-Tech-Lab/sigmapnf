// api/csp-report.js
// Vercel Serverless Function — receptor de `report-to`/`report-uri` de la
// Content-Security-Policy (ver vercel.json). Sin esto, una directiva CSP
// violada en producción (ej. un script bloqueado que no debía estarlo)
// no deja ningún rastro: el navegador la descarta en su consola local y
// nadie del equipo se entera. Fix SEC-24 (auditoría QA del 15 de julio).
//
// Diseño (a diferencia de api/admin-users.js):
//   · Endpoint público e intencionalmente sin autenticación — el propio
//     navegador de CUALQUIER visitante lo llama automáticamente ni bien
//     detecta una violación, incluso antes del login (ej. en la pantalla
//     de LoginScreen). No tiene sentido exigir sesión.
//   · Por eso NO usa la RPC `log_audit_event` (requiere `auth.uid()` de
//     una sesión autenticada — ver migración 0024). Se inserta
//     directamente en `audit_logs` vía REST con la Service Role Key,
//     igual patrón que el resto de `admin-users.js`, pero la Service
//     Role Key bypasea RLS por sí misma: no hace falta una RPC
//     SECURITY DEFINER para esto.
//   · Justamente por ser público, la superficie de abuso es mayor que la
//     de admin-users.js (cualquiera puede mandar POSTs falsos). Se
//     mitiga con: (a) límite de tamaño de payload, (b) validación mínima
//     de forma del reporte, (c) rate limit best-effort por IP en memoria
//     del proceso — ver nota de limitación en `chequearRateLimit`.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Tope de tamaño de body aceptado. Un reporte CSP real (`csp-report` o
// `reports+json`) mide unos pocos cientos de bytes; algo mucho más grande
// no es un reporte legítimo del navegador.
const MAX_BODY_BYTES = 20_000;

// ── Rate limit best-effort por IP ─────────────────────────────────────
// Nota de limitación (documentar, no ocultar): esto vive en memoria del
// proceso de la función serverless. Vercel puede levantar múltiples
// instancias en paralelo y reciclarlas entre invocaciones (cold start),
// así que NO es un límite global ni persistente — es una mitigación
// barata contra un mismo visitante/bot machacando el endpoint dentro de
// una misma instancia caliente, no una defensa dura contra abuso
// distribuido. Para eso se necesitaría una RPC contadora en Postgres
// (mismo patrón que `registrar_admin_action_rate_limit`, SEC-16), fuera
// de alcance de este fix porque implica una migración nueva — ver nota
// en AUDITORIA_INDICE.md.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const hits = new Map(); // ip -> [timestamps]

function chequearRateLimit(ip) {
  const ahora = Date.now();
  const previas = (hits.get(ip) || []).filter(t => ahora - t < RATE_LIMIT_WINDOW_MS);
  previas.push(ahora);
  hits.set(ip, previas);
  // Poda ocasional para no acumular IPs viejas indefinidamente en memoria.
  if (hits.size > 5000) {
    for (const [k, arr] of hits) {
      if (arr.every(t => ahora - t >= RATE_LIMIT_WINDOW_MS)) hits.delete(k);
    }
  }
  return previas.length <= RATE_LIMIT_MAX;
}

function truncar(str, max) {
  if (typeof str !== "string") return null;
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// Los dos formatos que emiten los navegadores:
//   · `report-uri` (legado):     { "csp-report": { "violated-directive": ..., "blocked-uri": ..., ... } }
//   · `report-to` (Reporting API): [{ type: "csp-violation", body: { violatedDirective, blockedURL, ... } }, ...]
function normalizarReporte(payload) {
  if (payload && typeof payload === "object" && payload["csp-report"]) {
    const r = payload["csp-report"];
    return {
      directiva:   truncar(r["violated-directive"] || r["effective-directive"], 200),
      bloqueado:   truncar(r["blocked-uri"], 500),
      documento:   truncar(r["document-uri"], 500),
      original:    r,
    };
  }
  if (Array.isArray(payload) && payload[0]?.body) {
    const r = payload[0].body;
    return {
      directiva:   truncar(r.violatedDirective || r.effectiveDirective, 200),
      bloqueado:   truncar(r.blockedURL, 500),
      documento:   truncar(r.documentURL, 500),
      original:    r,
    };
  }
  return null;
}

// Los navegadores mandan estos reportes con `Content-Type:
// application/csp-report` o `application/reports+json` — no
// `application/json`, que es el único tipo que el body-parser
// automático de Vercel reconoce con certeza. Se desactiva y se lee/
// parsea el body a mano para no depender de esa detección.
export const config = { api: { bodyParser: false } };

async function leerBodyJSON(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) return null; // corta temprano, ver handleRequest
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    return await handleRequest(req, res);
  } catch (err) {
    console.error("[api/csp-report] Error no capturado:", err);
    // Responder 204 igual: nunca hay que hacer que el navegador reintente
    // el envío de un reporte CSP por un error interno nuestro.
    return res.status(204).end();
  }
}

async function handleRequest(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  // Mismo criterio que SEC-19 en admin-users.js: solo rechazar si Origin
  // vino Y no coincide (algunos navegadores no lo mandan en este tipo de
  // request automática, y no es indicio de ataque que falte).
  const origin = req.headers.origin;
  if (origin && origin.replace(/^https?:\/\//, "") !== req.headers.host) {
    return res.status(204).end();
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "desconocida";
  if (!chequearRateLimit(ip)) {
    return res.status(204).end();
  }

  const body = await leerBodyJSON(req);
  const reporte = normalizarReporte(body);
  if (!reporte) {
    // Body ausente/demasiado grande/no-JSON, o con forma inesperada —
    // no es un reporte CSP real conocido.
    return res.status(204).end();
  }

  const resumen = `CSP: directiva "${reporte.directiva || "desconocida"}" bloqueó "${reporte.bloqueado || "recurso desconocido"}"`;

  if (SUPABASE_URL && SERVICE_ROLE_KEY) {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/audit_logs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        accion:  "CSP_VIOLATION",
        entidad: "csp_report",
        entidad_id: reporte.documento || null,
        resumen,
        datos_despues: reporte.original,
      }),
    });
    if (!insertRes.ok) {
      console.error("[api/csp-report] No se pudo insertar en audit_logs:", await insertRes.text());
    }
  } else {
    // Variables de entorno de Supabase ausentes (ej. entorno de preview
    // mal configurado): no romper el reporte del navegador, solo dejar
    // rastro en los logs de la función.
    console.error("[api/csp-report] Faltan variables de entorno de Supabase — reporte no persistido:", resumen);
  }

  // 204 siempre en el camino feliz: es lo que el navegador espera de un
  // endpoint de reporting, no hay contenido que devolver.
  return res.status(204).end();
}
