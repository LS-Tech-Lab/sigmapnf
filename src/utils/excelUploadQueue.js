// excelUploadQueue.js
// ─────────────────────────────────────────────────────────────────────────
// FIX OFF-12 (auditoría de estrés operacional, 10 de agosto): a diferencia
// de la carga de asistencia (OFF-10/11, con cola offline completa), la
// carga de horarios por Excel (useUpload.js) no tenía ninguna ruta de
// recuperación ante un corte de red a mitad del proceso. Bajo las mismas
// condiciones de despliegue real ya documentadas para OFF-10 (cortes
// eléctricos de varias horas), un coordinador de sede que sube un Excel
// de horarios y pierde conexión durante el insert final se queda sin
// saber si 0, algunas o todas las filas se guardaron, y sin ningún
// mecanismo para reintentar salvo re-seleccionar el archivo desde cero.
//
// Por qué esto NO es una cola offline "completa" como manualAttendanceQueue.js:
// la carga de Excel no es un único RPC con payload fijo — implica resolver
// docente_id/materia_id contra el catálogo vigente en BD (useUpload.js,
// pasos "Resolver docente_id/materia_id"), lo cual solo puede hacerse con
// red disponible. Poner en cola el INSERT ya resuelto sería peligroso: el
// catálogo pudo cambiar entre el corte y el reintento (un docente
// unificado, una materia renombrada), y reintentar con IDs viejos
// insertaría datos inconsistentes sin que el usuario lo note.
//
// En vez de eso, esta cola guarda el ARCHIVO ORIGINAL (File — IndexedDB
// soporta Blob/File de forma nativa en todos los navegadores modernos) más
// el contexto de sesión (lapso, programa, sede) con el que se intentó
// subir. Al reintentar, useUpload.js vuelve a correr el flujo completo
// (parseo + resolución de catálogo + vista previa) desde cero contra el
// estado real de la BD en ese momento — el usuario revisa y confirma la
// vista previa igual que en una carga nueva, nunca se inserta nada sin
// que el usuario lo haya visto. Lo único que se evita es perder el
// archivo y tener que volver a seleccionarlo.
//
// Mismo patrón de API y mismo evento de cambio que offlineQueue.js /
// manualAttendanceQueue.js, para que cualquier UI que ya escuche el
// patrón 'sigma:cola-*-cambio' pueda sumar esta cola sin sorpresas.

import { abrirDBCompartida } from './idb';

const STORE = 'cargas_excel_pendientes';
const EVENTO_CAMBIO = 'sigma:cola-excel-cambio';

// Mismo TTL que las demás colas offline (OFF-2/OFF-10): 48h antes de
// purgar automáticamente. Pasado ese tiempo el catálogo/horario de la
// sede ya cambió lo suficiente como para que reintentar a ciegas sea más
// riesgoso que simplemente pedirle al usuario que vuelva a subir el
// archivo con datos frescos.
const TTL_MS = 48 * 60 * 60 * 1000;

function abrirDB() {
  return abrirDBCompartida();
}

function notificarCambio() {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO));
  } catch {
    // Ver mismo comentario en offlineQueue.js — no crítico, solo afecta
    // a una UI que esté escuchando el evento para refrescar un contador.
  }
}

// payload esperado: { file: File, fileName, lapso, selectedPrograma, sedeActiva }
export async function encolarCargaExcel(payload) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).add({ ...payload, creadoEn: Date.now() });
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
  notificarCambio();
}

export async function obtenerCargasPendientes() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readonly');
  return new Promise((res, rej) => {
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function eliminarCargaPendiente(id) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
  notificarCambio();
}

export async function contarCargasPendientes() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readonly');
  return new Promise((res, rej) => {
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function purgarExpiradasExcel() {
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
