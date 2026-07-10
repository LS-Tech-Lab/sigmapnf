// Fix #9: versión de esquema de caché.
// Al incrementar CACHE_SCHEMA_VERSION, todos los clientes invalidan
// automáticamente su caché de localStorage al siguiente fetch,
// evitando que datos con esquema viejo rompan la app silenciosamente.
import { logger } from "./logger";

const CACHE_SCHEMA_VERSION = 2;
const VERSION_KEY = "horarios_cache_schema_v";

export const CACHE_KEYS = {
  horarios: "horarios_cache",
  docentes: "docentes_cache",
  docenteCedulas: "docentes_cedulas_cache",
  materias: "materias_cache",
  lastSync: "horarios_last_sync",
};

export const CACHE_EXPIRY = 1000 * 60 * 30;            // 30 min — refresca en BG
export const CACHE_EXPIRY_OFFLINE = 1000 * 60 * 60 * 24; // 24 h  — fallback sin red

// Invalida el caché si la versión de esquema cambió.
// Se llama una vez al arrancar la app (desde useAppData).
export function validarVersionCache() {
  const storedVersion = parseInt(localStorage.getItem(VERSION_KEY) || "0");
  if (storedVersion !== CACHE_SCHEMA_VERSION) {
    limpiarCache();
    localStorage.setItem(VERSION_KEY, String(CACHE_SCHEMA_VERSION));
    logger.info(`[caché] Esquema actualizado a v${CACHE_SCHEMA_VERSION} — caché invalidado.`);
  }
}

// Genera la clave de caché con el userId del usuario activo.
// Esto aísla el caché por identidad: si el usuario B inicia sesión
// sin que A hiciera logout, B nunca lee el caché de A.
export function getCacheKey(baseKey, userId) {
  return userId ? `${baseKey}_u_${userId}` : baseKey;
}

export function guardarEnCache(key, datos, userId) {
  try {
    const storageKey = getCacheKey(key, userId);
    localStorage.setItem(storageKey, JSON.stringify({ timestamp: Date.now(), datos }));
  } catch (err) {
    logger.warn("No se pudo guardar en caché:", key, err);
  }
}

export function cargarDeCache(key, userId, { offlineMode = false } = {}) {
  try {
    const storageKey = getCacheKey(key, userId);
    const cacheStr = localStorage.getItem(storageKey);
    if (!cacheStr) return null;
    const cache = JSON.parse(cacheStr);
    const maxAge = offlineMode ? CACHE_EXPIRY_OFFLINE : CACHE_EXPIRY;
    if (Date.now() - cache.timestamp > maxAge) {
      // En modo offline no eliminamos — puede ser la única copia disponible
      if (!offlineMode) localStorage.removeItem(storageKey);
      return null;
    }
    return cache.datos;
  } catch (err) {
    logger.warn("Error al cargar caché:", key, err);
    return null;
  }
}

// Si se pasa userId, limpia solo las claves de ese usuario.
// Sin userId (ej: logout sin sesión activa) limpia todo lo que sea caché de la app.
export function limpiarCache(userId) {
  if (userId) {
    Object.values(CACHE_KEYS).forEach(key =>
      localStorage.removeItem(getCacheKey(key, userId))
    );
  } else {
    Object.values(CACHE_KEYS).forEach(key => localStorage.removeItem(key));
    // Limpiar también claves con sufijo de usuario (_u_*)
    Object.keys(localStorage)
      .filter(k => Object.values(CACHE_KEYS).some(base => k.startsWith(`${base}_u_`)))
      .forEach(k => localStorage.removeItem(k));
  }
}

export function obtenerUltimaSincronizacion() {
  try {
    const ts = localStorage.getItem(CACHE_KEYS.lastSync);
    return ts ? new Date(parseInt(ts)).toLocaleString() : "Nunca";
  } catch {
    return "Desconocido";
  }
}
