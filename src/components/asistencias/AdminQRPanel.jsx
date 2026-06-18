/**
 * AdminQRPanel.jsx
 *
 * Panel del admin/operador_qr para gestionar la sesión QR.
 * El estado de la sesión (useQRSession) vive en el padre (App.jsx)
 * para que persista al cambiar entre las pestañas Panel QR / Reporte.
 *
 * Validaciones:
 *  - No permite seleccionar fechas pasadas
 *  - No permite seleccionar un turno que ya terminó hoy
 *  - NOCTURNO oculto (reservado para futura actualización)
 */

import React, { useState, useEffect, useRef } from "react";
import { DEFAULT_PROGRAMAS } from "../../constants";
import { supabase } from "../../lib/supabase";

// ── Hora actual en Venezuela (UTC-4) ────────────────────────────────────────
function horaActualVE() {
  const now = new Date();
  // Venezuela es UTC-4 fijo (sin horario de verano)
  const ve = new Date(now.toLocaleString("en-US", { timeZone: "America/Caracas" }));
  return ve.getHours() * 60 + ve.getMinutes(); // minutos desde medianoche
}

// DIURNO termina a las 12:00 → 720 min. Si ya son las 12:01, no se puede.
// VESPERTINO termina a las 17:30 → 1050 min.
const TURNO_FIN = { DIURNO: 720, VESPERTINO: 1050 };

// Formato DD-MM-YYYY
function formatFechaVE(isoStr) {
  if (!isoStr) return "";
  const [y, m, d] = isoStr.split("-");
  return `${d}-${m}-${y}`;
}

const TURNOS_VISIBLES = [
  { id: "DIURNO",     label: "☀️ Diurno",    hora: "7:30 AM – 12:00 PM" },
  { id: "VESPERTINO", label: "🌆 Vespertino", hora: "1:00 PM – 5:30 PM"  },
  // NOCTURNO oculto — futura actualización
];

// ── Barra de cuenta regresiva ────────────────────────────────────────────────
function CountdownBar({ segundos, total }) {
  const pct   = Math.max(0, (segundos / total) * 100);
  const color = pct > 40 ? "#22C55E" : pct > 15 ? "#F59E0B" : "#EF4444";
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748B", marginBottom: 5, fontWeight: 500 }}>
        <span>Próxima rotación</span>
        <span style={{ color, fontWeight: 700 }}>
          {Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "#E2E8F0", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.9s linear, background 0.4s" }} />
      </div>
    </div>
  );
}

// ── QR canvas ───────────────────────────────────────────────────────────────
function QRDisplay({ qrUrl, segundos, ttlMinutes }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!qrUrl || !canvasRef.current) return;
    const render = () => {
      if (!window.QRCode) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      window.QRCode.toCanvas(canvas, qrUrl, {
        width: 280, margin: 2,
        color: { dark: "#0F172A", light: "#FFFFFF" },
      });
    };
    if (window.QRCode) { render(); }
    else {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js";
      s.onload = render;
      document.head.appendChild(s);
    }
  }, [qrUrl]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 12, boxShadow: "0 2px 16px rgba(0,0,0,0.1)" }}>
        <canvas ref={canvasRef} style={{ display: "block", borderRadius: 6 }} />
      </div>
      <CountdownBar segundos={segundos} total={ttlMinutes * 60} />
      <p style={{ marginTop: 6, fontSize: 11, color: "#9CA3AF", textAlign: "center" }}>
        Se regenera automáticamente y al cada escaneo. Las fotos compartidas no son válidas.
      </p>
    </div>
  );
}

// ── Panel principal ──────────────────────────────────────────────────────────
export default function AdminQRPanel({
  profile, onVerReporte,
  // Props del hook que vive en el padre:
  qrUrl, activa, loading, error, segundosRestantes, ttlMinutes, sessionId,
  crearSesion, renovarManual, cerrarSesion,
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const minHoy = horaActualVE();

  // Turno por defecto según hora actual
  const turnoDefault = minHoy < TURNO_FIN.DIURNO ? "DIURNO" : "VESPERTINO";

  const [turno,    setTurno]    = useState(turnoDefault);
  const [programa, setPrograma] = useState(profile?.programa || "");
  const [fecha,    setFecha]    = useState(hoy);

  // Validaciones de turno según hora actual (solo si la fecha es HOY)
  const esHoy = fecha === hoy;
  function turnoDisponible(tId) {
    if (!esHoy) return true; // fecha futura → todos disponibles
    return minHoy < TURNO_FIN[tId];
  }

  // Conteo en tiempo real
  const [totalHoy, setTotalHoy] = useState(0);
  useEffect(() => {
    if (!sessionId) { setTotalHoy(0); return; }
    const fetch = async () => {
      const { count } = await supabase
        .from("asistencias_diarias")
        .select("*", { count: "exact", head: true })
        .eq("qr_session_id", sessionId);
      setTotalHoy(count || 0);
    };
    fetch();
    const ch = supabase.channel(`panel_count_${sessionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "asistencias_diarias", filter: `qr_session_id=eq.${sessionId}` }, fetch)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [sessionId]);

  const handleIniciar = () => {
    // Guardar validación final antes de crear
    if (esHoy && !turnoDisponible(turno)) return;
    crearSesion({ turno, programa: programa || null, fecha });
  };

  const turnoInfo = TURNOS_VISIBLES.find(t => t.id === turno);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111827" }}>📲 Control de Asistencias QR</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6B7280" }}>Genera el código QR y proyéctalo. Los docentes escanean con su celular.</p>
        </div>
        {onVerReporte && (
          <button onClick={onVerReporte} style={{ padding: "8px 16px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>
            📋 Ver reporte del día
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* ── Columna izquierda: configuración ── */}
        <div style={{ flex: "0 0 320px", background: "#fff", borderRadius: 12, border: "1px solid #E5E7EB", padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
            Configuración de la sesión
          </div>

          {/* Fecha */}
          <label style={{ display: "block", marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Fecha</span>
            <input
              type="date"
              value={fecha}
              min={hoy}
              onChange={e => setFecha(e.target.value)}
              disabled={activa}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 13, color: "#111827", background: activa ? "#F9FAFB" : "#fff", cursor: activa ? "not-allowed" : "auto", boxSizing: "border-box" }}
            />
            {fecha < hoy && (
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#DC2626" }}>⚠️ No se pueden registrar asistencias en fechas pasadas.</p>
            )}
          </label>

          {/* Turno */}
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }}>Turno</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {TURNOS_VISIBLES.map(t => {
                const disponible = turnoDisponible(t.id);
                const seleccionado = turno === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => !activa && disponible && setTurno(t.id)}
                    disabled={activa || !disponible}
                    title={!disponible ? "Este turno ya finalizó hoy" : ""}
                    style={{
                      padding: "9px 14px", borderRadius: 8,
                      border: `1.5px solid ${seleccionado ? "#2563EB" : disponible ? "#E5E7EB" : "#F3F4F6"}`,
                      background: seleccionado ? "#EFF6FF" : disponible ? "#fff" : "#F9FAFB",
                      color: seleccionado ? "#1D4ED8" : disponible ? "#374151" : "#9CA3AF",
                      cursor: activa || !disponible ? "not-allowed" : "pointer",
                      fontSize: 13, fontWeight: seleccionado ? 600 : 500,
                      textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                      opacity: !disponible ? 0.55 : activa && !seleccionado ? 0.45 : 1,
                      transition: "all 0.12s",
                    }}
                  >
                    <span>{t.label}{!disponible && esHoy ? " · ya finalizó" : ""}</span>
                    <span style={{ fontSize: 11, color: seleccionado ? "#3B82F6" : "#9CA3AF", fontWeight: 500 }}>{t.hora}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Programa */}
          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Programa (opcional)</span>
            <select
              value={programa}
              onChange={e => setPrograma(e.target.value)}
              disabled={activa}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 13, color: "#111827", background: activa ? "#F9FAFB" : "#fff", cursor: activa ? "not-allowed" : "pointer", boxSizing: "border-box" }}
            >
              <option value="">Todos los programas</option>
              {DEFAULT_PROGRAMAS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          {/* Error */}
          {error && (
            <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, marginBottom: 14 }}>
              ⚠️ {error}
            </div>
          )}

          {/* Botones */}
          {!activa ? (
            <button
              onClick={handleIniciar}
              disabled={loading || fecha < hoy || (esHoy && !turnoDisponible(turno))}
              style={{
                width: "100%", padding: "11px 0",
                background: loading || fecha < hoy || (esHoy && !turnoDisponible(turno)) ? "#93C5FD" : "#2563EB",
                color: "#fff", border: "none", borderRadius: 9, fontSize: 14, fontWeight: 600,
                cursor: loading || fecha < hoy || (esHoy && !turnoDisponible(turno)) ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Iniciando…" : "▶ Iniciar sesión QR"}
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={renovarManual} disabled={loading} style={{ width: "100%", padding: "10px 0", background: "#F0FDF4", color: "#15803D", border: "1.5px solid #86EFAC", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
                🔄 Regenerar QR ahora
              </button>
              <button onClick={cerrarSesion} style={{ width: "100%", padding: "10px 0", background: "#FFF1F2", color: "#BE123C", border: "1.5px solid #FECDD3", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                ⏹ Cerrar sesión
              </button>
            </div>
          )}

          {/* Contador */}
          {activa && (
            <div style={{ marginTop: 16, padding: "12px 14px", background: "#F0FDF4", borderRadius: 10, border: "1px solid #BBF7D0", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#15803D" }}>{totalHoy}</div>
              <div style={{ fontSize: 12, color: "#166534", fontWeight: 600 }}>
                docente{totalHoy !== 1 ? "s" : ""} registrado{totalHoy !== 1 ? "s" : ""}
              </div>
            </div>
          )}
        </div>

        {/* ── Columna derecha: QR ── */}
        <div style={{ flex: 1, minWidth: 280 }}>
          {!activa ? (
            <div style={{ background: "#fff", borderRadius: 12, border: "2px dashed #E2E8F0", padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>📲</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Sin sesión activa</div>
              <div style={{ fontSize: 14, color: "#9CA3AF", maxWidth: 280, margin: "0 auto" }}>
                Configura el turno y la fecha, luego pulsa <strong>Iniciar sesión QR</strong>.
              </div>
            </div>
          ) : (
            <div>
              {/* Banner activo */}
              <div style={{ background: "#F0FDF4", border: "1.5px solid #86EFAC", borderRadius: 10, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22C55E", display: "inline-block", animation: "pulse 1.4s ease-in-out infinite" }} />
                <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>
                  Sesión activa · {turnoInfo?.label} · {formatFechaVE(fecha)}
                  {programa ? ` · ${programa.replace("PNF ", "")}` : ""}
                </span>
              </div>

              {/* QR */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E7EB", padding: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 16, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Escanea para registrar tu asistencia
                </div>
                <QRDisplay qrUrl={qrUrl} segundos={segundosRestantes} ttlMinutes={ttlMinutes} />

                {/* Instrucciones */}
                <div style={{ marginTop: 20, background: "#F8FAFC", borderRadius: 10, padding: "14px 18px", width: "100%", maxWidth: 340 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Instrucciones para el docente</div>
                  {["Abre la cámara de tu celular", "Apunta al código QR en pantalla", "Primera vez: ingresa tu cédula y nombre", "Confirma y listo ✅"].map((step, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: i < 3 ? 8 : 0 }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#2563EB", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                      <span style={{ fontSize: 13, color: "#374151" }}>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
