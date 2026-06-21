/**
 * QRProyeccion.jsx — Solo lectura: muestra el QR y la cuenta regresiva.
 * No tiene botones de control (iniciar, regenerar, cerrar).
 */

import React from "react";
import { QRDisplay, formatFechaVE, TURNOS_VISIBLES } from "./AdminQRPanel";

const PASOS = [
  "Abre la cámara de tu celular",
  "Apunta al código QR en pantalla",
  "Elige Entrada o Salida",
  "Primera vez: ingresa tu cédula y nombre",
  "Confirma y listo",
];

export default function QRProyeccion({ activa, qrUrl, segundosRestantes, ttlMinutes, meta }) {
  const turnoInfo = meta?.turno ? TURNOS_VISIBLES.find(t => t.id === meta.turno) : null;

  return (
    <div style={{ padding: 24, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <i className="ti ti-device-desktop" style={{ fontSize: 22 }} aria-hidden="true" />
          Proyección de Asistencia
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748B" }}>
          Solo lectura — esta pantalla no tiene controles para iniciar, regenerar ni cerrar la sesión.
        </p>
      </div>

      {!activa ? (
        <div style={{ background: "#fff", borderRadius: 12, border: "2px dashed #E2E8F0", padding: "60px 24px", textAlign: "center" }}>
          <i className="ti ti-qrcode" style={{ fontSize: 48, color: "#CBD5E1", display: "block", marginBottom: 16 }} aria-hidden="true" />
          <div style={{ fontSize: 16, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Esperando que se inicie una sesión</div>
          <div style={{ fontSize: 14, color: "#64748B", maxWidth: 320, margin: "0 auto" }}>
            El administrador u operador debe iniciar la sesión QR desde su propio dispositivo, en <strong>Panel QR</strong>. En cuanto la active, el código aparecerá aquí automáticamente.
          </div>
        </div>
      ) : (
        <div>
          {meta && (
            <div style={{ background: "#F0FDF4", border: "1.5px solid #86EFAC", borderRadius: 10, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22C55E", display: "inline-block", animation: "pulse 1.4s ease-in-out infinite" }} />
              <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>
                Sesión activa{turnoInfo ? ` · ${turnoInfo.label}` : ""}{meta.fecha ? ` · ${formatFechaVE(meta.fecha)}` : ""}
                {meta.programa ? ` · ${meta.programa.replace("PNF ", "")}` : ""}
              </span>
            </div>
          )}

          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 16, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Escanea para registrar tu entrada o salida
            </div>
            <QRDisplay qrUrl={qrUrl} segundos={segundosRestantes} ttlMinutes={ttlMinutes} />

            <div style={{ marginTop: 20, background: "#F8FAFC", borderRadius: 10, padding: "14px 18px", width: "100%", maxWidth: 340 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Instrucciones para el docente</div>
              {PASOS.map((step, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: i < PASOS.length - 1 ? 8 : 0 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#2563EB", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                  <span style={{ fontSize: 13, color: "#334155" }}>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
