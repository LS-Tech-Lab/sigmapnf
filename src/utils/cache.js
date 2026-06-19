// Fix #9: versión de esquema de caché.
// Al incrementar CACHE_SCHEMA_VERSION, todos los clientes invalidan
// automáticamente su caché de localStorage al siguiente fetch,
// evitando que datos con esquema viejo rompan la app silenciosamente.
const CACHE_SCHEMA_VERSION = 2;
const VERSION_KEY = "horarios_cache_schema_v";

export const CACHE_KEYS = {
  horarios: "horarios_cache",
  docentes: "docentes_cache",
  docenteCedulas: "docentes_cedulas_cache",
  materias: "materias_cache",
  lastSync: "horarios_last_sync",
};

export const CACHE_EXPIRY = 1000 * 60 * 30; // 30 minutos

// Invalida el caché si la versión de esquema cambió.
// Se llama una vez al arrancar la app (desde useAppData).
export function validarVersionCache() {
  const storedVersion = parseInt(localStorage.getItem(VERSION_KEY) || "0");
  if (storedVersion !== CACHE_SCHEMA_VERSION) {
    limpiarCache();
    localStorage.setItem(VERSION_KEY, String(CACHE_SCHEMA_VERSION));
    console.info(`[caché] Esquema actualizado a v${CACHE_SCHEMA_VERSION} — caché invalidado.`);
  }
}

export function guardarEnCache(key, datos) {
  try {
    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), datos }));
  } catch (err) {
    console.warn("No se pudo guardar en caché:", key, err);
  }
}

export function cargarDeCache(key) {
  try {
    const cacheStr = localStorage.getItem(key);
    if (!cacheStr) return null;
    const cache = JSON.parse(cacheStr);
    if (Date.now() - cache.timestamp > CACHE_EXPIRY) {
      localStorage.removeItem(key);
      return null;
    }
    return cache.datos;
  } catch (err) {
    console.warn("Error al cargar caché:", key, err);
    return null;
  }
}

export function limpiarCache() {
  Object.values(CACHE_KEYS).forEach(key => localStorage.removeItem(key));
}

export function obtenerUltimaSincronizacion() {
  try {
    const ts = localStorage.getItem(CACHE_KEYS.lastSync);
    return ts ? new Date(parseInt(ts)).toLocaleString() : "Nunca";
  } catch {
    return "Desconocido";
  }
}
