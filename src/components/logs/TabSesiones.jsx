import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { fmtDateTime, EVENTO_CONFIG, eventoClass, EventoBadge } from "./logsUtils";

// Fix ARCH-10 (auditoría 9 de julio): extraído de LogsView.jsx sin cambios
// de lógica — ya era un componente autocontenido dentro del archivo, solo
// se movió a su propio módulo.
export default function TabSesiones({ permisos }) {
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
