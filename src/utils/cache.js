export const CACHE_KEYS = {
  horarios: "horarios_cache",
  docentes: "docentes_cache",
  materias: "materias_cache",
  lastSync: "horarios_last_sync",
};

export const CACHE_EXPIRY = 1000 * 60 * 30; // 30 minutos

export function guardarEnCache(key, datos) {
  try {
    const cache = {
      timestamp: Date.now(),
      datos: datos,
    };
    localStorage.setItem(key, JSON.stringify(cache));
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
