// src/utils/fetchWithRetry.js
//
// Fix ARCH-45 (auditoría E2E, 18 de agosto de 2026): ante latencia de red
// sostenida (>2000ms) o una caída intermitente de conexión, `useDataSync.js`/
// `useQRSession.js` no reintentaban -- un solo fallo de fetch caía directo a
// "usar caché"/mensaje de error, aunque la red se hubiera recuperado un
// segundo después. El patrón correcto (fallback controlado ante fallo de
// red) ya existía en `api/csp-report.js` (OFF-9) pero nunca se generalizó a
// las llamadas normales de datos. Este helper lo centraliza para reusarlo
// donde haga falta, sin duplicar la lógica de backoff en cada hook.
//
// Deliberadamente NO reintenta:
//  - Abortos intencionales (AbortController.abort(), cambio de programa/
//    lapso o desmonte del componente) -- reintentar algo que el propio
//    código canceló a propósito sería un bug, no resiliencia.
//  - Errores devueltos por Postgres/PostgREST (permisos, RLS, validación,
//    constraint) -- son fallos PERMANENTES: el mismo request fallará igual
//    la próxima vez, reintentarlo solo demora el error real que el usuario
//    necesita ver. Estos ya pasan por `mensajeAmigable()` (SEC-38) en el
//    llamador, sin tocar este helper.
//
// SÍ reintenta: errores que indican un problema de transporte, no de
// contenido -- `TypeError` (el patrón real de "fetch" al fallar la red en
// navegadores), o mensajes que apuntan a timeout/desconexión.

/**
 * Determina si un error es candidato a reintento (fallo de red transitorio)
 * en vez de un fallo permanente (permisos, validación, datos).
 * @param {unknown} err
 * @returns {boolean}
 */
export function esErrorDeRed(err) {
  if (!err) return false;
  if (err.name === "AbortError") return false; // abort intencional, nunca reintentar
  // Los errores de PostgREST/Postgres traen `code` (ej. "PGRST116", "42501",
  // "23505") -- son la señal más confiable de "esto es un rechazo del
  // servidor, no un fallo de transporte". Si viene con code, no es de red.
  if (err.code) return false;
  const msg = String(err.message || "").toLowerCase();
  return (
    err instanceof TypeError || // "Failed to fetch" / "Load failed" — fetch no llegó a completarse
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("conexión")
  );
}

/**
 * Ejecuta `fn` con reintentos y backoff exponencial, pero solo ante fallos
 * de red transitorios (ver `esErrorDeRed`). `fn` puede lanzar una excepción
 * o devolver `{ data, error }` (forma habitual del cliente de Supabase) --
 * ambas formas se manejan igual.
 *
 * @param {() => Promise<any>} fn
 * @param {{ intentos?: number, baseMs?: number, onReintento?: (info: { intento: number, err: unknown }) => void }} [opts]
 * @returns {Promise<any>} el resultado de `fn()` (o su excepción) tal cual,
 *   en el último intento -- este helper no cambia la forma de la respuesta.
 */
export async function conReintento(fn, opts = {}) {
  const { intentos = 3, baseMs = 500, onReintento } = opts;
  let ultimoResultado;
  let ultimoError;

  for (let intento = 0; intento < intentos; intento++) {
    try {
      const resultado = await fn();
      const err = resultado?.error;
      if (!err || !esErrorDeRed(err)) return resultado;
      ultimoResultado = resultado;
      ultimoError = err;
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      ultimoError = err;
      ultimoResultado = undefined;
    }

    const esUltimoIntento = intento === intentos - 1;
    if (esUltimoIntento) break;

    onReintento?.({ intento: intento + 1, err: ultimoError });
    await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** intento));
  }

  if (ultimoResultado !== undefined) return ultimoResultado;
  throw ultimoError;
}
