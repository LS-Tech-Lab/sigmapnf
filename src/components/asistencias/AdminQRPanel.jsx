/**
 * AdminQRPanel.jsx
 *
 * Panel del admin/operador_qr para gestionar la sesión QR.
 *
 * U-1 (auditoría Junio 2026): estilos migrados a AdminQRPanel.css usando
 * tokens del sistema (var(--brand-*), var(--color-*)). Eliminados los 142
 * bloques style={{}} inline que existían en la versión anterior.
 *
 * A3 (auditoría 2026-07-02, segunda pasada): funcionalidad añadida después
 * de U-1 (CountdownBar, FeedActividad, ContadorSesion, ColaOfflinePanel,
 * HistorialSesiones) había vuelto a introducir 34 bloques style={{}}. Se
 * migraron todos salvo 2 legítimamente dinámicos (color de la barra de
 * countdown, que depende del tiempo restante). Si este comentario alguna
 * vez vuelve a no coincidir con el código, confiar en un grep de
 * `style={{` sobre el archivo, no en este texto — así se detectó la
 * desincronización anterior (ver docs/AUDITORIA_INDICE.md, nota bajo U-1).
 */

import React, { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { DEFAULT_PROGRAMAS, TURNOS_CONFIG } from "../../constants";
import { playRegistroSound, useFlashFeed } from "./useRegistroSound";
import { supabase } from "../../lib/supabase";
import { fechaHoyVE } from "../../utils/time";
import { contarPendientes, obtenerPendientes, eliminarPendiente, purgarExpirados } from "../../utils/offlineQueue";
import "./AdminQRPanel.css";

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
    <div className="qrp-cdb-root">
      <div className="qrp-cdb-header">
        <span>Próxima rotación</span>
        <span className="qrp-cdb-time" style={{ color }}>
          {Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="qrp-cdb-track">
        <div className="qrp-cdb-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

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
    <div className="qrp-qr-wrap">
      <canvas ref={canvasRef} className="qrp-qr-canvas" />
      <CountdownBar segundos={segundos} total={ttlMinutes * 60} />
      <p className="qrp-cdb-note">
        Se regenera automáticamente tras cada escaneo. Las fotos compartidas no son válidas.
      </p>
    </div>
  );
}

// ── Feed de actividad reciente ───────────────────────────────────────────────
function FeedActividad({ registros, flash }) {
  if (registros.length === 0) return null;
  return (
    <div className={`qrp-feed ${flash ? "qrp-feed--flash" : "qrp-feed--idle"}`}>
      <div className="qrp-feed-header">Actividad reciente</div>
      <div className="qrp-feed-body">
        {registros.map((r, i) => (
          <div
            key={r.id}
            className={`qrp-feed-row ${i === 0 ? "qrp-feed-row--first" : "qrp-feed-row--rest"} ${i < registros.length - 1 ? "qrp-feed-row-sep" : ""}`}
          >
            <i
              className={`${r.tipo === "SALIDA" ? "ti ti-circle-x" : "ti ti-circle-check"} qrp-feed-icon ${r.tipo === "SALIDA" ? "qrp-feed-icon--salida" : "qrp-feed-icon--entrada"}`}
              aria-hidden="true"
            />
            <div className="qrp-feed-main">
              <div className="qrp-feed-name">{r.nombre_docente}</div>
              <div className="qrp-feed-ced">{r.cedula_docente}</div>
            </div>
            <div className="qrp-feed-right">
              <div className={`qrp-feed-tipo ${r.tipo === "SALIDA" ? "qrp-feed-tipo--salida" : "qrp-feed-tipo--entrada"}`}>
                {r.tipo === "SALIDA" ? "Salida" : "Entrada"}
              </div>
              <div className="qrp-feed-hora">
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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "asistencias_diarias", filter: `qr_session_id=eq.${sessionId}` }, fetchStats)
      .subscribe();
    const pollId = setInterval(fetchStats, POLL_FALLBACK_MS);
    return () => { supabase.removeChannel(ch); clearInterval(pollId); };
  }, [sessionId]);

  return (
    <div className="qrp-counter">
      <div className="qrp-counter-card qrp-counter-card--e">
        <div className={`qrp-counter-n qrp-counter-n--e`}>{stats.entradas}</div>
        <div className="qrp-counter-lbl qrp-counter-lbl--e">
          <i className="ti ti-login qrp-ic-12" aria-hidden="true" />
          {stats.entradas === 1 ? "docente entró" : "docentes entraron"}
        </div>
      </div>
      <div className="qrp-counter-card qrp-counter-card--s">
        <div className={`qrp-counter-n qrp-counter-n--s`}>{stats.salidas}</div>
        <div className="qrp-counter-lbl qrp-counter-lbl--s">
          <i className="ti ti-logout qrp-ic-12" aria-hidden="true" />
          {stats.salidas === 1 ? "docente salió" : "docentes salieron"}
        </div>
      </div>
    </div>
  );
}

// ── Cola offline panel ───────────────────────────────────────────────────────
function ColaOfflinePanel() {
  const [conteo,       setConteo]       = useState(null);
  const [items,        setItems]        = useState([]);
  const [expandido,    setExpandido]    = useState(false);
  const [purgando,     setPurgando]     = useState(false);
  const [confirmPurga, setConfirmPurga] = useState(false);

  const cargar = async () => {
    try {
      const lista = await obtenerPendientes();
      setItems(lista); setConteo(lista.length);
    } catch { setConteo(0); }
  };

  useEffect(() => { cargar(); }, []);
  useEffect(() => { if (expandido) cargar(); }, [expandido]);

  const handlePurgar = async () => {
    setPurgando(true);
    try { for (const item of items) await eliminarPendiente(item.id); await cargar(); }
    catch { /* silencioso */ }
    setPurgando(false);
  };

  const handlePurgarExpirados = async () => {
    setPurgando(true);
    try { await purgarExpirados(); await cargar(); }
    catch { /* silencioso */ }
    setPurgando(false);
  };

  if (conteo === 0 && !expandido) return null;

  return (
    <div className="qrp-cola">
      <button
        onClick={() => setExpandido(v => !v)}
        className={`qrp-cola-toggle ${conteo > 0 ? "qrp-cola-toggle--pending" : "qrp-cola-toggle--empty"}`}
      >
        <span className="qrp-cola-toggle-left">
          <i className="ti ti-clock-upload qrp-ic-14" aria-hidden="true" />
          Cola offline
          {conteo != null && conteo > 0 && (
            <span className="qrp-cola-badge">{conteo}</span>
          )}
        </span>
        <i className={`ti ti-chevron-${expandido ? "up" : "down"} qrp-ic-12`} aria-hidden="true" />
      </button>

      {expandido && (
        <div className="qrp-cola-body">
          {conteo === 0 ? (
            <div className="qrp-cola-empty-msg">No hay registros pendientes de sincronizar.</div>
          ) : (
            <>
              <div className="qrp-cola-info">
                <strong>{conteo}</strong> registro{conteo !== 1 ? "s" : ""} guardado{conteo !== 1 ? "s" : ""} offline pendiente{conteo !== 1 ? "s" : ""} de sincronizar.
                {" "}Se enviarán automáticamente al reconectar.
              </div>
              <div className="qrp-cola-list">
                {items.map((item, i) => {
                  const fecha   = item.creadoEn ? new Date(item.creadoEn) : null;
                  const edadMs  = fecha ? Date.now() - item.creadoEn : null;
                  const vencido = edadMs && edadMs > 48 * 3600 * 1000;
                  return (
                    <div
                      key={item.id}
                      className={`qrp-cola-item ${i < items.length - 1 ? "qrp-cola-item--sep" : ""} ${vencido ? "qrp-cola-item--exp" : "qrp-cola-item--ok"}`}
                    >
                      <div>
                        <span className="qrp-cola-item-ced">{item.p_cedula_docente || item.cedula_docente || "—"}</span>
                        <span className="qrp-cola-item-tipo">{item.p_tipo || item.tipo || ""}</span>
                      </div>
                      <div className={`qrp-cola-item-fecha ${vencido ? "qrp-cola-item-fecha--exp" : "qrp-cola-item-fecha--ok"}`}>
                        {fecha ? fecha.toLocaleString("es-VE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                        {vencido && <span className="qrp-cola-item-venc">⚠ vencido</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="qrp-cola-actions">
                <button onClick={handlePurgarExpirados} disabled={purgando} className="qrp-btn-purgar-exp">
                  <i className="ti ti-trash qrp-ic-12-mr4" aria-hidden="true" />
                  Purgar expirados
                </button>
                <button onClick={() => setConfirmPurga(true)} disabled={purgando} className="qrp-btn-purgar-all">
                  <i className="ti ti-trash-x qrp-ic-12-mr4" aria-hidden="true" />
                  Vaciar todo
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {confirmPurga && (
        <div className="qrp-modal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="modal-purga-title">
          <div className="qrp-modal">
            <div className="qrp-modal-header">
              <div className="qrp-modal-icon">
                <i className="ti ti-trash-x qrp-ic-danger-22" aria-hidden="true" />
              </div>
              <div>
                <div id="modal-purga-title" className="qrp-modal-title">¿Vaciar cola offline?</div>
                <div className="qrp-modal-subtitle">Esta acción no se puede deshacer</div>
              </div>
            </div>
            <p className="qrp-modal-body">
              Se eliminarán los <strong>{conteo}</strong> registro{conteo !== 1 ? "s" : ""} pendiente{conteo !== 1 ? "s" : ""} de sincronizar.
              Si la conexión se recupera, <strong>no se enviarán</strong> al servidor.
            </p>
            <div className="qrp-modal-actions">
              <button onClick={() => setConfirmPurga(false)} className="qrp-btn-cancel">Cancelar</button>
              <button onClick={() => { setConfirmPurga(false); handlePurgar(); }} className="qrp-btn-danger">Sí, vaciar todo</button>
            </div>
          </div>
        </div>
      )}
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
    <div className="qrp-hist">
      <button onClick={() => setExpandido(v => !v)} className="qrp-hist-toggle">
        <span className="qrp-hist-toggle-left">
          <i className="ti ti-history qrp-ic-14" aria-hidden="true" />
          Historial de sesiones hoy
        </span>
        <i className={`ti ti-chevron-${expandido ? "up" : "down"} qrp-ic-12`} aria-hidden="true" />
      </button>

      {expandido && (
        <div className="qrp-hist-body">
          {loading ? (
            <div className="qrp-hist-loading">Cargando…</div>
          ) : sesionesAnteriores.length === 0 ? (
            <div className="qrp-hist-empty">
              {sesiones.length === 0 ? "No hay sesiones anteriores para esta fecha." : "Esta es la única sesión del día."}
            </div>
          ) : sesionesAnteriores.map((s, i) => {
            const c     = conteosPorId[s.id] || { entradas: 0, salidas: 0 };
            const total = c.entradas + c.salidas;
            const turnoConf = TURNOS_CONFIG.find(t => t.id === s.turno);
            return (
              <div key={s.id} className={`qrp-hist-row ${i < sesionesAnteriores.length - 1 ? "qrp-hist-row-sep" : ""}`}>
                <span className={`qrp-hist-dot ${s.activa ? "qrp-hist-dot--on" : "qrp-hist-dot--off"}`} />
                <div className="qrp-flex-main">
                  <div className="qrp-hist-title">
                    {turnoConf?.label || s.turno}
                    {s.programa && <span className="qrp-hist-prog"> · {s.programa.replace("PNF ", "")}</span>}
                  </div>
                  <div className="qrp-hist-sub">
                    Iniciada {new Date(s.created_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    <span className={s.activa ? "qrp-hist-status--on" : "qrp-hist-status--off"}>
                      {s.activa ? "activa" : "cerrada"}
                    </span>
                  </div>
                </div>
                <div className="qrp-hist-count">
                  <div className={`qrp-hist-count-n ${total > 0 ? "qrp-hist-count-n--pos" : "qrp-hist-count-n--zero"}`}>{total}</div>
                  <div className="qrp-hist-count-sub">{c.entradas}E · {c.salidas}S</div>
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
  isOffline = false,
}) {
  const hoy    = fechaHoyVE();
  const minHoy = horaActualVE();

  const turnoDefault = TURNOS_VISIBLES.find(t => !t.finMin || minHoy < t.finMin)?.id
    || TURNOS_VISIBLES[0]?.id
    || "DIURNO";

  const [turno,    setTurno]    = useState(turnoDefault);
  const [programa, setPrograma] = useState(profile?.programa || "");
  const [fecha,    setFecha]    = useState(hoy);
  const [feedRegistros, setFeedRegistros] = useState([]);
  const feedRegistrosRef = useRef([]);
  const { flash: feedFlash, trigger: flashTrigger } = useFlashFeed();
  const [confirmCierre, setConfirmCierre] = useState(false);

  const esHoy = fecha === hoy;

  function turnoIndisponibleRazon(tId) {
    if (!esHoy) return null;
    const conf = TURNOS_CONFIG.find(t => t.id === tId);
    if (!conf) return null;
    if (conf.inicioMin !== undefined && minHoy < conf.inicioMin) return "aún no ha comenzado";
    if (conf.finMin    !== undefined && minHoy >= conf.finMin)   return "ya finalizó";
    return null;
  }

  function turnoDisponible(tId) { return turnoIndisponibleRazon(tId) === null; }

  useEffect(() => {
    if (!sessionId) { setFeedRegistros([]); return; }

    const fetchFeed = async () => {
      const { data } = await supabase
        .from("asistencias_diarias")
        .select("id, nombre_docente, cedula_docente, tipo, hora_registro")
        .eq("qr_session_id", sessionId)
        .order("hora_registro", { ascending: false })
        .limit(10);
      const prev = feedRegistrosRef.current;
      const next = data || [];
      if (prev.length > 0 && next.length > prev.length) { playRegistroSound(); flashTrigger(); }
      feedRegistrosRef.current = next;
      setFeedRegistros(next);
    };

    fetchFeed();
    const ch = supabase.channel(`panel_feed_${sessionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "asistencias_diarias", filter: `qr_session_id=eq.${sessionId}` }, fetchFeed)
      .subscribe();
    const pollId = setInterval(fetchFeed, POLL_FALLBACK_MS);
    return () => { supabase.removeChannel(ch); clearInterval(pollId); };
  }, [sessionId]);

  const handleIniciar = () => {
    if (esHoy && !turnoDisponible(turno)) return;
    crearSesion({ turno, programa: programa || null, fecha });
  };

  const turnoInfo     = TURNOS_VISIBLES.find(t => t.id === turno);
  const btnDisabled   = loading || fecha < hoy || (esHoy && !turnoDisponible(turno));

  return (
    <div className="qrp-root">
      {/* Banner offline */}
      {isOffline && (
        <div className="qrp-offline-banner">
          <i className="ti ti-wifi-off qrp-ic-danger-20" aria-hidden="true" />
          <div>
            <div className="qrp-offline-title">Sin conexión a internet</div>
            <div className="qrp-offline-sub">
              {activa
                ? "La renovación automática del QR está pausada. Al recuperar la red se reanudará automáticamente."
                : "No es posible iniciar una sesión QR sin conexión."}
            </div>
          </div>
        </div>
      )}

      {/* Cabecera */}
      <div className="qrp-header">
        <div>
          <h1 className="qrp-header-title">
            <i className="ti ti-qrcode qrp-ic-22" aria-hidden="true" />
            Control de Asistencias QR
          </h1>
          <p className="qrp-header-subtitle">Genera el código QR y proyéctalo. Los docentes escanean y eligen Entrada o Salida.</p>
        </div>
        {onVerReporte && (
          <button onClick={onVerReporte} className="qrp-btn-reporte">
            <i className="ti ti-clipboard-list qrp-ic-15" aria-hidden="true" />
            Ver reporte del día
          </button>
        )}
      </div>

      <div className="qrp-body">
        {/* ── Columna izquierda: configuración ── */}
        <div className="qrp-col-left">
          <div className="qrp-section-label">Configuración de la sesión</div>

          {/* Fecha */}
          <label className="qrp-field">
            <span className="qrp-field-label">Fecha</span>
            <input
              type="date"
              value={fecha}
              min={hoy}
              max={hoy}
              onChange={e => setFecha(e.target.value)}
              disabled={activa}
              className={`qrp-input-base${activa ? ' qrp-input-base--disabled' : ''}`}
            />
          </label>

          {/* Turno */}
          <div className="qrp-turno-wrap">
            <span className="qrp-field-label">Turno</span>
            <div className={`qrp-turno-list${activa ? ' qrp-turno-list--locked' : ''}`}>
              {TURNOS_VISIBLES.map(t => {
                const disponible  = turnoDisponible(t.id);
                const seleccionado = turno === t.id;
                const cls = seleccionado ? "qrp-turno-btn--sel" : disponible ? "qrp-turno-btn--ok" : "qrp-turno-btn--dis";
                return (
                  <button
                    key={t.id}
                    onClick={() => !activa && disponible && setTurno(t.id)}
                    disabled={activa || !disponible}
                    title={!disponible ? `Este turno ${turnoIndisponibleRazon(t.id)} hoy` : ""}
                    className={`qrp-turno-btn ${cls}`}
                  >
                    <span>{t.label}{!disponible && esHoy ? ` · ${turnoIndisponibleRazon(t.id)}` : ""}</span>
                    <span className="qrp-turno-hora">{t.hora}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Aviso de turno no disponible */}
          {esHoy && !turnoDisponible(turno) && (() => {
            const razon       = turnoIndisponibleRazon(turno);
            const turnoLabel  = TURNOS_VISIBLES.find(t => t.id === turno)?.label || turno;
            const esAnticipado = razon === "aún no ha comenzado";
            return (
              <div className={`qrp-turno-aviso ${esAnticipado ? "qrp-turno-aviso--warn" : "qrp-turno-aviso--error"}`}>
                <i
                  className={`ti ${esAnticipado ? "ti-clock" : "ti-alert-triangle"} qrp-turno-aviso-icon ${esAnticipado ? "qrp-turno-aviso-icon--warn" : "qrp-turno-aviso-icon--error"}`}
                  aria-hidden="true"
                />
                <span className={`qrp-turno-aviso-text ${esAnticipado ? "qrp-turno-aviso-text--warn" : "qrp-turno-aviso-text--error"}`}>
                  {esAnticipado
                    ? <><strong>{turnoLabel}</strong> aún no ha comenzado. Solo puedes iniciarlo a partir de su hora de inicio.</>
                    : <><strong>{turnoLabel}</strong> ya finalizó hoy. Selecciona otro turno.</>
                  }
                </span>
              </div>
            );
          })()}

          {/* Programa */}
          <label className="qrp-field-last">
            <span className="qrp-field-label">Programa (opcional)</span>
            <select
              value={programa}
              onChange={e => setPrograma(e.target.value)}
              disabled={activa}
              className={`qrp-select-base${activa ? ' qrp-select-base--disabled' : ''}`}
            >
              <option value="">Todos los programas</option>
              {DEFAULT_PROGRAMAS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          {/* Error */}
          {error && (
            <div className="qrp-error-box">
              <i className="ti ti-alert-triangle qrp-error-icon" aria-hidden="true" />
              {error}
            </div>
          )}

          {/* Botones */}
          {!activa ? (
            <button
              onClick={handleIniciar}
              disabled={btnDisabled}
              className={`qrp-btn-iniciar ${btnDisabled ? "qrp-btn-iniciar--off" : "qrp-btn-iniciar--on"}`}
            >
              <i className="ti ti-player-play qrp-ic-15" aria-hidden="true" />
              {loading ? "Iniciando…" : "Iniciar sesión QR"}
            </button>
          ) : (
            <div className="qrp-btn-group">
              <button onClick={renovarManual} disabled={loading} className="qrp-btn-renovar">
                <i className="ti ti-refresh qrp-ic-14" aria-hidden="true" />
                Regenerar QR ahora
              </button>
              <button onClick={() => setConfirmCierre(true)} className="qrp-btn-cerrar">
                <i className="ti ti-player-stop qrp-ic-14" aria-hidden="true" />
                Cerrar sesión
              </button>

              {confirmCierre && (
                <div className="qrp-modal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="modal-cierre-title">
                  <div className="qrp-modal">
                    <div className="qrp-modal-header">
                      <div className="qrp-modal-icon">
                        <i className="ti ti-alert-triangle qrp-ic-danger-22" aria-hidden="true" />
                      </div>
                      <div>
                        <div id="modal-cierre-title" className="qrp-modal-title">¿Cerrar la sesión QR?</div>
                        <div className="qrp-modal-subtitle">Esta acción no se puede deshacer</div>
                      </div>
                    </div>
                    <p className="qrp-modal-body">
                      Los docentes que solo marcaron <strong>entrada</strong> quedarán sin registro de salida.
                      Asegúrate de que todos hayan completado su marca antes de cerrar.
                    </p>
                    <div className="qrp-modal-actions">
                      <button onClick={() => setConfirmCierre(false)} className="qrp-btn-cancel">Cancelar</button>
                      <button onClick={() => { setConfirmCierre(false); cerrarSesion(); }} className="qrp-btn-danger">Sí, cerrar sesión</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activa && <ContadorSesion sessionId={sessionId} />}
          {activa && <FeedActividad registros={feedRegistros} flash={feedFlash} />}
          <ColaOfflinePanel />
          <HistorialSesiones fecha={fecha} sessionIdActiva={sessionId} />
        </div>

        {/* ── Columna derecha: estado de la sesión ── */}
        <div className="qrp-col-right">
          {!activa ? (
            <div className="qrp-empty">
              <i className="ti ti-qrcode qrp-empty-icon" aria-hidden="true" />
              <div className="qrp-empty-title">Sin sesión activa</div>
              <div className="qrp-empty-sub">
                Configura el turno y la fecha, luego pulsa <strong>Iniciar sesión QR</strong>.
              </div>
            </div>
          ) : (
            <div>
              <div className="qrp-active-banner">
                <span className="qrp-active-dot" />
                <span className="qrp-active-label">
                  Sesión activa · {turnoInfo?.label} · {formatFechaVE(fecha)}
                  {programa ? ` · ${programa.replace("PNF ", "")}` : ""}
                </span>
              </div>

              <div className="qrp-active-qr-card">
                <i className="ti ti-device-desktop qrp-active-qr-icon" aria-hidden="true" />
                <div className="qrp-active-qr-title">El código QR está listo</div>
                <div className="qrp-active-qr-desc">
                  Para mantener este panel de control fuera del alcance de los docentes, el QR y las instrucciones se muestran solo en la pestaña de proyección.
                </div>
                <div className="qrp-active-qr-btns">
                  {onVerProyeccion && (
                    <button onClick={onVerProyeccion} className="qrp-btn-proyeccion">
                      <i className="ti ti-device-desktop qrp-ic-15" aria-hidden="true" />
                      Proyección aquí
                    </button>
                  )}
                  <button
                    onClick={() => window.open(window.location.href + "?proyeccion=1", "_blank", "noopener")}
                    title="Abre la proyección en una ventana separada (ideal para segundo monitor o proyector)"
                    className="qrp-btn-nueva-ventana"
                  >
                    <i className="ti ti-external-link qrp-ic-15" aria-hidden="true" />
                    Nueva ventana
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
