/**
 * QRDisplay.jsx
 *
 * Fix ARCH-12 (auditoría 12 de julio): extraído de `AdminQRPanel.jsx`.
 * `QRProyeccion.jsx` importaba `QRDisplay`/`formatFechaVE`/`TURNOS_VISIBLES`
 * directamente desde `AdminQRPanel.jsx` — un import estático que arrastraba
 * el módulo completo del panel admin (y todo lo que este importa) a
 * cualquier chunk que incluyera `QRProyeccion`, anulando la separación de
 * `vite.config.js` (`manualChunks`) entre las 3 vistas del módulo QR.
 *
 * Este archivo es autocontenido a propósito: solo trae lo que `QRDisplay`
 * y `CountdownBar` (su única dependencia interna) necesitan de verdad.
 * `AdminQRPanel.jsx` y `QRProyeccion.jsx` importan ambos desde aquí en vez
 * de uno del otro.
 */

import { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import QRCode from "qrcode";
import { TURNOS_CONFIG, pctClass } from "../../constants";
import "./QRDisplay.css";

export const TURNOS_VISIBLES = TURNOS_CONFIG.filter(t => t.habilitado);

export function formatFechaVE(isoStr) {
  if (!isoStr) return "";
  const [y, m, d] = isoStr.split("-");
  return `${d}-${m}-${y}`;
}

// ── Barra de cuenta regresiva ────────────────────────────────────────────────
function CountdownBar({ segundos, total }) {
  const pct   = Math.max(0, (segundos / total) * 100);
  const variant = pct > 40 ? "ok" : pct > 15 ? "warn" : "critical";
  return (
    <div className="qrp-cdb-root">
      <div className="qrp-cdb-header">
        <span>Próxima rotación</span>
        <span className={`qrp-cdb-time qrp-cdb--${variant}`}>
          {Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="qrp-cdb-track">
        <div className={`qrp-cdb-fill qrp-cdb--${variant} ${pctClass(pct)}`} />
      </div>
    </div>
  );
}

// Fix ARCH-17 (auditoría 12 de julio): PropTypes agregado como contrato de
// props — no cambia comportamiento.
CountdownBar.propTypes = {
  segundos: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
};

// ── QR canvas ───────────────────────────────────────────────────────────────
export function QRDisplay({ qrUrl, segundos, ttlMinutes, size = 280 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!qrUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qrUrl, {
      width: size, margin: 2,
      color: { dark: "#0F172A", light: "#FFFFFF" },
    });
  }, [qrUrl, size]);

  return (
    <div className="qap-qr-wrap">
      <canvas ref={canvasRef} className="qrp-qr-canvas" />
      <CountdownBar segundos={segundos} total={ttlMinutes * 60} />
      <p className="qrp-cdb-note">
        Se regenera automáticamente tras cada escaneo. Las fotos compartidas no son válidas.
      </p>
    </div>
  );
}

// Fix ARCH-17 (auditoría 12 de julio): PropTypes agregado como contrato de
// props — no cambia comportamiento. Es el componente que la auditoría
// nombró explícitamente como ejemplo de candidato (usado por AdminQRPanel
// y QRProyeccion, los dos consumidores reales de este archivo).
QRDisplay.propTypes = {
  qrUrl: PropTypes.string,
  segundos: PropTypes.number.isRequired,
  ttlMinutes: PropTypes.number.isRequired,
  size: PropTypes.number,
};
