import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { fmtDateTime, ACCION_CONFIG, accionClass, AccionBadge } from "./logsUtils";

// Fix ARCH-10 (auditoría 9 de julio): extraído de LogsView.jsx sin cambios
// de lógica — ya era un componente autocontenido dentro del archivo, solo
// se movió a su propio módulo.

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

export default function TabAuditoria() {
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
