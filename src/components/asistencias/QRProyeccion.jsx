/**
 * QRProyeccion.jsx — Solo lectura: muestra el QR y la cuenta regresiva.
 * Layout completamente responsivo:
 *   ≥900px  → 2 columnas (instrucciones izquierda / QR derecha)
 *   <900px  → 1 columna vertical (QR primero, instrucciones debajo)
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
// Fix ARCH-15: antes se importaba de "./AdminQRPanel", lo que arrastraba
// todo ese módulo (y sus dependencias) al chunk de QRProyeccion.
import { QRDisplay, formatFechaVE, TURNOS_VISIBLES } from "./QRDisplay";
import { supabase } from "../../lib/supabase";
import "./QRProyeccion.css";
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
            <span className="qrp-waiting-emoji">📋</span>
            <div className="qrp-waiting-title">Esperando sesión QR</div>
            <div className="qrp-waiting-desc">
              El administrador debe iniciar la sesión desde su dispositivo en{" "}
              <strong>Panel QR</strong>. El código aparecerá aquí automáticamente.
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Vista activa ────────────────────────────────────────────────────── */
  return (
    <div className="qrp-root">
      <TopBar visible={barVisible} meta={meta} turnoInfo={turnoInfo} isOffline={isOffline} />

      {/* Fix OFF-3: banner de red caída visible para docentes en el aula */}
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
                  <span className="qrp-contador-num qrp-contador-num--entrada">{conteo.entradas}</span>
                  <span className="qrp-contador-label">
                    <i className="ti ti-login" aria-hidden="true" />
                    {conteo.entradas === 1 ? "docente entró" : "docentes entraron"}
                  </span>
                </div>
                <div className="qrp-contador-divider" />
                <div className="qrp-contador-item">
                  <span className="qrp-contador-num qrp-contador-num--salida">{conteo.salidas}</span>
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
          <i className="ti ti-device-desktop qrp-topbar-icon" aria-hidden="true" />
          <span className="qrp-topbar-title">Proyección de Asistencia</span>
          <span className="qrp-topbar-badge">Solo lectura</span>
          {/* Fix OFF-3: indicador compacto de red en la barra superior */}
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
