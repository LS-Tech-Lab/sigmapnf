/**
 * pinOffline.js
 *
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

const DB_NAME  = 'sigma_offline';
const DB_VER   = 4; // v3 agrega ausentes_cache; v4 agrega pin_offline
const STORE    = 'pin_offline';

function abrirDB() {
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
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'userId' });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
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
    return new Promise((res, rej) => {
      const req = tx.objectStore(STORE).get(userId);
      req.onsuccess = () => res(!!req.result);
      req.onerror   = () => res(false);
    });
  } catch {
    return false;
  }
}
