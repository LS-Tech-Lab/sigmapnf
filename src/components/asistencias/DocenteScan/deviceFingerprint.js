// Huella de dispositivo, usada por el backend para detectar un mismo celular
// registrando la asistencia de más de un docente en la misma sesión QR.
// Extraído de DocenteScan.jsx.

import { logger } from "../../../utils/logger";

export async function calcularDeviceFingerprint() {
  const raw = [
    navigator.userAgent, navigator.language,
    screen.width, screen.height, screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || "",
  ].join("|");

  if (window.crypto?.subtle) {
    try {
      const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (err) {
      logger.warn(
        "[deviceFingerprint] crypto.subtle.digest falló, usando fallback djb2 (colisionable):",
        err
      );
    }
  } else {
    logger.warn(
      "[deviceFingerprint] crypto.subtle no disponible (contexto no seguro o navegador antiguo), usando fallback djb2 (colisionable)."
    );
  }
  let h = 5381;
  for (let i = 0; i < raw.length; i++) { h = (h << 5) + h + raw.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16);
}
