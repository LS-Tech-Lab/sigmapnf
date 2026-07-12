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
 *
 * ARCH-15 (auditoría 12 de julio): HistorialSesiones (y su modal de
 * borrado) se extrajeron a adminQR/ — este archivo queda como orquestador
 * (estado + handlers de la sesión QR), mismo patrón ya aplicado en
 * ARCH-8/ARCH-10. FeedActividad, ContadorSesion y ColaOfflinePanel se
 * mantienen acá: son pequeños y no forman parte del hallazgo.
 */

import React, { useState, useEffect, useRef } from "react";
import { DEFAULT_PROGRAMAS, TURNOS_CONFIG } from "../../constants";
import { playRegistroSound, useFlashFeed } from "./useRegistroSound";
import { supabase } from "../../lib/supabase";
import { fechaHoyVE } from "../../utils/time";
import { contarPendientes, obtenerPendientes, eliminarPendiente, purgarExpirados } from "../../utils/offlineQueue";
// Fix ARCH-12: QRDisplay/formatFechaVE/TURNOS_VISIBLES ya no se definen
// acá — viven en su propio archivo (QRDisplay.jsx) para que QRProyeccion.jsx
// no tenga que importar este módulo completo solo para usar esos 3.
import { QRDisplay, formatFechaVE, TURNOS_VISIBLES } from "./QRDisplay";
// Fix ARCH-15: extraído a adminQR/ (ver nota arriba).
import HistorialSesiones from "./adminQR/HistorialSesiones";
import "./AdminQRPanel.css";

function horaActualVE() {
  const ve = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Caracas" }));
  return ve.getHours() * 60 + ve.getMinutes();
}

const POLL_FALLBACK_MS = 5000;

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

// ── Panel principal ──────────────────────────────────────────────────────────
export default function AdminQRPanel({
  profile, onVerReporte, onVerProyeccion,
  activa, loading, error, sessionId,
  crearSesion, renovarManual, cerrarSesion,
  isOffline = false,
  permisos = {}, showToast,
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
    <div className="qap-root">
      {/* Banner offline */}
      {isOffline && (
        <div className="qap-offline-banner">
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
          <HistorialSesiones fecha={fecha} sessionIdActiva={sessionId} permisos={permisos} showToast={showToast} />
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
