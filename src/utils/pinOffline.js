/**
 * pinOffline.js
 **
 * Gestiona el PIN local de fallback para login sin red.
 * Guarda en IDB (store sigma_offline / pin_offline):
 *   - perfil mínimo del usuario (id, nombre, email, rol, programa, rol_info)
 *   - hash PBKDF2 del PIN de 4-6 dígitos
 *
 * NUNCA se guarda la contraseña de Supabase ni el token JWT.
 * El PIN es independiente de la contraseña — lo elige el usuario al activarlo.
 *
 * Seguridad:
 *   - PBKDF2-SHA-256, 100 000 iteraciones, salt de 16 bytes por usuario
 *   - Solo opera en el mismo dispositivo/navegador (IDB es por origen)
 *   - No reemplaza Supabase Auth — solo permite ver la app en modo lectura
 *     cuando ya hay datos locales cacheados
 */

import { abrirDBCompartida } from './idb';

const STORE = 'pin_offline';
const LOCKOUT_STORE = 'pin_lockout';

// Fix A1 (auditoría 2026-06-30): la apertura de la base 'sigma_offline'
// ahora vive centralizada en idb.js (DB_VER 6, con todos los stores
// declarados en un único onupgradeneeded), para evitar el VersionError
// que se producía cuando este módulo (antes v6) abría la base antes que
// offlineQueue.js (antes v1) o reporteCache.js (antes v4). Ver idb.js.
function abrirDB() {
  return abrirDBCompartida();
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function derivarHash(pin, saltHex) {
  const enc     = new TextEncoder();
  const keyMat  = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt    = hexToUint8(saltHex);
  const bits    = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    keyMat, 256
  );
  return uint8ToHex(new Uint8Array(bits));
}

function generarSalt() {
  return uint8ToHex(crypto.getRandomValues(new Uint8Array(16)));
}

function uint8ToHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Guarda (o actualiza) el PIN offline del usuario.
 * Llamar justo después de un login exitoso en Supabase, si el usuario activó el PIN.
 *
 * @param {object} user    — objeto user de Supabase Auth (necesitamos user.id, user.email)
 * @param {object} profile — perfil cargado por useAuth (nombre, rol, programa, rol_info, activo)
 * @param {string} pin     — 4-6 dígitos
 */
export async function guardarPinOffline(user, profile, pin) {
  if (!pin || !/^\d{4,6}$/.test(pin)) throw new Error('PIN inválido: debe tener entre 4 y 6 dígitos.');

  const salt = generarSalt();
  const hash = await derivarHash(pin, salt);

  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({
    userId:    user.id,
    email:     user.email,
    nombre:    profile.nombre    || user.email,
    rol:       profile.rol       || null,
    programa:  profile.programa  || null,
    activo:    profile.activo    ?? true,
    rol_info:  profile.rol_info  || null,
    salt,
    hash,
    guardadoEn: Date.now(),
  });

  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

/**
 * Verifica el PIN y devuelve el perfil guardado si es correcto, o null si no.
 */
export async function verificarPinOffline(userId, pin) {
  try {
    const db    = await abrirDB();
    const tx    = db.transaction(STORE, 'readonly');
    const entry = await new Promise((res, rej) => {
      const req = tx.objectStore(STORE).get(userId);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => rej(req.error);
    });

    if (!entry) return null;

    const hash = await derivarHash(pin, entry.salt);
    if (hash !== entry.hash) return null;

    // Devolver perfil reconstruido (sin salt/hash por seguridad)
    const { salt: _s, hash: _h, guardadoEn: _g, ...perfil } = entry;
    return perfil;
  } catch {
    return null;
  }
}

/**
 * Lista todos los usuarios con PIN guardado (para mostrar selector offline).
 * Devuelve array de { userId, email, nombre, rol, programa, guardadoEn }
 */
export async function listarUsuariosOffline() {
  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE, 'readonly');
    return new Promise((res, rej) => {
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => res(
        (req.result || []).map(({ salt: _s, hash: _h, ...rest }) => rest)
          .sort((a, b) => b.guardadoEn - a.guardadoEn)
      );
      req.onerror = () => rej(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Elimina el PIN de un usuario (ej. al hacer logout explícito).
 */
export async function eliminarPinOffline(userId) {
  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(userId);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch { /* no crítico */ }
}

/**
 * Verifica si un usuario ya tiene PIN guardado.
 */
export async function tienePinOffline(userId) {
  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE, 'readonly');
    return new Promise((res, _rej) => {
      const req = tx.objectStore(STORE).get(userId);
      req.onsuccess = () => res(!!req.result);
      req.onerror   = () => res(false);
    });
  } catch {
    return false;
  }
}

// ── Fix O-8: lockout en IDB (resiste tabs privadas) ───────────────────────────

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS   = 5 * 60 * 1000; // 5 minutos

/**
 * Lee el estado de lockout para un userId desde IDB.
 * Devuelve { intentos, bloqueadoHasta } o valores por defecto.
 */
export async function leerLockoutIDB(userId) {
  try {
    const db = await abrirDB();
    const tx = db.transaction(LOCKOUT_STORE, 'readonly');
    const entry = await new Promise((res, rej) => {
      const req = tx.objectStore(LOCKOUT_STORE).get(userId);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => rej(req.error);
    });
    if (!entry) return { intentos: 0, bloqueadoHasta: null };
    // Si el bloqueo ya venció, devolver limpio
    if (entry.bloqueadoHasta && entry.bloqueadoHasta <= Date.now()) {
      // Limpiar en background sin esperar
      guardarLockoutIDB(userId, 0, null);
      return { intentos: 0, bloqueadoHasta: null };
    }
    return { intentos: entry.intentos || 0, bloqueadoHasta: entry.bloqueadoHasta || null };
  } catch {
    return { intentos: 0, bloqueadoHasta: null };
  }
}

/**
 * Persiste el estado de lockout en IDB.
 */
export async function guardarLockoutIDB(userId, intentos, bloqueadoHasta) {
  try {
    const db = await abrirDB();
    const tx = db.transaction(LOCKOUT_STORE, 'readwrite');
    tx.objectStore(LOCKOUT_STORE).put({ userId, intentos, bloqueadoHasta });
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch { /* no crítico */ }
}

/**
 * Registra un intento fallido de PIN y aplica bloqueo si corresponde.
 * Devuelve el estado actualizado { intentos, bloqueadoHasta, bloqueadoAhora }.
 */
export async function registrarIntentoPinFallido(userId) {
  const current  = await leerLockoutIDB(userId);
  const intentos = (current.intentos || 0) + 1;
  const bloqueadoAhora = intentos >= PIN_MAX_ATTEMPTS;
  const bloqueadoHasta = bloqueadoAhora ? Date.now() + PIN_LOCKOUT_MS : null;
  await guardarLockoutIDB(userId, intentos, bloqueadoHasta);
  return { intentos, bloqueadoHasta, bloqueadoAhora };
}

/**
 * Limpia el lockout tras un PIN correcto.
 */
export async function limpiarLockoutIDB(userId) {
  try {
    const db = await abrirDB();
    const tx = db.transaction(LOCKOUT_STORE, 'readwrite');
    tx.objectStore(LOCKOUT_STORE).delete(userId);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch { /* no crítico */ }
}

// ── SEC-5: lockout del login normal en IDB ────────────────────────────────────
// Reemplaza los helpers de localStorage (LOCKOUT_STORAGE_KEY / ATTEMPTS_STORAGE_KEY)
// con el mismo patrón IDB ya usado para el PIN. Keyed por email (string).

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS   = 60 * 1000; // 60 segundos

/**
 * Lee el estado de lockout del login normal para un email desde IDB.
 * Devuelve { intentos, bloqueadoHasta } o valores por defecto.
 */
export async function leerLoginLockoutIDB(email) {
  try {
    const db = await abrirDB();
    const tx = db.transaction('login_lockout', 'readonly');
    const entry = await new Promise((res, rej) => {
      const req = tx.objectStore('login_lockout').get(email);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => rej(req.error);
    });
    if (!entry) return { intentos: 0, bloqueadoHasta: null };
    if (entry.bloqueadoHasta && entry.bloqueadoHasta <= Date.now()) {
      guardarLoginLockoutIDB(email, 0, null);
      return { intentos: 0, bloqueadoHasta: null };
    }
    return { intentos: entry.intentos || 0, bloqueadoHasta: entry.bloqueadoHasta || null };
  } catch {
    return { intentos: 0, bloqueadoHasta: null };
  }
}

/**
 * Persiste el estado de lockout del login normal en IDB.
 */
export async function guardarLoginLockoutIDB(email, intentos, bloqueadoHasta) {
  try {
    const db = await abrirDB();
    const tx = db.transaction('login_lockout', 'readwrite');
    tx.objectStore('login_lockout').put({ email, intentos, bloqueadoHasta });
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch { /* no crítico */ }
}

/**
 * Registra un intento fallido de login y aplica bloqueo si corresponde.
 * Devuelve { intentos, bloqueadoHasta, bloqueadoAhora }.
 */
export async function registrarIntentoLoginFallido(email) {
  const current  = await leerLoginLockoutIDB(email);
  const intentos = (current.intentos || 0) + 1;
  const bloqueadoAhora = intentos >= LOGIN_MAX_ATTEMPTS;
  const bloqueadoHasta = bloqueadoAhora ? Date.now() + LOGIN_LOCKOUT_MS : null;
  await guardarLoginLockoutIDB(email, intentos, bloqueadoHasta);
  return { intentos, bloqueadoHasta, bloqueadoAhora };
}

/**
 * Limpia el lockout del login normal tras un login exitoso.
 */
export async function limpiarLoginLockoutIDB(email) {
  try {
    const db = await abrirDB();
    const tx = db.transaction('login_lockout', 'readwrite');
    tx.objectStore('login_lockout').delete(email);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch { /* no crítico */ }
}
