/**
 * AdminQRPanel.jsx
 *
 * Panel del admin/operador_qr para gestionar la sesión QR.
 */

import React, { useState, useEffect, useRef } from "react";
import { DEFAULT_PROGRAMAS, TURNOS_CONFIG } from "../../constants";
import { supabase } from "../../lib/supabase";
import { fechaHoyVE } from "../../utils/time";

function horaActualVE() {
  const ve = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Caracas" }));
  return ve.getHours() * 60 + ve.getMinutes();
}

export const TURNOS_VISIBLES = TURNOS_CONFIG.filter(t => t.habilitado);

export function formatFechaVE(isoStr) {
  if (!isoStr) return "";
  const [y, m, d] = isoStr.split("-");
  return `${d}-${m}-${y}`;
}

const POLL_FALLBACK_MS = 5000;

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
export function QRDisplay({ qrUrl, segundos, ttlMinutes }) {
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
      <p style={{ marginTop: 6, fontSize: 11, color: "#64748B", textAlign: "center" }}>
        Se regenera automáticamente tras cada escaneo. Las fotos compartidas no son válidas.
      </p>
    </div>
  );
}

// ── Feed de actividad reciente ───────────────────────────────────────────────
function FeedActividad({ registros }) {
  if (registros.length === 0) return null;

  return (
    <div style={{ marginTop: 16, background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: "1px solid #E2E8F0", background: "#F1F5F9" }}>
        Actividad reciente
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {registros.map((r, i) => (
          <div
            key={r.id}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 14px",
              borderBottom: i < registros.length - 1 ? "1px solid #F1F5F9" : "none",
              background: i === 0 ? "#FFFBEB" : "#fff",
              transition: "background 0.3s",
            }}
          >
            <i
              className={r.tipo === "SALIDA" ? "ti ti-circle-x" : "ti ti-circle-check"}
              style={{ fontSize: 18, color: r.tipo === "SALIDA" ? "#DC2626" : "#16A34A", flexShrink: 0 }}
              aria-hidden="true"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.nombre_docente}
              </div>
              <div style={{ fontSize: 11, color: "#64748B", fontFamily: "monospace" }}>
                {r.cedula_docente}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: r.tipo === "SALIDA" ? "#DC2626" : "#15803D" }}>
                {r.tipo === "SALIDA" ? "Salida" : "Entrada"}
              </div>
              <div style={{ fontSize: 11, color: "#64748B" }}>
                {new Date(r.hora_registro).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Contador separado: docentes únicos con entrada y marcas de salida ────────
function ContadorSesion({ sessionId }) {
  const [stats, setStats] = useState({ entradas: 0, salidas: 0 });

  useEffect(() => {
    if (!sessionId) { setStats({ entradas: 0, salidas: 0 }); return; }

    const fetchStats = async () => {
      const { data } = await supabase
        .from("asistencias_diarias")
        .select("cedula_docente, tipo")
        .eq("qr_session_id", sessionId);

      if (!data) return;
      const cedulas = new Set(data.filter(r => r.tipo === "ENTRADA").map(r => r.cedula_docente));
      const salidas = new Set(data.filter(r => r.tipo === "SALIDA").map(r => r.cedula_docente));
      setStats({ entradas: cedulas.size, salidas: salidas.size });
    };

    fetchStats();

    const ch = supabase.channel(`panel_stats_${sessionId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "asistencias_diarias",
        filter: `qr_session_id=eq.${sessionId}`,
      }, fetchStats)
      .subscribe();

    const pollId = setInterval(fetchStats, POLL_FALLBACK_MS);

    return () => { supabase.removeChannel(ch); clearInterval(pollId); };
  }, [sessionId]);

  return (
    <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <div style={{ padding: "12px 14px", background: "#F0FDF4", borderRadius: 10, border: "1px solid #BBF7D0", textAlign: "center" }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#15803D" }}>{stats.entradas}</div>
        <div style={{ fontSize: 11, color: "#166534", fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <i className="ti ti-login" style={{ fontSize: 12 }} aria-hidden="true" />
          {stats.entradas === 1 ? "docente entró" : "docentes entraron"}
        </div>
      </div>
      <div style={{ padding: "12px 14px", background: "#FFF1F2", borderRadius: 10, border: "1px solid #FECDD3", textAlign: "center" }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#BE123C" }}>{stats.salidas}</div>
        <div style={{ fontSize: 11, color: "#9F1239", fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <i className="ti ti-logout" style={{ fontSize: 12 }} aria-hidden="true" />
          {stats.salidas === 1 ? "docente salió" : "docentes salieron"}
        </div>
      </div>
    </div>
  );
}

// ── Historial de sesiones del día ────────────────────────────────────────────
function HistorialSesiones({ fecha, sessionIdActiva }) {
  const [sesiones,     setSesiones]     = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [expandido,    setExpandido]    = useState(false);
  const [conteosPorId, setConteosPorId] = useState({});

  useEffect(() => {
    if (!expandido) return;
    const fetchHistorial = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("qr_sessions")
        .select("id, turno, programa, created_at, activa")
        .eq("fecha", fecha)
        .order("created_at", { ascending: false });
      const sesionesData = data || [];
      setSesiones(sesionesData);
      if (sesionesData.length > 0) {
        const ids = sesionesData.map(s => s.id);
        const { data: registros } = await supabase
          .from("asistencias_diarias")
          .select("qr_session_id, tipo")
          .in("qr_session_id", ids);
        const conteos = {};
        ids.forEach(id => { conteos[id] = { entradas: 0, salidas: 0 }; });
        (registros || []).forEach(r => {
          if (!conteos[r.qr_session_id]) return;
          if (r.tipo === "ENTRADA") conteos[r.qr_session_id].entradas++;
          if (r.tipo === "SALIDA")  conteos[r.qr_session_id].salidas++;
        });
        setConteosPorId(conteos);
      }
      setLoading(false);
    };
    fetchHistorial();
  }, [fecha, expandido, sessionIdActiva]);

  const sesionesAnteriores = sesiones.filter(s => s.id !== sessionIdActiva);

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => setExpandido(v => !v)}
        style={{ width: "100%", padding: "9px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, fontSize: 12, fontWeight: 600, color: "#334155", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-history" style={{ fontSize: 14 }} aria-hidden="true" />
          Historial de sesiones hoy
        </span>
        <i className={`ti ti-chevron-${expandido ? "up" : "down"}`} style={{ fontSize: 12, color: "#64748B" }} aria-hidden="true" />
      </button>
      {expandido && (
        <div style={{ marginTop: 8, border: "1px solid #E2E8F0", borderRadius: 9, overflow: "hidden", background: "#fff" }}>
          {loading ? (
            <div style={{ padding: "20px 14px", textAlign: "center", color: "#64748B", fontSize: 13 }}>Cargando…</div>
          ) : sesionesAnteriores.length === 0 ? (
            <div style={{ padding: "16px 14px", textAlign: "center", color: "#64748B", fontSize: 13 }}>
              {sesiones.length === 0 ? "No hay sesiones anteriores para esta fecha." : "Esta es la única sesión del día."}
            </div>
          ) : sesionesAnteriores.map((s, i) => {
            const c = conteosPorId[s.id] || { entradas: 0, salidas: 0 };
            const total = c.entradas + c.salidas;
            const turnoConf = TURNOS_CONFIG.find(t => t.id === s.turno);
            return (
              <div key={s.id} style={{ padding: "11px 14px", borderBottom: i < sesionesAnteriores.length - 1 ? "1px solid #F1F5F9" : "none", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: s.activa ? "#22C55E" : "#94A3B8", flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                    {turnoConf?.label || s.turno}
                    {s.programa ? <span style={{ color: "#64748B", fontWeight: 500 }}> · {s.programa.replace("PNF ", "")}</span> : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                    Iniciada {new Date(s.created_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
                    {" · "}<span style={{ color: s.activa ? "#15803D" : "#64748B", fontWeight: 600 }}>{s.activa ? "activa" : "cerrada"}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: total > 0 ? "#1D4ED8" : "#64748B" }}>{total}</div>
                  <div style={{ fontSize: 10, color: "#64748B" }}>{c.entradas}E · {c.salidas}S</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Panel principal ──────────────────────────────────────────────────────────
export default function AdminQRPanel({
  profile, onVerReporte, onVerProyeccion,
  activa, loading, error, sessionId,
  crearSesion, renovarManual, cerrarSesion,
}) {
  const hoy = fechaHoyVE();
  const minHoy = horaActualVE();

  const turnoDefault = TURNOS_VISIBLES.find(t => !t.finMin || minHoy < t.finMin)?.id
    || TURNOS_VISIBLES[0]?.id
    || "DIURNO";

  const [turno,    setTurno]    = useState(turnoDefault);
  const [programa, setPrograma] = useState(profile?.programa || "");
  const [fecha,    setFecha]    = useState(hoy);

  const [feedRegistros, setFeedRegistros] = useState([]);

  const esHoy = fecha === hoy;
  function turnoDisponible(tId) {
    if (!esHoy) return true;
    const conf = TURNOS_CONFIG.find(t => t.id === tId);
    return !conf?.finMin || minHoy < conf.finMin;
  }

  useEffect(() => {
    if (!sessionId) { setFeedRegistros([]); return; }

    const fetchFeed = async () => {
      const { data } = await supabase
        .from("asistencias_diarias")
        .select("id, nombre_docente, cedula_docente, tipo, hora_registro")
        .eq("qr_session_id", sessionId)
        .order("hora_registro", { ascending: false })
        .limit(10);
      setFeedRegistros(data || []);
    };

    fetchFeed();

    const ch = supabase.channel(`panel_feed_${sessionId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "asistencias_diarias",
        filter: `qr_session_id=eq.${sessionId}`,
      }, fetchFeed)
      .subscribe();

    const pollId = setInterval(fetchFeed, POLL_FALLBACK_MS);

    return () => { supabase.removeChannel(ch); clearInterval(pollId); };
  }, [sessionId]);

  const handleIniciar = () => {
    if (esHoy && !turnoDisponible(turno)) return;
    crearSesion({ turno, programa: programa || null, fecha });
  };

  const turnoInfo = TURNOS_VISIBLES.find(t => t.id === turno);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-qrcode" style={{ fontSize: 22 }} aria-hidden="true" />
            Control de Asistencias QR
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#64748B" }}>Genera el código QR y proyéctalo. Los docentes escanean y eligen Entrada o Salida.</p>
        </div>
        {onVerReporte && (
          <button onClick={onVerReporte} style={{ padding: "8px 16px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155", display: "flex", alignItems: "center", gap: 6 }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 15 }} aria-hidden="true" />
            Ver reporte del día
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* ── Columna izquierda: configuración ── */}
        <div style={{ flex: "0 0 320px", background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
            Configuración de la sesión
          </div>

          {/* Fecha */}
          <label style={{ display: "block", marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 5 }}>Fecha</span>
            <input
              type="date"
              value={fecha}
              min={hoy}
              max={hoy}
              onChange={e => setFecha(e.target.value)}
              disabled={activa}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, color: "#0F172A", background: activa ? "#F8FAFC" : "#fff", cursor: activa ? "not-allowed" : "auto", boxSizing: "border-box" }}
            />
          </label>

          {/* Turno */}
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 8 }}>Turno</span>
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
                      border: `1.5px solid ${seleccionado ? "#2563EB" : disponible ? "#E2E8F0" : "#F1F5F9"}`,
                      background: seleccionado ? "#EFF6FF" : disponible ? "#fff" : "#F8FAFC",
                      color: seleccionado ? "#1D4ED8" : disponible ? "#334155" : "#64748B",
                      cursor: activa || !disponible ? "not-allowed" : "pointer",
                      fontSize: 13, fontWeight: seleccionado ? 600 : 500,
                      textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                      opacity: !disponible ? 0.55 : activa && !seleccionado ? 0.45 : 1,
                      transition: "all 0.12s",
                    }}
                  >
                    <span>{t.label}{!disponible && esHoy ? " · ya finalizó" : ""}</span>
                    <span style={{ fontSize: 11, color: seleccionado ? "#3B82F6" : "#64748B", fontWeight: 500 }}>{t.hora}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Programa */}
          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 5 }}>Programa (opcional)</span>
            <select
              value={programa}
              onChange={e => setPrograma(e.target.value)}
              disabled={activa}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, color: "#0F172A", background: activa ? "#F8FAFC" : "#fff", cursor: activa ? "not-allowed" : "pointer", boxSizing: "border-box" }}
            >
              <option value="">Todos los programas</option>
              {DEFAULT_PROGRAMAS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          {/* Error */}
          {error && (
            <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <i className="ti ti-alert-triangle" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
              {error}
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
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <i className="ti ti-player-play" style={{ fontSize: 15 }} aria-hidden="true" />
              {loading ? "Iniciando…" : "Iniciar sesión QR"}
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={renovarManual} disabled={loading} style={{ width: "100%", padding: "10px 0", background: "#F0FDF4", color: "#15803D", border: "1.5px solid #86EFAC", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <i className="ti ti-refresh" style={{ fontSize: 14 }} aria-hidden="true" />
                Regenerar QR ahora
              </button>
              <button onClick={cerrarSesion} style={{ width: "100%", padding: "10px 0", background: "#FFF1F2", color: "#BE123C", border: "1.5px solid #FECDD3", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <i className="ti ti-player-stop" style={{ fontSize: 14 }} aria-hidden="true" />
                Cerrar sesión
              </button>
            </div>
          )}

          {activa && <ContadorSesion sessionId={sessionId} />}
          {activa && <FeedActividad registros={feedRegistros} />}
          <HistorialSesiones fecha={fecha} sessionIdActiva={sessionId} />
        </div>

        {/* ── Columna derecha: estado de la sesión (SIN el QR) ── */}
        <div style={{ flex: 1, minWidth: 280 }}>
          {!activa ? (
            <div style={{ background: "#fff", borderRadius: 12, border: "2px dashed #E2E8F0", padding: "60px 24px", textAlign: "center" }}>
              <i className="ti ti-qrcode" style={{ fontSize: 48, color: "#CBD5E1", display: "block", marginBottom: 16 }} aria-hidden="true" />
              <div style={{ fontSize: 16, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Sin sesión activa</div>
              <div style={{ fontSize: 14, color: "#64748B", maxWidth: 280, margin: "0 auto" }}>
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

              {/* Aviso + enlace a Proyección */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", padding: "32px 24px", textAlign: "center" }}>
                <i className="ti ti-device-desktop" style={{ fontSize: 40, color: "#2563EB", display: "block", marginBottom: 12 }} aria-hidden="true" />
                <div style={{ fontSize: 15, fontWeight: 700, color: "#334155", marginBottom: 6 }}>El código QR está listo</div>
                <div style={{ fontSize: 13, color: "#64748B", maxWidth: 300, margin: "0 auto 18px" }}>
                  Para mantener este panel de control fuera del alcance de los docentes, el QR y las instrucciones se muestran solo en la pestaña de proyección.
                </div>
                {onVerProyeccion && (
                  <button
                    onClick={onVerProyeccion}
                    style={{ padding: "10px 20px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <i className="ti ti-device-desktop" style={{ fontSize: 15 }} aria-hidden="true" />
                    Abrir Proyección
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
