/**
 * QRProyeccion.jsx — Solo lectura: muestra el QR y la cuenta regresiva.
 * Layout completamente responsivo:
 *   ≥900px  → 2 columnas (instrucciones izquierda / QR derecha)
 *   <900px  → 1 columna vertical (QR primero, instrucciones debajo)
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { QRDisplay, formatFechaVE, TURNOS_VISIBLES } from "./AdminQRPanel";
import { supabase } from "../../lib/supabase";
import { playRegistroSound } from "./useRegistroSound";

const PASOS = [
  { icon: "📱", texto: "Abre la cámara de tu celular" },
  { icon: "🔍", texto: "Apunta al código QR en pantalla" },
  { icon: "☑️", texto: "Elige Entrada o Salida" },
  { icon: "🪪", texto: "Primera vez: ingresa tu cédula y nombre" },
  { icon: "✅", texto: "Confirma y listo — ¡registro exitoso!" },
];

const OCULTAR_TRAS_MS = 4000;

/* ── Hook mínimo: solo para el tamaño del canvas del QR ────────────────────
   El layout responsive (1 col / 2 cols) se gestiona en CSS (index.css).
   Solo mantenemos el ancho de ventana para calcular el tamaño en píxeles
   del canvas del QR, que no puede resolverse con CSS puro.
   ─────────────────────────────────────────────────────────────────────────── */
function useQRCanvasSize() {
  const getSize = () => {
    if (typeof window === "undefined") return 360;
    const w = window.innerWidth;
    if (w < 640) return Math.min(w - 80, 260);
    if (w < 900) return 300;
    return 360;
  };
  const [qrSize, setQrSize] = useState(getSize);
  useEffect(() => {
    const handler = () => setQrSize(getSize());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return qrSize;
}

export default function QRProyeccion({ activa, qrUrl, segundosRestantes, ttlMinutes, meta, sessionId, isOffline = false }) {
  const turnoInfo = meta?.turno ? TURNOS_VISIBLES.find(t => t.id === meta.turno) : null;
  const qrSize = useQRCanvasSize();

  /* ── Contador en tiempo real ─────────────────────────────────────────── */
  const [conteo, setConteo] = useState({ entradas: 0, salidas: 0 });
  const conteoRef = useRef({ entradas: 0, salidas: 0 });

  useEffect(() => {
    if (!sessionId || !activa) { setConteo({ entradas: 0, salidas: 0 }); return; }

    const fetchConteo = async () => {
      const { data } = await supabase
        .from("asistencias_diarias")
        .select("cedula_docente, tipo")
        .eq("qr_session_id", sessionId);
      if (!data) return;
      const entradas = new Set(data.filter(r => r.tipo === "ENTRADA").map(r => r.cedula_docente)).size;
      const salidas  = new Set(data.filter(r => r.tipo === "SALIDA").map(r => r.cedula_docente)).size;
      const prev = conteoRef.current;
      if (prev.entradas + prev.salidas > 0 && entradas + salidas > prev.entradas + prev.salidas) {
        playRegistroSound();
      }
      conteoRef.current = { entradas, salidas };
      setConteo({ entradas, salidas });
    };

    fetchConteo();
    const ch = supabase.channel(`proyeccion_conteo_${sessionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "asistencias_diarias", filter: `qr_session_id=eq.${sessionId}` }, fetchConteo)
      .subscribe();
    const poll = setInterval(fetchConteo, 6000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [sessionId, activa]);

  /* ── Top bar auto-hide ───────────────────────────────────────────────── */
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

  /* ── Pantalla de espera ──────────────────────────────────────────────── */
  if (!activa) {
    return (
      <div className="qrp-root">
        <TopBar visible={barVisible} meta={null} turnoInfo={null} />
        <div className="qrp-waiting-wrap">
          <div className="qrp-waiting-box">
            <span className="qrp-waiting-emoji" style={{ display: "block", marginBottom: 20 }}>📋</span>
            <div className="qrp-waiting-title">Esperando sesión QR</div>
            <div className="qrp-waiting-desc">
              El administrador debe iniciar la sesión desde su dispositivo en{" "}
              <strong>Panel QR</strong>. El código aparecerá aquí automáticamente.
            </div>
          </div>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  /* ── Vista activa ────────────────────────────────────────────────────── */
  return (
    <div className="qrp-root">
      <TopBar visible={barVisible} meta={meta} turnoInfo={turnoInfo} isOffline={isOffline} />

      {/* Fix O-3: banner de red caída visible para docentes en el aula */}
      {isOffline && (
        <div className="qrp-offline-banner">
          <span className="qrp-offline-icon">📡</span>
          <span className="qrp-offline-texto">
            <strong>Sin conexión a internet</strong> — el QR mostrado puede haber vencido.
            El coordinador debe restablecer la sesión al recuperar la red.
          </span>
        </div>
      )}

      <div className="qrp-layout qrp-layout--row qrp-layout-min-h">

        {/* Tablet/Móvil: QR va primero (oculto en desktop por CSS) */}
        <div className="qrp-layout-qr-top">
          <QRSection qrUrl={qrUrl} segundosRestantes={segundosRestantes} ttlMinutes={ttlMinutes} qrSize={qrSize} />
        </div>

        {/* Columna instrucciones */}
        <div className="qrp-left">
          <div className="qrp-left-inner">
            <div className="qrp-instr-titulo">
              ¿Cómo registrar tu asistencia?
            </div>

            <div className="qrp-pasos-list">
              {PASOS.map((paso, i) => (
                <div key={i} className="qrp-paso-row">
                  <div className="qrp-paso-num">{i + 1}</div>
                  <div className="qrp-paso-icono">{paso.icon}</div>
                  <div className="qrp-paso-texto">{paso.texto}</div>
                </div>
              ))}
            </div>

            {activa && (
              <div className="qrp-contador-wrap">
                <div className="qrp-contador-item">
                  <span className="qrp-contador-num" style={{ color: "#22C55E" }}>{conteo.entradas}</span>
                  <span className="qrp-contador-label">
                    <i className="ti ti-login" aria-hidden="true" />
                    {conteo.entradas === 1 ? "docente entró" : "docentes entraron"}
                  </span>
                </div>
                <div className="qrp-contador-divider" />
                <div className="qrp-contador-item">
                  <span className="qrp-contador-num" style={{ color: "#F87171" }}>{conteo.salidas}</span>
                  <span className="qrp-contador-label">
                    <i className="ti ti-logout" aria-hidden="true" />
                    {conteo.salidas === 1 ? "docente salió" : "docentes salieron"}
                  </span>
                </div>
              </div>
            )}

            <div className="qrp-aviso">
              <span className="qrp-aviso-icon">⚠️</span>
              <span className="qrp-aviso-texto">
                Las fotos del QR <strong>no son válidas</strong>. Escanea directamente desde esta pantalla.
              </span>
            </div>
          </div>
        </div>

        {/* Desktop: QR a la derecha (oculto en tablet/móvil por CSS) */}
        <div className="qrp-layout-qr-right">
          <QRSection qrUrl={qrUrl} segundosRestantes={segundosRestantes} ttlMinutes={ttlMinutes} qrSize={qrSize} />
        </div>
      </div>

      <style>{CSS}</style>
    </div>
  );
}

/* ── Columna / sección del QR ────────────────────────────────────────────── */
function QRSection({ qrUrl, segundosRestantes, ttlMinutes, qrSize }) {
  return (
    <div className="qrp-right">
      <div className="qrp-qr-label">Apunta tu cámara aquí</div>
      <div className="qrp-qr-wrap">
        <QRDisplay qrUrl={qrUrl} segundos={segundosRestantes} ttlMinutes={ttlMinutes} size={qrSize} />
      </div>
    </div>
  );
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
function TopBar({ visible, meta, turnoInfo, isOffline }) {
  return (
    <div className={`qrp-topbar ${visible ? "qrp-topbar--visible" : "qrp-topbar--hidden"}`}>
      <div className="qrp-topbar-inner">
        <div className="qrp-topbar-left">
          <i className="ti ti-device-desktop" style={{ fontSize: 18, color: "#2563EB" }} aria-hidden="true" />
          <span className="qrp-topbar-title">Proyección de Asistencia</span>
          <span className="qrp-topbar-badge">Solo lectura</span>
          {/* Fix O-3: indicador compacto de red en la barra superior */}
          {isOffline && (
            <span className="qrp-topbar-offline-pill">
              📡 Sin red
            </span>
          )}
        </div>

        {meta && (
          <div className="qrp-topbar-meta">
            <span className={isOffline ? "qrp-pulse-dot qrp-pulse-dot--offline" : "qrp-pulse-dot"} />
            <span className="qrp-topbar-meta-text">
              <span className="qrp-topbar-meta-label-full">Sesión activa</span>
              <span className="qrp-topbar-meta-label-short">Activa</span>
              {turnoInfo ? ` · ${turnoInfo.label}` : ""}
              <span className="qrp-topbar-meta-date">{meta.fecha ? ` · ${formatFechaVE(meta.fecha)}` : ""}</span>
              <span className="qrp-topbar-meta-prog">{meta.programa ? ` · ${meta.programa.replace("PNF ", "")}` : ""}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── CSS ─────────────────────────────────────────────────────────────────── */
const CSS = `
  /* Reset de caja para todo el componente */
  .qrp-root *, .qrp-root *::before, .qrp-root *::after {
    box-sizing: border-box;
  }

  /* Raíz: ocupa exactamente la pantalla visible */
  .qrp-root {
    min-height: 100dvh;   /* dvh = dynamic viewport height, funciona en iOS Safari */
    min-height: 100vh;    /* fallback */
    background: #0F172A;
    display: flex;
    flex-direction: column;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }

  /* ── Top bar ── */
  .qrp-topbar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(15, 23, 42, 0.97);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    width: 100%;
  }
  .qrp-topbar--visible  { transform: translateY(0); }
  .qrp-topbar--hidden   { transform: translateY(-100%); }

  .qrp-topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .qrp-topbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .qrp-topbar-title {
    font-size: 14px;
    font-weight: 600;
    color: #E2E8F0;
    white-space: nowrap;
  }
  .qrp-topbar-badge {
    font-size: 11px;
    font-weight: 600;
    color: #64748B;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    padding: 2px 8px;
    white-space: nowrap;
  }
  .qrp-topbar-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .qrp-pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22C55E;
    display: inline-block;
    animation: qrpPulse 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  .qrp-topbar-meta-text {
    font-size: 12px;
    font-weight: 500;
    color: #94A3B8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
  }

  /* ── Pantalla de espera ── */
  .qrp-waiting-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
  }
  .qrp-waiting-box {
    text-align: center;
    max-width: 480px;
    width: 100%;
  }
  .qrp-waiting-title {
    font-size: clamp(22px, 5vw, 32px);
    font-weight: 700;
    color: #E2E8F0;
    margin-bottom: 12px;
  }
  .qrp-waiting-desc {
    font-size: clamp(15px, 3.5vw, 20px);
    color: #94A3B8;
    line-height: 1.6;
  }

  /* ── Layout principal ── */
  .qrp-layout {
    flex: 1;
    display: flex;
    width: 100%;
  }
  .qrp-layout--row {
    min-height: calc(100dvh - 49px);
    min-height: calc(100vh - 49px);
  }

  /* ── Columna izquierda (instrucciones) ── */
  .qrp-left {
    flex: 0 0 55%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qrp-left-inner {
    max-width: 560px;
    width: 100%;
  }

  /* ── Título instrucciones ── */
  .qrp-instr-titulo {
    font-weight: 800;
    color: #F1F5F9;
    line-height: 1.25;
    letter-spacing: -0.02em;
  }

  /* ── Pasos ── */
  .qrp-pasos-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
  }
  .qrp-paso-row {
    display: flex;
    align-items: center;
    background: rgba(255,255,255,0.04);
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.07);
  }
  .qrp-paso-num {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #2563EB;
    color: #fff;
    font-size: 15px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .qrp-paso-icono { flex-shrink: 0; line-height: 1; }
  .qrp-paso-texto {
    font-weight: 500;
    color: #E2E8F0;
    line-height: 1.35;
  }

  /* ── Contador ── */
  .qrp-contador-wrap {
    display: flex;
    align-items: center;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 16px;
    gap: 0;
  }
  .qrp-contador-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .qrp-contador-num {
    font-size: clamp(32px, 6vw, 52px);
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.03em;
  }
  .qrp-contador-label {
    font-size: clamp(12px, 2vw, 16px);
    color: #94A3B8;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 5px;
    text-align: center;
  }
  .qrp-contador-divider {
    width: 1px;
    height: 52px;
    background: rgba(255,255,255,0.1);
    margin: 0 16px;
    flex-shrink: 0;
  }

  /* ── Aviso ── */
  .qrp-aviso {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: rgba(234, 179, 8, 0.10);
    border: 1px solid rgba(234, 179, 8, 0.25);
    border-radius: 10px;
    padding: 12px 16px;
  }
  .qrp-aviso-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
  .qrp-aviso-texto {
    font-size: clamp(13px, 2.2vw, 18px);
    color: #FCD34D;
    line-height: 1.5;
  }

  /* ── Columna QR (derecha en desktop, arriba en móvil) ── */
  .qrp-right {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
    gap: 16px;
    width: 100%;
  }
  .qrp-qr-label {
    font-size: 13px;
    font-weight: 700;
    color: #64748B;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    text-align: center;
  }
  .qrp-qr-wrap {
    background: #fff;
    border-radius: 20px;
    padding: 16px;
    box-shadow: 0 0 60px rgba(37, 99, 235, 0.3), 0 8px 40px rgba(0,0,0,0.5);
    max-width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Asegurar que el canvas del QR no desborde */
  .qrp-qr-wrap canvas {
    max-width: 100% !important;
    height: auto !important;
    display: block;
  }

  /* ── Animaciones ── */
  @keyframes qrpPulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }

  /* Fix O-3: pill de red caída en topbar */
  .qrp-topbar-offline-pill {
    font-size: 11px;
    font-weight: 700;
    color: #FCA5A5;
    background: rgba(220, 38, 38, 0.15);
    border: 1px solid rgba(220, 38, 38, 0.4);
    border-radius: 20px;
    padding: 2px 9px;
    white-space: nowrap;
    animation: qrpOfflinePulse 2s ease-in-out infinite;
  }
  @keyframes qrpOfflinePulse { 0%,100% { opacity:1 } 50% { opacity:.55 } }

  /* Punto rojo cuando está offline */
  .qrp-pulse-dot--offline {
    background: #EF4444 !important;
    animation: qrpOfflinePulse 2s ease-in-out infinite !important;
  }

  /* Fix O-3: banner de alerta grande visible para docentes en el aula */
  .qrp-offline-banner {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background: rgba(220, 38, 38, 0.12);
    border-bottom: 2px solid rgba(220, 38, 38, 0.45);
    padding: 14px 24px;
    animation: qrpOfflinePulse 2.5s ease-in-out infinite;
  }
  .qrp-offline-icon {
    font-size: 20px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .qrp-offline-texto {
    font-size: clamp(13px, 2.2vw, 17px);
    color: #FCA5A5;
    line-height: 1.5;
  }
`;
  /* Reset de caja para todo el componente */
  .qrp-root *, .qrp-root *::before, .qrp-root *::after {
    box-sizing: border-box;
  }

  /* Raíz: ocupa exactamente la pantalla visible */
  .qrp-root {
    min-height: 100dvh;   /* dvh = dynamic viewport height, funciona en iOS Safari */
    min-height: 100vh;    /* fallback */
    background: #0F172A;
    display: flex;
    flex-direction: column;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }

  /* ── Top bar ── */
  .qrp-topbar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(15, 23, 42, 0.97);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    width: 100%;
  }
  .qrp-topbar--visible  { transform: translateY(0); }
  .qrp-topbar--hidden   { transform: translateY(-100%); }

  .qrp-topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .qrp-topbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .qrp-topbar-title {
    font-size: 14px;
    font-weight: 600;
    color: #E2E8F0;
    white-space: nowrap;
  }
  .qrp-topbar-badge {
    font-size: 11px;
    font-weight: 600;
    color: #64748B;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    padding: 2px 8px;
    white-space: nowrap;
  }
  .qrp-topbar-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .qrp-pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22C55E;
    display: inline-block;
    animation: qrpPulse 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  .qrp-topbar-meta-text {
    font-size: 12px;
    font-weight: 500;
    color: #94A3B8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
  }

  /* ── Pantalla de espera ── */
  .qrp-waiting-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
  }
  .qrp-waiting-box {
    text-align: center;
    max-width: 480px;
    width: 100%;
  }
  .qrp-waiting-title {
    font-size: clamp(22px, 5vw, 32px);
    font-weight: 700;
    color: #E2E8F0;
    margin-bottom: 12px;
  }
  .qrp-waiting-desc {
    font-size: clamp(15px, 3.5vw, 20px);
    color: #94A3B8;
    line-height: 1.6;
  }

  /* ── Layout principal ── */
  .qrp-layout {
    flex: 1;
    display: flex;
    width: 100%;
  }
  /* Desktop: 2 columnas en fila */
  .qrp-layout--row {
    flex-direction: row;
    align-items: stretch;
    min-height: calc(100dvh - 49px);
    min-height: calc(100vh - 49px);
  }
  /* Móvil/Tablet: columna vertical */
  .qrp-layout--col {
    flex-direction: column;
    align-items: center;
    padding-bottom: 32px;
  }

  /* ── Columna izquierda (instrucciones) ── */
  .qrp-left {
    flex: 0 0 55%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 40px 40px 48px;
    border-right: 1px solid rgba(255,255,255,0.07);
  }
  .qrp-left--col {
    flex: none;
    width: 100%;
    border-right: none;
    border-top: 1px solid rgba(255,255,255,0.07);
    padding: 28px 20px 8px;
  }
  .qrp-left-inner {
    max-width: 560px;
    width: 100%;
  }

  /* ── Título instrucciones ── */
  .qrp-instr-titulo {
    font-size: clamp(20px, 3.5vw, 34px);
    font-weight: 800;
    color: #F1F5F9;
    margin-bottom: 24px;
    line-height: 1.25;
    letter-spacing: -0.02em;
  }
  .qrp-instr-titulo--sm {
    font-size: 20px;
    margin-bottom: 16px;
    text-align: center;
  }

  /* ── Pasos ── */
  .qrp-pasos-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
  }
  .qrp-paso-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 18px;
    background: rgba(255,255,255,0.04);
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.07);
  }
  .qrp-paso-row--sm {
    gap: 10px;
    padding: 10px 14px;
  }
  .qrp-paso-num {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #2563EB;
    color: #fff;
    font-size: 15px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .qrp-paso-icono {
    font-size: 22px;
    flex-shrink: 0;
    line-height: 1;
  }
  .qrp-paso-icono--sm { font-size: 18px; }
  .qrp-paso-texto {
    font-size: clamp(15px, 2.5vw, 22px);
    font-weight: 500;
    color: #E2E8F0;
    line-height: 1.35;
  }
  .qrp-paso-texto--sm { font-size: 14px; }

  /* ── Contador ── */
  .qrp-contador-wrap {
    display: flex;
    align-items: center;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 16px;
    gap: 0;
  }
  .qrp-contador-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .qrp-contador-num {
    font-size: clamp(32px, 6vw, 52px);
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.03em;
  }
  .qrp-contador-label {
    font-size: clamp(12px, 2vw, 16px);
    color: #94A3B8;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 5px;
    text-align: center;
  }
  .qrp-contador-divider {
    width: 1px;
    height: 52px;
    background: rgba(255,255,255,0.1);
    margin: 0 16px;
    flex-shrink: 0;
  }

  /* ── Aviso ── */
  .qrp-aviso {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: rgba(234, 179, 8, 0.10);
    border: 1px solid rgba(234, 179, 8, 0.25);
    border-radius: 10px;
    padding: 12px 16px;
  }
  .qrp-aviso-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
  .qrp-aviso-texto {
    font-size: clamp(13px, 2.2vw, 18px);
    color: #FCD34D;
    line-height: 1.5;
  }

  /* ── Columna QR (derecha en desktop, arriba en móvil) ── */
  .qrp-right {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
    gap: 16px;
    width: 100%;
  }
  .qrp-qr-label {
    font-size: 13px;
    font-weight: 700;
    color: #64748B;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    text-align: center;
  }
  .qrp-qr-wrap {
    background: #fff;
    border-radius: 20px;
    padding: 16px;
    box-shadow: 0 0 60px rgba(37, 99, 235, 0.3), 0 8px 40px rgba(0,0,0,0.5);
    max-width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Asegurar que el canvas del QR no desborde */
  .qrp-qr-wrap canvas {
    max-width: 100% !important;
    height: auto !important;
    display: block;
  }

  /* ── Animaciones ── */
  @keyframes qrpPulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }

  /* Fix O-3: pill de red caída en topbar */
  .qrp-topbar-offline-pill {
    font-size: 11px;
    font-weight: 700;
    color: #FCA5A5;
    background: rgba(220, 38, 38, 0.15);
    border: 1px solid rgba(220, 38, 38, 0.4);
    border-radius: 20px;
    padding: 2px 9px;
    white-space: nowrap;
    animation: qrpOfflinePulse 2s ease-in-out infinite;
  }
  @keyframes qrpOfflinePulse { 0%,100% { opacity:1 } 50% { opacity:.55 } }

  /* Punto rojo cuando está offline */
  .qrp-pulse-dot--offline {
    background: #EF4444 !important;
    animation: qrpOfflinePulse 2s ease-in-out infinite !important;
  }

  /* Fix O-3: banner de alerta grande visible para docentes en el aula */
  .qrp-offline-banner {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background: rgba(220, 38, 38, 0.12);
    border-bottom: 2px solid rgba(220, 38, 38, 0.45);
    padding: 14px 24px;
    animation: qrpOfflinePulse 2.5s ease-in-out infinite;
  }
  .qrp-offline-icon {
    font-size: 20px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .qrp-offline-texto {
    font-size: clamp(13px, 2.2vw, 17px);
    color: #FCA5A5;
    line-height: 1.5;
  }
`;
