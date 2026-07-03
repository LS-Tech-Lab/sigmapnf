// Capa de caché IndexedDB para reportes de asistencias.
//
// Fix A1 (auditoría 2026-06-30): la apertura de la base 'sigma_offline'
// ahora vive centralizada en idb.js (DB_VER 6, con todos los stores —
// incluidos los de offlineQueue.js y pinOffline.js — declarados en un
// único onupgradeneeded). Esto evita el VersionError que se producía
// cuando otro módulo abría la base con un número de versión distinto
// antes que este archivo. Ver idb.js para el detalle e historial.

import { abrirDBCompartida } from './idb';
import { logger } from './logger';

const STORE_REPORTES = 'reportes_asistencias';
const STORE_AUSENTES = 'ausentes_cache';

function abrirDB() {
  return abrirDBCompartida();
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
    logger.warn('[reporteCache] guardarReporte:', err);
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
    logger.warn('[reporteCache] guardarAusentes:', err);
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
