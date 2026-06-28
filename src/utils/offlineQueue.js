// Cola offline para registros de asistencia.
// Usa IndexedDB para persistir las marcas cuando no hay red,
// y las sincroniza con Supabase al recuperar la conexión.

const DB_NAME  = 'sigma_offline';
const STORE    = 'asistencias_pendientes';
const DB_VER   = 1;

function abrirDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e =>
      e.target.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
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
