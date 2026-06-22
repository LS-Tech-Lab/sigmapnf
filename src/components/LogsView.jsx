/**
 * LogsView.jsx
 *
 * Vista de logs visible para Admin y Coordinador.
 * Dos pestañas:
 *   - Sesiones: logins, logouts, intentos fallidos
 *   - Auditoría: cambios realizados en el sistema
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { S } from "../constants";

// ── Utilidades ────────────────────────────────────────────────────────
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-VE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-VE", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ── Configuraciones de eventos y acciones ─────────────────────────────
const EVENTO_CONFIG = {
  login:          { label: "Inicio de sesión", icon: "ti-circle-check",    color: "#16A34A", bg: "#F0FDF4" },
  logout:         { label: "Cierre de sesión", icon: "ti-circle-x",        color: "#DC2626", bg: "#FEF2F2" },
  login_fallido:  { label: "Intento fallido",  icon: "ti-alert-triangle",  color: "#D97706", bg: "#FFFBEB" },
};

const ACCION_CONFIG = {
  IMPORTAR_EXCEL:      { icon: "ti-file-import",   color: "#1D4ED8" },
  BORRAR_HORARIOS:     { icon: "ti-trash",          color: "#DC2626" },
  EDITAR_DOCENTE:      { icon: "ti-pencil",         color: "#0F766E" },
  EDITAR_MATERIA:      { icon: "ti-pencil",         color: "#0F766E" },
  CERRAR_TRIMESTRE:    { icon: "ti-lock",           color: "#7C3AED" },
  CREAR_TRIMESTRE:     { icon: "ti-school",         color: "#2563EB" },
  RESTAURAR_BACKUP:    { icon: "ti-restore",        color: "#D97706" },
  EXPORTAR_BACKUP:     { icon: "ti-package-export", color: "#64748B" },
  CREAR_USUARIO:       { icon: "ti-user-plus",      color: "#2563EB" },
  EDITAR_USUARIO:      { icon: "ti-user-edit",      color: "#475569" },
  ACTIVAR_USUARIO:     { icon: "ti-user-check",     color: "#16A34A" },
  DESACTIVAR_USUARIO:  { icon: "ti-user-off",       color: "#DC2626" },
  GESTIONAR_USUARIO:   { icon: "ti-users",          color: "#7C3AED" },
};

function EventoBadge({ evento }) {
  const cfg = EVENTO_CONFIG[evento] || { label: evento, icon: "ti-info-circle", color: "#475569", bg: "#F8FAFC" };
  return (
    <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 6,
      padding: "2px 8px", fontSize: 11, fontWeight: 700,
      display: "inline-flex", alignItems: "center", gap: 4 }}>
      <i className={`ti ${cfg.icon}`} style={{ fontSize: 12 }} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}

function AccionBadge({ accion }) {
  const cfg = ACCION_CONFIG[accion] || { icon: "ti-info-circle", color: "#475569" };
  return (
    <span style={{ color: cfg.color, fontSize: 13, display: "inline-flex",
      alignItems: "center", gap: 4, fontWeight: 600 }}>
      <i className={`ti ${cfg.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />
      {accion.replace(/_/g, " ")}
    </span>
  );
}

// ── Tab Sesiones ──────────────────────────────────────────────────────
function TabSesiones({ permisos }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [filtroEmail, setFiltroEmail] = useState("");
  const [page,      setPage]      = useState(0);
  const PAGE_SIZE = 50;

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_session_logs", {
      p_limit:  PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
      p_email:  filtroEmail || null,
    });
    if (!error) setLogs(data || []);
    setLoading(false);
  }, [filtroEmail, page]);

  useEffect(() => { cargar(); }, [cargar]);

  const stats = logs.reduce((acc, l) => {
    acc[l.evento] = (acc[l.evento] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={filtroEmail} onChange={e => { setFiltroEmail(e.target.value); setPage(0); }}
          placeholder="Filtrar por correo…"
          style={{ ...S.input, flex: 1, minWidth: 200 }}
        />
        <button onClick={cargar} style={{ ...S.btn(false), flexShrink: 0,
          display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-refresh" style={{ fontSize: 14 }} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {/* Mini stats */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {Object.entries(EVENTO_CONFIG).map(([k, v]) => (
          <div key={k} style={{ background: v.bg, color: v.color, borderRadius: 8,
            padding: "8px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 18 }}>{stats[k] || 0}</span>
            <i className={`ti ${v.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />
            <span>{v.label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 32, color: "#94A3B8" }}>Cargando…</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}>
          <i className="ti ti-clipboard-list" style={{ fontSize: 28, display: "block", marginBottom: 8 }} aria-hidden="true" />
          No hay registros de sesión.
        </div>
      ) : (
        <div style={{ ...S.card, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Fecha y hora", "Usuario", "Rol", "Evento"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={S.td}>
                    <div style={{ fontSize: 13, color: "#475569" }}>
                      {fmtDateTime(log.created_at)}
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
                      {log.nombre || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>{log.email}</div>
                    {log.programa && (
                      <div style={{ fontSize: 10, color: "#0F766E", fontWeight: 600 }}>
                        {log.programa}
                      </div>
                    )}
                  </td>
                  <td style={S.td}>
                    <span style={{ fontSize: 12, color: "#475569" }}>
                      {log.rol || "—"}
                    </span>
                  </td>
                  <td style={S.td}>
                    <EventoBadge evento={log.evento} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
        <button onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0} style={S.btn(false)}>
          ← Anterior
        </button>
        <span style={{ padding: "7px 14px", fontSize: 13, color: "#475569" }}>
          Página {page + 1}
        </span>
        <button onClick={() => setPage(p => p + 1)}
          disabled={logs.length < PAGE_SIZE} style={S.btn(false)}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}

// ── Tab Auditoría ─────────────────────────────────────────────────────
function TabAuditoria({ permisos }) {
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filtroEmail, setFiltroEmail] = useState("");
  const [filtroAccion, setFiltroAccion] = useState("");
  const [filtroLapso, setFiltroLapso]  = useState("");
  const [expandido,  setExpandido]  = useState(null);
  const [page,       setPage]       = useState(0);
  const PAGE_SIZE = 50;

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_audit_logs", {
      p_limit:   PAGE_SIZE,
      p_offset:  page * PAGE_SIZE,
      p_email:   filtroEmail  || null,
      p_accion:  filtroAccion || null,
      p_lapso:   filtroLapso  || null,
      p_programa: null,
    });
    if (!error) setLogs(data || []);
    setLoading(false);
  }, [filtroEmail, filtroAccion, filtroLapso, page]);

  useEffect(() => { cargar(); }, [cargar]);

  const accionesUnicas = [...new Set(logs.map(l => l.accion))].sort();

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          value={filtroEmail} onChange={e => { setFiltroEmail(e.target.value); setPage(0); }}
          placeholder="Filtrar por usuario…"
          style={{ ...S.input, flex: 1, minWidth: 160 }}
        />
        <select value={filtroAccion} onChange={e => { setFiltroAccion(e.target.value); setPage(0); }}
          style={{ ...S.select, minWidth: 180 }}>
          <option value="">Todas las acciones</option>
          {accionesUnicas.map(a => (
            <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
          ))}
        </select>
        <input
          value={filtroLapso} onChange={e => { setFiltroLapso(e.target.value); setPage(0); }}
          placeholder="Trimestre (ej: 2-2025)"
          style={{ ...S.input, width: 140 }}
        />
        <button onClick={() => { setFiltroEmail(""); setFiltroAccion(""); setFiltroLapso(""); setPage(0); }}
          style={{ ...S.btn(false), flexShrink: 0 }}>
          Limpiar
        </button>
        <button onClick={cargar} style={{ ...S.btn(false), flexShrink: 0,
          display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-refresh" style={{ fontSize: 14 }} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 32, color: "#94A3B8" }}>Cargando…</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}>
          <i className="ti ti-folders" style={{ fontSize: 28, display: "block", marginBottom: 8 }} aria-hidden="true" />
          No hay registros de auditoría.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {logs.map(log => {
            const isOpen = expandido === log.id;
            const cfg = ACCION_CONFIG[log.accion] || { icon: "ti-info-circle", color: "#475569" };

            return (
              <div key={log.id} style={{ ...S.card, borderLeft: `3px solid ${cfg.color}` }}>
                {/* Cabecera */}
                <div
                  onClick={() => setExpandido(isOpen ? null : log.id)}
                  style={{ display: "flex", alignItems: "center", padding: "12px 16px",
                    cursor: "pointer", gap: 12, userSelect: "none" }}>

                  <i className={`ti ${cfg.icon}`}
                     style={{ fontSize: 20, color: cfg.color, flexShrink: 0 }} aria-hidden="true" />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <AccionBadge accion={log.accion} />
                      {log.lapso && (
                        <span style={{ background: "#EFF6FF", color: "#1D4ED8",
                          borderRadius: 5, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>
                          {log.lapso}
                        </span>
                      )}
                      {log.programa_afectado && (
                        <span style={{ background: "#F0FDF4", color: "#166534",
                          borderRadius: 5, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>
                          {log.programa_afectado}
                        </span>
                      )}
                    </div>
                    {log.resumen && (
                      <div style={{ fontSize: 12, color: "#64748B", marginTop: 3 }}>
                        {log.resumen}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
                      {log.nombre || log.email}
                    </div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>
                      {fmtDateTime(log.created_at)}
                    </div>
                  </div>

                  <i className={`ti ${isOpen ? "ti-chevron-up" : "ti-chevron-down"}`}
                     style={{ color: "#94A3B8", fontSize: 14, flexShrink: 0 }} aria-hidden="true" />
                </div>

                {/* Detalle expandible */}
                {isOpen && (
                  <div style={{ borderTop: "1px solid #F1F5F9", padding: "14px 16px",
                    background: "#FAFAFA" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10,
                      marginBottom: 12 }}>
                      {[
                        { label: "Usuario",   val: `${log.nombre || "—"} (${log.email})` },
                        { label: "Rol",       val: log.rol || "—" },
                        { label: "Entidad",   val: log.entidad || "—" },
                        { label: "Fecha",     val: fmtDateTime(log.created_at) },
                      ].map(({ label, val }) => (
                        <div key={label}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8",
                            textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            {label}
                          </div>
                          <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{val}</div>
                        </div>
                      ))}
                    </div>

                    {(log.datos_antes || log.datos_despues) && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {log.datos_antes && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#DC2626",
                              marginBottom: 4 }}>Estado anterior</div>
                            <pre style={{ fontSize: 11, background: "#FEF2F2", borderRadius: 6,
                              padding: "8px 10px", color: "#7F1D1D", overflow: "auto",
                              margin: 0, maxHeight: 120 }}>
                              {JSON.stringify(log.datos_antes, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.datos_despues && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#16A34A",
                              marginBottom: 4 }}>Estado nuevo</div>
                            <pre style={{ fontSize: 11, background: "#F0FDF4", borderRadius: 6,
                              padding: "8px 10px", color: "#14532D", overflow: "auto",
                              margin: 0, maxHeight: 120 }}>
                              {JSON.stringify(log.datos_despues, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Paginación */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
        <button onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0} style={S.btn(false)}>
          ← Anterior
        </button>
        <span style={{ padding: "7px 14px", fontSize: 13, color: "#475569" }}>
          Página {page + 1}
        </span>
        <button onClick={() => setPage(p => p + 1)}
          disabled={logs.length < PAGE_SIZE} style={S.btn(false)}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────
export default function LogsView({ permisos }) {
  const [tab, setTab] = useState("sesiones");

  if (!permisos.puedeVerLogs) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>
        <i className="ti ti-lock" style={{ fontSize: 40, display: "block", marginBottom: 12 }} aria-hidden="true" />
        <div style={{ fontSize: 14 }}>No tienes permiso para ver los registros del sistema.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1000, margin: "0 auto" }}>
      {/* Encabezado */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
          Registros del Sistema
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748B" }}>
          Historial de sesiones y auditoría de cambios
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "2px solid #E2E8F0" }}>
        {[
          { id: "sesiones",  icon: "ti-key",         label: "Registros de sesión" },
          { id: "auditoria", icon: "ti-list-details", label: "Auditoría de cambios" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "8px 18px", border: "none", background: "none", cursor: "pointer",
              fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? "#2563EB" : "#64748B",
              borderBottom: tab === t.id ? "2px solid #2563EB" : "2px solid transparent",
              marginBottom: -2, display: "flex", alignItems: "center", gap: 6,
            }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sesiones"  && <TabSesiones  permisos={permisos} />}
      {tab === "auditoria" && <TabAuditoria permisos={permisos} />}
    </div>
  );
}
