// Cola offline para registros de asistencia.
// Usa IndexedDB para persistir las marcas cuando no hay red,
// y las sincroniza con Supabase al recuperar la conexión.
//
// Fix OFF-2: TTL de 48 h para evitar crecimiento indefinido.
// Los registros más viejos se purgan automáticamente al abrir la cola.

import { abrirDBCompartida } from './idb';

const STORE = 'asistencias_pendientes';

// 48 horas en ms — registros más antiguos se purgan automáticamente
const TTL_MS = 48 * 60 * 60 * 1000;

// Fix ARCH-1 (auditoría 2026-06-30): la apertura de la base 'sigma_offline'
// ahora vive centralizada en idb.js, para evitar conflictos de versión
// con pinOffline.js y reporteCache.js. Ver idb.js para el detalle.
function abrirDB() {
  return abrirDBCompartida();
}

export async function encolarAsistencia(payload) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).add({ ...payload, creadoEn: Date.now() });
  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
}

export async function obtenerPendientes() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readonly');
  return new Promise((res, rej) => {
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function eliminarPendiente(id) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
}

export async function contarPendientes() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readonly');
  return new Promise((res, rej) => {
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// Fix OFF-2: eliminar registros cuyo TTL haya vencido (>48 h).
// Llamado desde useSyncPendientes antes de cada ciclo de sync.
export async function purgarExpirados() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const cutoff = Date.now() - TTL_MS;
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => {
      let purgados = 0;
      req.result.forEach(item => {
        if (item.creadoEn && item.creadoEn < cutoff) {
          store.delete(item.id);
          purgados++;
        }
      });
      tx.oncomplete = () => res(purgados);
      tx.onerror    = () => rej(tx.error);
    };
    req.onerror = () => rej(req.error);
  });
}
