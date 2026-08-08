// qrOfflineCache.js
// ─────────────────────────────────────────────────────────────────────────
// FIX OFF-10 (opción A — pre-generación): mientras hay red, AdminQRPanel
// puede "preparar" sesiones QR para los turnos restantes del día llamando
// a crear_qr_session igual que hoy, pero además cacheando el resultado
// (session_id, token, expires_at) en IndexedDB. Si más tarde el corte
// eléctrico llega justo cuando toca iniciar ese turno, useQRSession activa
// la sesión cacheada localmente en vez de bloquear el botón — sin llamar
// al RPC, sin bypassear ningún chequeo de permiso/sede (esos ya se
// corrieron en el servidor en el momento de la pre-generación, con
// conexión real).
//
// Clave de caché: fecha + turno + programa + sede, igual al criterio de
// "mismo contexto" que usa crear_qr_session para desactivar sesiones
// previas — así una sesión cacheada nunca se ofrece para un contexto
// distinto al que fue generada.
//
// Depende de EXPIRY_TTL_MINUTES (useQRSession.js) siendo generoso (6h):
// una sesión pre-generada a las 7am para el turno Vespertino (1pm) sigue
// viva si el corte empieza a las 10am, porque expires_at ya viene con
// margen de horas, no de minutos.

import { abrirDBCompartida } from './idb';

const STORE = 'qr_sesiones_offline_cache';

function abrirDB() {
  return abrirDBCompartida();
}

function claveDe({ fecha, turno, programa, sede_id }) {
  return `${fecha}__${turno}__${programa || ''}__${sede_id || ''}`;
}

// Guarda (o reemplaza) la sesión pre-generada para este contexto.
export async function guardarSesionCacheada({ fecha, turno, programa, sede_id, sessionId, token, expiresAt }) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({
    clave: claveDe({ fecha, turno, programa, sede_id }),
    fecha, turno, programa: programa || null, sede_id: sede_id || null,
    sessionId, token, expiresAt,
    cacheadoEn: Date.now(),
  });
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
}

// Busca una sesión cacheada vigente (no vencida) para el contexto dado.
// Devuelve null si no hay ninguna, o si la que hay ya expiró (no la borra
// acá — eso lo hace purgarVencidas, para no mezclar lectura con side effects).
export async function buscarSesionCacheada({ fecha, turno, programa, sede_id }) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readonly');
  const item = await new Promise((res, rej) => {
    const req = tx.objectStore(STORE).get(claveDe({ fecha, turno, programa, sede_id }));
    req.onsuccess = () => res(req.result || null);
    req.onerror   = () => rej(req.error);
  });
  if (!item) return null;
  if (new Date(item.expiresAt) <= new Date()) return null;
  return item;
}

// Todas las sesiones cacheadas para hoy (para mostrar en la UI qué turnos
// ya están preparados, con su hora de vencimiento).
export async function listarSesionesCacheadas(fecha) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readonly');
  const todas = await new Promise((res, rej) => {
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
  return todas.filter(item => item.fecha === fecha);
}

// Elimina entradas vencidas o de días anteriores — llamar al abrir el
// panel, mismo patrón que purgarExpirados() en offlineQueue.js.
export async function purgarSesionesCacheadasVencidas() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const ahora = new Date();
  const purgadas = await new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => {
      let n = 0;
      req.result.forEach(item => {
        if (new Date(item.expiresAt) <= ahora) {
          store.delete(item.clave);
          n++;
        }
      });
      tx.oncomplete = () => res(n);
      tx.onerror    = () => rej(tx.error);
    };
    req.onerror = () => rej(req.error);
  });
  return purgadas;
}

export async function eliminarSesionCacheada({ fecha, turno, programa, sede_id }) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(claveDe({ fecha, turno, programa, sede_id }));
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
}
