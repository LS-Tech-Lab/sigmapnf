// manualAttendanceQueue.js
// ─────────────────────────────────────────────────────────────────────────
// FIX OFF-10 (opción C — respaldo manual): cola independiente de
// offlineQueue.js para registros de asistencia sin token/sesión QR. Se usa
// cuando crearSesion() reporta requiereModoManual=true (offline y sin
// ninguna sesión pre-generada disponible para el contexto actual — ver
// useQRSession.js).
//
// Separada de asistencias_pendientes/offlineQueue.js a propósito: estos
// registros sincronizan contra un RPC distinto (registrar_asistencia_manual,
// migración 0071) que espera campos distintos (sin p_token, con p_fecha/
// p_turno/p_sede_id explícitos porque no hay sesión de la que heredarlos).
// Mezclarlos en una sola cola habría obligado a useSyncPendientes.js a
// bifurcar la lógica de sync por forma del objeto en vez de por store —
// más frágil y más difícil de purgar/inspeccionar por separado.
//
// Mismo patrón de API y mismo evento de cambio que offlineQueue.js, para
// que cualquier UI que ya escuche 'sigma:cola-offline-cambio' siga
// funcionando sin cambios (ColaOfflinePanel puede sumar esta cola a su
// conteo total si se decide unificar la vista más adelante).

import { abrirDBCompartida } from './idb';

const STORE = 'asistencias_manuales_pendientes';
const EVENTO_CAMBIO = 'sigma:cola-offline-manual-cambio';

// Mismo TTL que la cola normal (OFF-2): 48h antes de purgar automáticamente.
const TTL_MS = 48 * 60 * 60 * 1000;

function abrirDB() {
  return abrirDBCompartida();
}

function notificarCambio() {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO));
  } catch {
    // Ver mismo comentario en offlineQueue.js — no crítico.
  }
}

// payload esperado: { cedula, nombre, tipo, turno, programa, fecha, sede_id }
export async function encolarAsistenciaManual(payload) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).add({ ...payload, creadoEn: Date.now() });
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
  notificarCambio();
}

export async function obtenerPendientesManuales() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readonly');
  return new Promise((res, rej) => {
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function eliminarPendienteManual(id) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
  notificarCambio();
}

export async function contarPendientesManuales() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readonly');
  return new Promise((res, rej) => {
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function purgarExpiradosManuales() {
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
