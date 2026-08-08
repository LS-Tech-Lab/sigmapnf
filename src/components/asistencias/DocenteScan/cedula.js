// Normalización, validación y frescura de los datos de identidad del
// docente guardados en localStorage. Extraído de DocenteScan.jsx.

import { fechaHoyVE } from "../../../utils/time";

export const LS_KEY = "pnf_docente_datos";
// Tiempo máximo en horas antes de mostrar aviso de datos viejos
export const LS_TIMEOUT_HORAS = 12;

// UX-33: clave SEPARADA para el borrador del formulario de "primera vez"
// (docente sin datos confirmados aún). Nunca se mezcla con LS_KEY, que
// representa una identidad ya confirmada por un registro exitoso.
export const LS_KEY_BORRADOR = "pnf_docente_borrador";
// TTL corto (a diferencia de LS_TIMEOUT_HORAS): esto es texto a medio
// escribir, no una identidad confirmada. Un TTL corto limita la ventana
// en la que un dispositivo compartido podría precargar el nombre/cédula
// de alguien más si nunca completó su registro.
export const LS_BORRADOR_TTL_MIN = 20;

// Lee el borrador guardado, si existe y no ha expirado. No lanza si el
// storage está corrupto o inaccesible (Safari privado, cuota llena, etc).
export function leerBorrador() {
  try {
    const raw = localStorage.getItem(LS_KEY_BORRADOR);
    if (!raw) return null;
    const datos = JSON.parse(raw);
    if (!datos?.guardadoEn) return null;
    const minutos = (Date.now() - datos.guardadoEn) / 60000;
    if (minutos >= LS_BORRADOR_TTL_MIN) {
      localStorage.removeItem(LS_KEY_BORRADOR);
      return null;
    }
    // Un borrador sin nada útil que recuperar no vale la pena mostrarlo
    if (!datos.cedula?.trim() && !datos.nombre?.trim()) return null;
    return datos;
  } catch {
    return null;
  }
}

export function guardarBorrador(cedulaVal, nombreVal) {
  try {
    // No vale la pena persistir (ni disparar el aviso de recuperación
    // después) un formulario todavía vacío.
    if (!cedulaVal?.trim() && !nombreVal?.trim()) return;
    localStorage.setItem(LS_KEY_BORRADOR, JSON.stringify({
      cedula: cedulaVal, nombre: nombreVal, guardadoEn: Date.now(),
    }));
  } catch {}
}

export function borrarBorrador() {
  try { localStorage.removeItem(LS_KEY_BORRADOR); } catch {}
}

// Devuelve string de aviso si los datos guardados son sospechosamente viejos o de otro dia
export function avisoStale(datos) {
  if (!datos) return null;
  if (datos.fecha && datos.fecha !== fechaHoyVE()) {
    return `Estos datos fueron guardados el ${datos.fecha}. Si eres el docente indicado, confirma. Si no, toca "No soy yo".`;
  }
  if (datos.guardadoEn) {
    const diffHoras = Math.round((Date.now() - datos.guardadoEn) / 3600000);
    if (diffHoras >= LS_TIMEOUT_HORAS) {
      return `Estos datos llevan ${diffHoras} horas guardados en este dispositivo. Confirma que eres el docente correcto.`;
    }
  }
  return null;
}

// ── Normalizar cédula ────────────────────────────────────────────────────────
// Formato canónico: solo dígitos (sin prefijo V-/E-, sin guion).
// Esto mantiene consistencia con la tabla `docentes` donde las cédulas
// están almacenadas como números puros (ej: "5174134").
// El docente puede ingresar "V-5174134", "V5174134" o "5174134" — todos
// quedan como "5174134" al registrar.
export function normalizarCedula(raw) {
  return raw.replace(/[^0-9]/g, "");
}

// ── Validar formato de cédula ────────────────────────────────────────────────
// FIX (cedula-validacion-formato): antes la cédula era texto 100% libre, sin
// ninguna validación. Eso permitía guardar typos como "18341588" en vez de
// "18341488" (un solo dígito transpuesto), creando una identidad "fantasma"
// duplicada para el mismo docente — que además rompe el cruce de Ausentes,
// porque esa cédula nueva nunca coincide con la vinculada en `docentes`.
// Una cédula venezolana válida tiene entre 6 y 9 dígitos.
export function cedulaTieneFormatoValido(normalizada) {
  return /^\d{6,9}$/.test(normalizada);
}
