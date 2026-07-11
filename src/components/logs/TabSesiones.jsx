import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { fmtDateTime, EVENTO_CONFIG, eventoClass, EventoBadge } from "./logsUtils";
import { ModalConfirm } from "../usuarios/shared";

// Fix ARCH-10 (auditoría 9 de julio): extraído de LogsView.jsx sin cambios
// de lógica — ya era un componente autocontenido dentro del archivo, solo
// se movió a su propio módulo.
export default function TabSesiones({ permisos, showToast }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [filtroEmail, setFiltroEmail] = useState("");
  const [page,      setPage]      = useState(0);
  const PAGE_SIZE = 50;

  // ADMIN-2: borrado de registros de sesión (solo admin, permiso
  // puedeBorrarSesiones). Selección múltiple + confirmación, RPC
  // admin_borrar_session_logs (0053) revalida el permiso en el servidor.
  const [seleccionados, setSeleccionados] = useState(() => new Set());
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [borrando,      setBorrando]      = useState(false);

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
  // La selección no debe sobrevivir a un cambio de página o filtro.
  useEffect(() => { setSeleccionados(new Set()); }, [filtroEmail, page]);

  const toggleUno = (id) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleTodos = () => {
    setSeleccionados(prev =>
      prev.size === logs.length ? new Set() : new Set(logs.map(l => l.id))
    );
  };

  const handleBorrar = async () => {
    setBorrando(true);
    const { error } = await supabase.rpc("admin_borrar_session_logs", {
      p_ids: Array.from(seleccionados),
    });
    setBorrando(false);
    setConfirmBorrar(false);
    if (error) {
      showToast?.(error.message || "No se pudieron borrar los registros.", "error");
    } else {
      setLogs(prev => prev.filter(l => !seleccionados.has(l.id)));
      setSeleccionados(new Set());
      showToast?.("Registros de sesión borrados.", "success");
    }
  };

  const stats = logs.reduce((acc, l) => {
    acc[l.evento] = (acc[l.evento] || 0) + 1;
    return acc;
  }, {});

  const puedeBorrar = !!permisos?.puedeBorrarSesiones;

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
        {puedeBorrar && seleccionados.size > 0 && (
          <button onClick={() => setConfirmBorrar(true)} className="s-btn lv-btn-icon lv-btn-borrar">
            <i className="ti ti-trash lv-icon-14" aria-hidden="true" />
            Borrar seleccionados ({seleccionados.size})
          </button>
        )}
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
                {puedeBorrar && (
                  <th className="s-th lv-th-checkbox">
                    <input
                      type="checkbox"
                      checked={logs.length > 0 && seleccionados.size === logs.length}
                      onChange={toggleTodos}
                      aria-label="Seleccionar todos"
                    />
                  </th>
                )}
                {["Fecha y hora", "Usuario", "Rol", "Evento"].map(h => (
                  <th key={h} className="s-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  {puedeBorrar && (
                    <td className="s-td lv-th-checkbox">
                      <input
                        type="checkbox"
                        checked={seleccionados.has(log.id)}
                        onChange={() => toggleUno(log.id)}
                        aria-label="Seleccionar este registro"
                      />
                    </td>
                  )}
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

      {confirmBorrar && (
        <ModalConfirm
          titulo="¿Borrar registros de sesión?"
          mensaje={`Se borrarán ${seleccionados.size} registro${seleccionados.size !== 1 ? "s" : ""} de sesión. Esta acción no se puede deshacer.`}
          onConfirm={borrando ? undefined : handleBorrar}
          onCancel={borrando ? undefined : () => setConfirmBorrar(false)}
          peligro
        />
      )}
    </div>
  );
}
