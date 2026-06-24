/**
 * QRProyeccion.jsx — Solo lectura: muestra el QR y la cuenta regresiva.
 * Layout de proyección: instrucciones a la izquierda (fuentes grandes para docentes),
 * QR grande a la derecha. Top bar se auto-oculta tras 4 s de inactividad.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { QRDisplay, formatFechaVE, TURNOS_VISIBLES } from "./AdminQRPanel";

const PASOS = [
  { icon: "📱", texto: "Abre la cámara de tu celular" },
  { icon: "🔍", texto: "Apunta al código QR en pantalla" },
  { icon: "☑️", texto: "Elige Entrada o Salida" },
  { icon: "🪪", texto: "Primera vez: ingresa tu cédula y nombre" },
  { icon: "✅", texto: "Confirma y listo — ¡registro exitoso!" },
];

const OCULTAR_TRAS_MS = 4000; // ms sin movimiento para ocultar el top bar

export default function QRProyeccion({ activa, qrUrl, segundosRestantes, ttlMinutes, meta }) {
  const turnoInfo = meta?.turno ? TURNOS_VISIBLES.find(t => t.id === meta.turno) : null;

  /* ── Top bar auto-hide ───────────────────────────────────────────────────── */
  const [barVisible, setBarVisible] = useState(true);
  const timerRef = useRef(null);

  const resetTimer = useCallback(() => {
    setBarVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setBarVisible(false), OCULTAR_TRAS_MS);
  }, []);

  useEffect(() => {
    resetTimer();
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("touchstart", resetTimer);
    window.addEventListener("keydown", resetTimer);
    return () => {
      clearTimeout(timerRef.current);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("touchstart", resetTimer);
      window.removeEventListener("keydown", resetTimer);
    };
  }, [resetTimer]);

  /* ── Pantalla de espera ─────────────────────────────────────────────────── */
  if (!activa) {
    return (
      <div style={styles.root}>
        <TopBar visible={barVisible} meta={null} turnoInfo={null} />
        <div style={styles.waitingWrap}>
          <div style={styles.waitingBox}>
            <span style={{ fontSize: 72, display: "block", marginBottom: 24 }}>📋</span>
            <div style={styles.waitingTitle}>Esperando sesión QR</div>
            <div style={styles.waitingDesc}>
              El administrador debe iniciar la sesión desde su dispositivo en <strong>Panel QR</strong>.
              El código aparecerá aquí automáticamente.
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Vista activa: 2 columnas ───────────────────────────────────────────── */
  return (
    <div style={styles.root}>
      <TopBar visible={barVisible} meta={meta} turnoInfo={turnoInfo} />

      <div style={styles.columns}>
        {/* Columna izquierda — instrucciones */}
        <div style={styles.leftCol}>
          <div style={styles.leftInner}>
            <div style={styles.instrTitulo}>¿Cómo registrar tu asistencia?</div>
            <div style={styles.pasosList}>
              {PASOS.map((paso, i) => (
                <div key={i} style={styles.pasoRow}>
                  <div style={styles.pasoNum}>{i + 1}</div>
                  <div style={styles.pasoIcono}>{paso.icon}</div>
                  <div style={styles.pasoTexto}>{paso.texto}</div>
                </div>
              ))}
            </div>

            <div style={styles.aviso}>
              <span style={styles.avisoIcon}>⚠️</span>
              <span style={styles.avisoTexto}>
                Las fotos del QR <strong>no son válidas</strong>. Escanea directamente desde esta pantalla.
              </span>
            </div>
          </div>
        </div>

        {/* Columna derecha — QR */}
        <div style={styles.rightCol}>
          <div style={styles.qrLabel}>Apunta tu cámara aquí</div>
          <div style={styles.qrWrap}>
            <QRDisplay qrUrl={qrUrl} segundos={segundosRestantes} ttlMinutes={ttlMinutes} size={360} />
          </div>
        </div>
      </div>

      <style>{globalCSS}</style>
    </div>
  );
}

/* ── Top bar deslizante ─────────────────────────────────────────────────────── */
function TopBar({ visible, meta, turnoInfo }) {
  return (
    <div style={{ ...styles.topBar, transform: visible ? "translateY(0)" : "translateY(-100%)" }}>
      <div style={styles.topBarInner}>
        <div style={styles.topBarLeft}>
          <i className="ti ti-device-desktop" style={{ fontSize: 18, color: "#2563EB" }} aria-hidden="true" />
          <span style={styles.topBarTitle}>Proyección de Asistencia</span>
          <span style={styles.topBarBadge}>Solo lectura</span>
        </div>


        {meta && (
          <div style={styles.topBarMeta}>
            <span style={styles.pulseDot} />
            <span style={styles.topBarMetaText}>
              Sesión activa
              {turnoInfo ? ` · ${turnoInfo.label}` : ""}
              {meta.fecha ? ` · ${formatFechaVE(meta.fecha)}` : ""}
              {meta.programa ? ` · ${meta.programa.replace("PNF ", "")}` : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Estilos ────────────────────────────────────────────────────────────────── */
const styles = {
  root: {
    minHeight: "100vh",
    background: "#0F172A",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    overflow: "hidden",
  },

  /* top bar */
  topBar: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    background: "rgba(15, 23, 42, 0.95)",
    backdropFilter: "blur(8px)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  topBarInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 28px",
    gap: 16,
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  topBarTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#E2E8F0",
    letterSpacing: "0.01em",
  },
  topBarBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748B",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 20,
    padding: "2px 8px",
  },
  topBarMeta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#22C55E",
    display: "inline-block",
    animation: "pulse 1.4s ease-in-out infinite",
    flexShrink: 0,
  },
  topBarMetaText: {
    fontSize: 12,
    fontWeight: 500,
    color: "#94A3B8",
  },

  /* espera */
  waitingWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  waitingBox: {
    textAlign: "center",
    maxWidth: 480,
  },
  waitingTitle: {
    fontSize: 32,
    fontWeight: 700,
    color: "#E2E8F0",
    marginBottom: 16,
  },
  waitingDesc: {
    fontSize: 20,
    color: "#94A3B8",
    lineHeight: 1.6,
  },

  /* columnas */
  columns: {
    flex: 1,
    display: "flex",
    alignItems: "stretch",
    minHeight: "100vh",
  },

  /* izquierda */
  leftCol: {
    flex: "0 0 55%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 52px 48px 60px",
    borderRight: "1px solid rgba(255,255,255,0.07)",
  },
  leftInner: {
    maxWidth: 560,
    width: "100%",
  },
  instrTitulo: {
    fontSize: 34,
    fontWeight: 800,
    color: "#F1F5F9",
    marginBottom: 36,
    lineHeight: 1.25,
    letterSpacing: "-0.02em",
  },
  pasosList: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    marginBottom: 40,
  },
  pasoRow: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "16px 22px",
    background: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.07)",
  },
  pasoNum: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "#2563EB",
    color: "#fff",
    fontSize: 17,
    fontWeight: 800,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pasoIcono: {
    fontSize: 26,
    flexShrink: 0,
    lineHeight: 1,
  },
  pasoTexto: {
    fontSize: 22,
    fontWeight: 500,
    color: "#E2E8F0",
    lineHeight: 1.35,
  },
  aviso: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    background: "rgba(234, 179, 8, 0.10)",
    border: "1px solid rgba(234, 179, 8, 0.25)",
    borderRadius: 12,
    padding: "14px 20px",
  },
  avisoIcon: {
    fontSize: 22,
    flexShrink: 0,
    marginTop: 1,
  },
  avisoTexto: {
    fontSize: 18,
    color: "#FCD34D",
    lineHeight: 1.5,
  },

  /* derecha */
  rightCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 40px",
    gap: 24,
  },
  qrLabel: {
    fontSize: 16,
    fontWeight: 700,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    textAlign: "center",
  },
  qrWrap: {
    background: "#fff",
    borderRadius: 24,
    padding: 20,
    boxShadow: "0 0 60px rgba(37, 99, 235, 0.3), 0 8px 40px rgba(0,0,0,0.5)",
  },
};

const globalCSS = `
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
  @media (max-width: 900px) {
    .qr-columns { flex-direction: column !important; }
  }
`;
