// src/utils/diagnosticoColgadas.js
//
// DIAG-1: instrumentación temporal para detectar consultas/RPCs a Supabase
// que se quedan "colgadas" (la promesa nunca resuelve).
//
// Contexto: reporte de que la app se congela sin patrón de menú fijo, y
// que recargar (F5) NO libera el colgado -- solo cerrar la pestaña y
// abrir una nueva. Eso último es la pista clave: un colgado "normal" de
// JS (loop, estado roto) se limpia con F5. Que sobreviva al F5 apunta a
// que el propio Service Worker (vite-plugin-pwa, estrategia NetworkFirst
// para el endpoint de Supabase) está esperando esa misma petición de red
// que nunca responde -- y F5 vuelve a pasar por el mismo SW atascado.
//
// Como no es reproducible a demanda, en vez de adivinar se instrumenta:
// instrumentarSupabase() envuelve supabase.from()/rpc() para que, si una
// consulta tarda más de UMBRAL_MS sin resolver, quede un registro en la
// tabla logs_diagnostico (migración 0095) con tabla/función, ms
// transcurridos y ruta -- así la próxima vez que alguien reporte "se
// colgó", hay evidencia concreta de cuál fue la consulta.
//
// El registro se envía con `fetch` directo al REST de Supabase (no a
// través del cliente `supabase` ya envuelto) para no depender de la
// misma conexión que podría estar colgada, y con `keepalive: true` para
// que sobreviva aunque el usuario cierre la pestaña justo después de
// que se dispare el umbral.
//
// Es diagnóstico, no una feature permanente: una vez identificada la
// causa raíz, se puede quitar esta instrumentación (y la tabla).

import { logger } from './logger';

const UMBRAL_MS = 8000;

function idUsuarioActual() {
  try {
    const clave = Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (!clave) return null;
    return JSON.parse(localStorage.getItem(clave))?.user?.id ?? null;
  } catch {
    return null; // best-effort -- si falla, se registra sin usuario
  }
}

/**
 * Envía un evento de diagnóstico a la tabla logs_diagnostico vía REST
 * directo (bypass del cliente supabase). No lanza si falla: el warn en
 * consola ya quedó registrado antes de llamar a esta función.
 */
export function registrarEventoDiagnostico(tipo, detalle = {}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return;

  const body = JSON.stringify({
    tipo,
    detalle: {
      ...detalle,
      ruta: typeof window !== 'undefined' ? window.location.pathname : null,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    },
    usuario_id: idUsuarioActual(),
  });

  fetch(`${supabaseUrl}/rest/v1/logs_diagnostico`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      Prefer: 'return=minimal',
    },
    body,
    keepalive: true,
  }).catch(() => {
    // si el POST también falla/cuelga, ya quedó el warn en consola
  });
}

function registrarColgada(tipo, nombre, ms) {
  logger.warn(`[diagnostico] posible colgada: ${tipo} "${nombre}" (${ms}ms sin resolver)`);
  registrarEventoDiagnostico(`${tipo}_colgada`, { nombre, ms });
}

/**
 * Envuelve un query/filter builder thenable de supabase-js para detectar
 * si tarda más de UMBRAL_MS en resolver, sin alterar su comportamiento
 * (sigue siendo awaitable igual; los métodos de filtro que retornan
 * `this` conservan el .then ya parchado).
 */
function envolverConTimeout(builder, tipo, nombre) {
  if (!builder || typeof builder.then !== 'function') return builder;

  const thenOriginal = builder.then.bind(builder);
  const inicio = Date.now();
  let resuelto = false;

  const timeoutId = setTimeout(() => {
    if (!resuelto) registrarColgada(tipo, nombre, Date.now() - inicio);
  }, UMBRAL_MS);

  builder.then = (onFulfilled, onRejected) =>
    thenOriginal(
      (valor) => {
        resuelto = true;
        clearTimeout(timeoutId);
        return onFulfilled?.(valor);
      },
      (error) => {
        resuelto = true;
        clearTimeout(timeoutId);
        if (onRejected) return onRejected(error);
        throw error;
      }
    );

  return builder;
}

function envolverQueryBuilder(queryBuilder, tabla) {
  for (const metodo of ['select', 'insert', 'update', 'upsert', 'delete']) {
    const original = queryBuilder[metodo]?.bind(queryBuilder);
    if (!original) continue;
    queryBuilder[metodo] = (...args) => envolverConTimeout(original(...args), 'query', tabla);
  }
  return queryBuilder;
}

/**
 * Parchea supabase.from()/rpc() in-place para que toda consulta/RPC de
 * la app quede instrumentada automáticamente, sin tocar los ~cientos de
 * call sites existentes. Llamar una sola vez, justo después de crear el
 * cliente (ver src/lib/supabase.js).
 */
export function instrumentarSupabase(supabase) {
  const fromOriginal = supabase.from.bind(supabase);
  supabase.from = (tabla) => envolverQueryBuilder(fromOriginal(tabla), tabla);

  const rpcOriginal = supabase.rpc.bind(supabase);
  supabase.rpc = (fn, args, opciones) => envolverConTimeout(rpcOriginal(fn, args, opciones), 'rpc', fn);

  return supabase;
}
