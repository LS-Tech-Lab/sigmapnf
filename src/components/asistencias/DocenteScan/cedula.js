// Normalización, validación y frescura de los datos de identidad del
// docente guardados en localStorage. Extraído de DocenteScan.jsx.

import { fechaHoyVE } from "../../../utils/time";

export const LS_KEY = "pnf_docente_datos";
// Tiempo máximo en horas antes de mostrar aviso de datos viejos
export const LS_TIMEOUT_HORAS = 12;

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
export function normalizarCedula(raw) {
  const limpio = raw.replace(/\s/g, "").toUpperCase();
  if (/^[VEve]-?\d+$/.test(limpio)) {
    return `${limpio[0]}-${limpio.replace(/[^0-9]/g, "")}`;
  }
  if (/^\d+$/.test(limpio)) return `V-${limpio}`;
  return limpio;
}

// ── Validar formato de cédula ────────────────────────────────────────────────
// FIX (cedula-validacion-formato): antes la cédula era texto 100% libre, sin
// ninguna validación. Eso permitía guardar typos como "V-18341588" en vez de
// "V-18341488" (un solo dígito transpuesto), creando una identidad "fantasma"
// duplicada para el mismo docente — que además rompe el cruce de Ausentes,
// porque esa cédula nueva nunca coincide con la vinculada en `docentes`.
// Una cédula venezolana válida es V o E + guion + solo dígitos (6 a 9, para
// cubrir cédulas antiguas cortas y futuras más largas).
export function cedulaTieneFormatoValido(normalizada) {
  return /^[VE]-\d{6,9}$/.test(normalizada);
}
