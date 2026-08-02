// Cola offline para registros de asistencia.
// Usa IndexedDB para persistir las marcas cuando no hay red,
// y las sincroniza con Supabase al recuperar la conexión.
//
// Fix OFF-2: TTL de 48 h para evitar crecimiento indefinido.
// Los registros más viejos se purgan automáticamente al abrir la cola.
//
// Fix UX-25 (auditoría 2 ago): se agrega un evento DOM liviano
// ('sigma:cola-offline-cambio') disparado cada vez que la cola cambia de
// tamaño (encolar, eliminar, purgar). No lleva payload — cualquier UI
// interesada (ver Shell.jsx en DocenteScan) simplemente vuelve a leer
// contarPendientes() al recibirlo, en vez de hacer polling constante.

import { abrirDBCompartida } from './idb';

const STORE = 'asistencias_pendientes';
const EVENTO_CAMBIO = 'sigma:cola-offline-cambio';

// 48 horas en ms — registros más antiguos se purgan automáticamente
const TTL_MS = 48 * 60 * 60 * 1000;

// Fix ARCH-1 (auditoría 2026-06-30): la apertura de la base 'sigma_offline'
// ahora vive centralizada en idb.js, para evitar conflictos de versión
// con pinOffline.js y reporteCache.js. Ver idb.js para el detalle.
function abrirDB() {
  return abrirDBCompartida();
}

function notificarCambio() {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO));
  } catch {
    // dispatchEvent no disponible (ej. entorno de test sin window real
    // configurado) — no es crítico, la UI que dependa de esto simplemente
    // no se refresca en tiempo real, sin romper el resto del flujo.
  }
}

export async function encolarAsistencia(payload) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).add({ ...payload, creadoEn: Date.now() });
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
  notificarCambio();
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
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
  notificarCambio();
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
  const purgados = await new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => {
      let n = 0;
      req.result.forEach(item => {
        if (item.creadoEn && item.creadoEn < cutoff) {
          store.delete(item.id);
          n++;
        }
      });
      tx.oncomplete = () => res(n);
      tx.onerror    = () => rej(tx.error);
    };
    req.onerror = () => rej(req.error);
  });
  if (purgados > 0) notificarCambio();
  return purgados;
}
