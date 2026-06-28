// Capa de caché IndexedDB para reportes de asistencias.
// v1 = asistencias_pendientes
// v2 = + reportes_asistencias (reporte diario)
// v3 = + ausentes_cache (VistaAusentes)
// v4 = + pin_offline (login offline) — gestionado por pinOffline.js

const DB_NAME = 'sigma_offline';
const DB_VER  = 4;

const STORE_REPORTES = 'reportes_asistencias';
const STORE_AUSENTES = 'ausentes_cache';

function abrirDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('asistencias_pendientes')) {
        db.createObjectStore('asistencias_pendientes', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_REPORTES)) {
        db.createObjectStore(STORE_REPORTES, { keyPath: 'clave' });
      }
      if (!db.objectStoreNames.contains(STORE_AUSENTES)) {
        db.createObjectStore(STORE_AUSENTES, { keyPath: 'clave' });
      }
      if (!db.objectStoreNames.contains('pin_offline')) {
        db.createObjectStore('pin_offline', { keyPath: 'userId' });
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

// ── Reporte diario ────────────────────────────────────────────────────────────

export function claveReporte(fecha, turno, programa) {
  return `${fecha}__${turno}__${programa || 'todos'}`;
}

export async function guardarReporteEnIDB(fecha, turno, programa, datos) {
  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE_REPORTES, 'readwrite');
    tx.objectStore(STORE_REPORTES).put({
      clave:      claveReporte(fecha, turno, programa),
      fecha,
      turno,
      programa:   programa || '',
      datos,
      guardadoEn: Date.now(),
    });
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (err) {
    console.warn('[reporteCache] guardarReporte:', err);
  }
}

export async function cargarReporteDeIDB(fecha, turno, programa) {
  try {
    const db  = await abrirDB();
    const tx  = db.transaction(STORE_REPORTES, 'readonly');
    const key = claveReporte(fecha, turno, programa);
    return new Promise((res, rej) => {
      const req = tx.objectStore(STORE_REPORTES).get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => rej(req.error);
    });
  } catch {
    return null;
  }
}

// ── Ausentes ──────────────────────────────────────────────────────────────────

export function claveAusentes(fecha, programa) {
  return `${fecha}__${programa || 'todos'}`;
}

export async function guardarAusentesEnIDB(fecha, programa, datos) {
  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE_AUSENTES, 'readwrite');
    tx.objectStore(STORE_AUSENTES).put({
      clave:      claveAusentes(fecha, programa),
      fecha,
      programa:   programa || '',
      datos,
      guardadoEn: Date.now(),
    });
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (err) {
    console.warn('[reporteCache] guardarAusentes:', err);
  }
}

export async function cargarAusentesDeIDB(fecha, programa) {
  try {
    const db  = await abrirDB();
    const tx  = db.transaction(STORE_AUSENTES, 'readonly');
    const key = claveAusentes(fecha, programa);
    return new Promise((res, rej) => {
      const req = tx.objectStore(STORE_AUSENTES).get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => rej(req.error);
    });
  } catch {
    return null;
  }
}
