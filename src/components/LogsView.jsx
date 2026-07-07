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
import "./LogsView.css";

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
  UNIFICAR_DOCENTE:    { icon: "ti-git-merge",      color: "#0F766E" },
  EDITAR_MATERIA:      { icon: "ti-pencil",         color: "#0F766E" },
  UNIFICAR_MATERIA:    { icon: "ti-git-merge",      color: "#0F766E" },
  CERRAR_TRIMESTRE:    { icon: "ti-lock",           color: "#7C3AED" },
  CREAR_TRIMESTRE:     { icon: "ti-school",         color: "#2563EB" },
  RESTAURAR_BACKUP:    { icon: "ti-restore",        color: "#D97706" },
  EXPORTAR_BACKUP:     { icon: "ti-package-export", color: "#64748B" },
  CREAR_USUARIO:       { icon: "ti-user-plus",      color: "#2563EB" },
  EDITAR_USUARIO:      { icon: "ti-user-edit",      color: "#475569" },
  ACTIVAR_USUARIO:     { icon: "ti-user-check",     color: "#16A34A" },
  DESACTIVAR_USUARIO:  { icon: "ti-user-off",       color: "#DC2626" },
  GESTIONAR_USUARIO:   { icon: "ti-users",          color: "#7C3AED" },
  // M-1: acciones de roles (añadidas con el fix de auditoría de roles)
  CREAR_ROL:           { icon: "ti-shield-plus",    color: "#2563EB" },
  EDITAR_ROL:          { icon: "ti-shield-check",   color: "#0F766E" },
  ELIMINAR_ROL:        { icon: "ti-shield-off",     color: "#DC2626" },
};

// Fix A3/S3 (auditoría QA 5/jul/2026, Fase 2): EVENTO_CONFIG/ACCION_CONFIG
// son objetos fijos hardcodeados arriba — no son "dato" en el sentido que
// bloquea CSP. Las clases .lv-c-<evento>/.lv-a-<accion> (ver src/index.css)
// reemplazan el fondo/color que antes se inyectaba vía estilo inline.
function eventoClass(evento) {
  const key = (evento || "").toLowerCase();
  return EVENTO_CONFIG[key] ? `lv-c-${key}` : "lv-c-default";
}
function accionClass(accion) {
  const key = (accion || "").toLowerCase();
  return ACCION_CONFIG[accion?.toUpperCase()] ? `lv-a-${key}` : "lv-a-default";
}

function EventoBadge({ evento }) {
  const cfg = EVENTO_CONFIG[evento] || { label: evento, icon: "ti-info-circle" };
  return (
    <span className={`lv-evento-badge ${eventoClass(evento)}`}>
      <i className={`ti ${cfg.icon} lv-evento-badge-icon`} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}

function AccionBadge({ accion }) {
  const cfg = ACCION_CONFIG[accion] || { icon: "ti-info-circle" };
  return (
    <span className={`lv-accion-badge ${accionClass(accion)}`}>
      <i className={`ti ${cfg.icon} lv-accion-badge-icon`} aria-hidden="true" />
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
      <div className="lv-filtros-row">
        <input
          value={filtroEmail} onChange={e => { setFiltroEmail(e.target.value); setPage(0); }}
          placeholder="Filtrar por correo…"
          className="s-input lv-input--email200"
        />
        <button onClick={cargar} className="s-btn lv-btn-icon">
          <i className="ti ti-refresh lv-icon-14" aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {/* Mini stats */}
      <div className="lv-filtros-row--center">
        {Object.entries(EVENTO_CONFIG).map(([k, v]) => (
          <div key={k} className={`lv-stat-chip ${eventoClass(k)}`}>
            <span className="lv-stat-chip-count">{stats[k] || 0}</span>
            <i className={`ti ${v.icon} lv-icon-14`} aria-hidden="true" />
            <span>{v.label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="lv-state-loading">Cargando…</div>
      ) : logs.length === 0 ? (
        <div className="lv-state-empty">
          <i className="ti ti-clipboard-list lv-state-empty-icon" aria-hidden="true" />
          No hay registros de sesión.
        </div>
      ) : (
        <div className="s-card lv-table-card">
          <table className="lv-table">
            <thead>
              <tr>
                {["Fecha y hora", "Usuario", "Rol", "Evento"].map(h => (
                  <th key={h} className="s-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td className="s-td">
                    <div className="lv-td-fecha">
                      {fmtDateTime(log.created_at)}
                    </div>
                  </td>
                  <td className="s-td">
                    <div className="lv-td-user-name">
                      {log.nombre || "—"}
                    </div>
                    <div className="lv-td-user-email">{log.email}</div>
                    {log.programa && (
                      <div className="lv-td-user-programa">
                        {log.programa}
                      </div>
                    )}
                  </td>
                  <td className="s-td">
                    <span className="lv-td-rol">
                      {log.rol || "—"}
                    </span>
                  </td>
                  <td className="s-td">
                    <EventoBadge evento={log.evento} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      <div className="lv-pagination">
        <button onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0} className="s-btn">
          ← Anterior
        </button>
        <span className="lv-pagination-label">
          Página {page + 1}
        </span>
        <button onClick={() => setPage(p => p + 1)}
          disabled={logs.length < PAGE_SIZE} className="s-btn">
          Siguiente →
        </button>
      </div>
    </div>
  );
}

// ── Tab Auditoría ─────────────────────────────────────────────────────
// M-5 fix: añadidos filtros por entidad y rango de fechas.
// Antes: lista plana sin forma de acotar por tipo de objeto o período.
// Los filtros de email/acción/lapso ya existían — se conservan.

const ENTIDADES_OPCIONES = [
  { value: "",            label: "Todas las entidades" },
  { value: "horarios",    label: "Horarios" },
  { value: "docentes",    label: "Docentes" },
  { value: "materias",    label: "Materias" },
  { value: "trimestres",  label: "Trimestres" },
  { value: "usuarios",    label: "Usuarios" },
  { value: "roles",       label: "Roles" },
];

function TabAuditoria({ permisos }) {
  const [logs,          setLogs]          = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [filtroEmail,   setFiltroEmail]   = useState("");
  const [filtroAccion,  setFiltroAccion]  = useState("");
  const [filtroLapso,   setFiltroLapso]   = useState("");
  const [filtroEntidad, setFiltroEntidad] = useState("");
  const [fechaDesde,    setFechaDesde]    = useState("");
  const [fechaHasta,    setFechaHasta]    = useState("");
  const [expandido,     setExpandido]     = useState(null);
  const [page,          setPage]          = useState(0);
  const PAGE_SIZE = 50;

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_audit_logs", {
      p_limit:   PAGE_SIZE,
      p_offset:  page * PAGE_SIZE,
      p_email:   filtroEmail   || null,
      p_accion:  filtroAccion  || null,
      p_lapso:   filtroLapso   || null,
      p_programa: null,
    });
    if (!error) {
      // Filtros de entidad y fecha se aplican client-side:
      // get_audit_logs() no expone p_entidad ni p_fecha — filtrar aquí
      // evita una migración de RPC y es aceptable con PAGE_SIZE=50.
      let filtrados = data || [];
      if (filtroEntidad) {
        filtrados = filtrados.filter(l => l.entidad === filtroEntidad);
      }
      if (fechaDesde) {
        const desde = new Date(fechaDesde);
        filtrados = filtrados.filter(l => new Date(l.created_at) >= desde);
      }
      if (fechaHasta) {
        const hasta = new Date(fechaHasta);
        hasta.setHours(23, 59, 59, 999);
        filtrados = filtrados.filter(l => new Date(l.created_at) <= hasta);
      }
      setLogs(filtrados);
    }
    setLoading(false);
  }, [filtroEmail, filtroAccion, filtroLapso, filtroEntidad, fechaDesde, fechaHasta, page]);

  useEffect(() => { cargar(); }, [cargar]);

  const resetFiltros = () => {
    setFiltroEmail(""); setFiltroAccion(""); setFiltroLapso("");
    setFiltroEntidad(""); setFechaDesde(""); setFechaHasta("");
    setPage(0);
  };

  const accionesUnicas = [...new Set(logs.map(l => l.accion))].sort();
  const hayFiltros = filtroEmail || filtroAccion || filtroLapso || filtroEntidad || fechaDesde || fechaHasta;

  return (
    <div>
      {/* Filtros — fila 1: texto */}
      <div className="lv-filtros-row lv-filtros-row--tight">
        <input
          value={filtroEmail} onChange={e => { setFiltroEmail(e.target.value); setPage(0); }}
          placeholder="Filtrar por usuario…"
          className="s-input lv-input--email160"
        />
        <select value={filtroAccion} onChange={e => { setFiltroAccion(e.target.value); setPage(0); }}
          className="s-select lv-select--180">
          <option value="">Todas las acciones</option>
          {accionesUnicas.map(a => (
            <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select value={filtroEntidad} onChange={e => { setFiltroEntidad(e.target.value); setPage(0); }}
          className="s-select lv-select--160">
          {ENTIDADES_OPCIONES.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Filtros — fila 2: lapso + fechas + acciones */}
      <div className="lv-filtros-row lv-filtros-row--center">
        <input
          value={filtroLapso} onChange={e => { setFiltroLapso(e.target.value); setPage(0); }}
          placeholder="Trimestre (ej: 2-2025)"
          className="s-input lv-input--w140"
        />
        <div className="lv-fecha-field">
          <span className="lv-fecha-label">Desde</span>
          <input type="date" value={fechaDesde}
            onChange={e => { setFechaDesde(e.target.value); setPage(0); }}
            className="s-input lv-input--w140"
          />
        </div>
        <div className="lv-fecha-field">
          <span className="lv-fecha-label">Hasta</span>
          <input type="date" value={fechaHasta}
            onChange={e => { setFechaHasta(e.target.value); setPage(0); }}
            className="s-input lv-input--w140"
          />
        </div>
        {hayFiltros && (
          <button onClick={resetFiltros} className="s-btn lv-btn-shrink">
            Limpiar
          </button>
        )}
        <button onClick={cargar} className="s-btn lv-btn-icon">
          <i className="ti ti-refresh lv-icon-14" aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="lv-state-loading">Cargando…</div>
      ) : logs.length === 0 ? (
        <div className="lv-state-empty">
          <i className="ti ti-folders lv-state-empty-icon" aria-hidden="true" />
          No hay registros de auditoría.
        </div>
      ) : (
        <div className="lv-audit-list">
          {logs.map(log => {
            const isOpen = expandido === log.id;
            const cfg = ACCION_CONFIG[log.accion] || { icon: "ti-info-circle", color: "#475569" };

            return (
              <div key={log.id} className={`s-card lv-audit-card ${accionClass(log.accion)}`}>
                {/* Cabecera */}
                <div
                  onClick={() => setExpandido(isOpen ? null : log.id)}
                  className="lv-audit-header">

                  <i className={`ti ${cfg.icon} lv-audit-header-icon`} aria-hidden="true" />

                  <div className="lv-audit-main">
                    <div className="lv-audit-badges-row">
                      <AccionBadge accion={log.accion} />
                      {log.lapso && (
                        <span className="lv-audit-badge lv-audit-badge--lapso">
                          {log.lapso}
                        </span>
                      )}
                      {log.programa_afectado && (
                        <span className="lv-audit-badge lv-audit-badge--programa">
                          {log.programa_afectado}
                        </span>
                      )}
                    </div>
                    {log.resumen && (
                      <div className="lv-audit-resumen">
                        {log.resumen}
                      </div>
                    )}
                  </div>

                  <div className="lv-audit-meta">
                    <div className="lv-audit-meta-name">
                      {log.nombre || log.email}
                    </div>
                    <div className="lv-audit-meta-date">
                      {fmtDateTime(log.created_at)}
                    </div>
                  </div>

                  <i className={`ti ${isOpen ? "ti-chevron-up" : "ti-chevron-down"} lv-audit-chevron`}
                     aria-hidden="true" />
                </div>

                {/* Detalle expandible */}
                {isOpen && (
                  <div className="lv-audit-detail">
                    <div className="lv-audit-detail-grid">
                      {[
                        { label: "Usuario",   val: `${log.nombre || "—"} (${log.email})` },
                        { label: "Rol",       val: log.rol || "—" },
                        { label: "Entidad",   val: log.entidad || "—" },
                        { label: "Fecha",     val: fmtDateTime(log.created_at) },
                      ].map(({ label, val }) => (
                        <div key={label}>
                          <div className="lv-audit-detail-label">
                            {label}
                          </div>
                          <div className="lv-audit-detail-value">{val}</div>
                        </div>
                      ))}
                    </div>

                    {(log.datos_antes || log.datos_despues) && (
                      <div className="lv-audit-datos-grid">
                        {log.datos_antes && (
                          <div>
                            <div className="lv-audit-datos-label lv-audit-datos-label--antes">Estado anterior</div>
                            <pre className="lv-audit-pre lv-audit-pre--antes">
                              {JSON.stringify(log.datos_antes, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.datos_despues && (
                          <div>
                            <div className="lv-audit-datos-label lv-audit-datos-label--despues">Estado nuevo</div>
                            <pre className="lv-audit-pre lv-audit-pre--despues">
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
      <div className="lv-pagination">
        <button onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0} className="s-btn">
          ← Anterior
        </button>
        <span className="lv-pagination-label">
          Página {page + 1}
        </span>
        <button onClick={() => setPage(p => p + 1)}
          disabled={logs.length < PAGE_SIZE} className="s-btn">
          Siguiente →
        </button>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────
export default function LogsView({ permisos }) {
  // D-1 fix: las pestañas se construyen según permisos individuales.
  // puedeVerLogs → "Registros de sesión"
  // puedeVerAuditoria → "Auditoría de cambios"
  // Antes: ambas pestañas visibles a cualquier usuario con puedeVerLogs.
  const TABS = [
    ...(permisos.puedeVerLogs
      ? [{ id: "sesiones",  icon: "ti-key",         label: "Registros de sesión" }]
      : []),
    ...(permisos.puedeVerAuditoria
      ? [{ id: "auditoria", icon: "ti-list-details", label: "Auditoría de cambios" }]
      : []),
  ];

  const initialTab = permisos.puedeVerLogs ? "sesiones" : "auditoria";
  const [tab, setTab] = useState(initialTab);

  if (TABS.length === 0) {
    return (
      <div className="lv-no-access">
        <i className="ti ti-lock lv-no-access-icon" aria-hidden="true" />
        <div className="lv-no-access-text">No tienes permiso para ver los registros del sistema.</div>
      </div>
    );
  }

  return (
    <div className="lv-root">
      {/* Encabezado */}
      <div className="lv-header">
        <h1 className="lv-title">
          Registros del Sistema
        </h1>
        <p className="lv-subtitle">
          Historial de sesiones y auditoría de cambios
        </p>
      </div>

      {/* Tabs — solo las permitidas por permisos */}
      {TABS.length > 1 && (
        <div className="lv-tabs">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`lv-tab-btn${tab === t.id ? ' lv-tab-btn--active' : ''}`}>
              <i className={`ti ${t.icon} lv-tab-icon`} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "sesiones"  && permisos.puedeVerLogs      && <TabSesiones  permisos={permisos} />}
      {tab === "auditoria" && permisos.puedeVerAuditoria  && <TabAuditoria permisos={permisos} />}
    </div>
  );
}
