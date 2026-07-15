// idb.js
// ─────────────────────────────────────────────────────────────────────────────
// Fix ARCH-1 (auditoría SIGMA PNF 2026-06-30): punto ÚNICO de apertura de la
// base de datos IndexedDB compartida 'sigma_offline'.
//
// Antes de este fix, tres módulos abrían la misma base cada uno con su
// propio número de versión y su propio onupgradeneeded parcial:
//   - offlineQueue.js  → DB_VER 1 (solo 'asistencias_pendientes')
//   - reporteCache.js  → DB_VER 4 (+ 'reportes_asistencias', 'ausentes_cache',
//                                   'pin_offline')
//   - pinOffline.js    → DB_VER 6 (+ 'pin_lockout', 'login_lockout')
//
// IndexedDB no permite abrir una base con una versión MENOR a la ya
// establecida por otra llamada previa: si pinOffline.js (v6) se ejecutaba
// primero, cualquier llamada posterior de offlineQueue.js (v1) o
// reporteCache.js (v4) fallaba con VersionError, dejando la cola offline
// o el caché de reportes inoperativos según el orden de carga —
// un fallo intermitente y difícil de reproducir en QA manual.
//
// Este módulo centraliza la versión (la más alta de las tres, 6) y crea
// TODOS los object stores en un único onupgradeneeded, sin cambiar el
// nombre de la base ni el de ningún store existente. offlineQueue.js,
// pinOffline.js y reporteCache.js delegan aquí su apertura de conexión,
// conservando el resto de su lógica intacta.
// ─────────────────────────────────────────────────────────────────────────────

export const DB_NAME = 'sigma_offline';
export const DB_VER  = 6; // = versión más alta previamente usada (pinOffline.js)

/**
 * Abre (o crea/actualiza) la base compartida 'sigma_offline', garantizando
 * que existan todos los object stores usados por los tres módulos.
 * No cachea la conexión entre llamadas — mismo patrón que ya usaba cada
 * módulo por separado, para no alterar el comportamiento existente
 * (incluido el aislamiento de tests con fake-indexeddb).
 */
export function abrirDBCompartida() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('asistencias_pendientes'))
        db.createObjectStore('asistencias_pendientes', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('reportes_asistencias'))
        db.createObjectStore('reportes_asistencias', { keyPath: 'clave' });
      if (!db.objectStoreNames.contains('ausentes_cache'))
        db.createObjectStore('ausentes_cache', { keyPath: 'clave' });
      if (!db.objectStoreNames.contains('pin_offline'))
        db.createObjectStore('pin_offline', { keyPath: 'userId' });
      if (!db.objectStoreNames.contains('pin_lockout'))
        db.createObjectStore('pin_lockout', { keyPath: 'userId' });
      if (!db.objectStoreNames.contains('login_lockout'))
        db.createObjectStore('login_lockout', { keyPath: 'email' });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
