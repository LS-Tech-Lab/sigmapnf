import React from "react";
import { formatLapso } from "../../utils/lapso";
import { fmt, duracion, StatusBadge } from "./historialUtils";

// Fix ARCH-10 (auditoría 9 de julio): extraído de HistorialView.jsx sin
// cambios de lógica — es puramente presentacional. El estado (búsqueda,
// expandido, detalles) y los handlers (cargarDetalle) siguen viviendo en
// HistorialView.jsx, que los pasa por props.
export default function HistorialLista({
  busqueda, setBusqueda,
  loading,
  filtrados,
  expandido, setExpandido,
  detalles,
  loadingDet,
  lapsoActivo,
  cargarDetalle,
  onCambiarLapso,
}) {
  return (
    <>
      <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
        placeholder="Buscar trimestre… (ej: 2026, 1-2025)"
        className="hist-search" />

      {loading ? (
        <div className="hist-loading">Cargando historial…</div>
      ) : filtrados.length === 0 ? (
        <div className="hist-empty">
          <i className="ti ti-folder-open hist-empty__icon" aria-hidden="true" />
          <div className="hist-empty__text">
            {busqueda ? "No se encontraron trimestres." : "No hay trimestres en el historial aún."}
          </div>
        </div>
      ) : (
        <div className="hist-list">
          {filtrados.map(t => {
            const isOpen = expandido === t.lapso;
            const d = detalles[t.lapso];
            const esCurrent = t.lapso === lapsoActivo;
            return (
              <div key={t.lapso} className={`hist-card ${esCurrent ? "hist-card--current" : ""}`}>

                {/* Cabecera */}
                <div onClick={() => isOpen ? setExpandido(null) : cargarDetalle(t.lapso)}
                  className="hist-card__header">
                  <div className="hist-card__body">
                    <div className="hist-card__title">{formatLapso(t.lapso)}</div>
                    <div className="hist-card__meta">
                      {t.fecha_inicio && (
                        <span className="hist-card__meta-item">
                          <i className="ti ti-calendar" aria-hidden="true" />
                          {fmt(t.fecha_inicio)}
                        </span>
                      )}
                      {t.fecha_fin && (
                        <span className="hist-card__meta-item">→ {fmt(t.fecha_fin)}</span>
                      )}
                      {t.fecha_inicio && t.fecha_fin && (
                        <span className="hist-card__meta-item hist-card__meta-item--muted">({duracion(t.fecha_inicio, t.fecha_fin)})</span>
                      )}
                      {t.cerrado_por && (
                        <span className="hist-card__meta-item hist-card__meta-item--muted">Cerrado por {t.cerrado_por}</span>
                      )}
                    </div>
                  </div>
                  <StatusBadge estado={t.estado} />
                  <i className={`ti ${isOpen ? "ti-chevron-up" : "ti-chevron-down"} hist-card__chevron`}
                     aria-hidden="true" />
                </div>

                {/* Detalle expandible */}
                {isOpen && (
                  <div className="hist-card__detail">

                    {t.notas && (
                      <div className="hist-card__note">
                        <i className="ti ti-notes hist-card__note-icon" aria-hidden="true" />
                        {t.notas}
                      </div>
                    )}

                    {loadingDet && !d ? (
                      <div className="hist-detail-loading">Cargando estadísticas…</div>
                    ) : d ? (
                      <>
                        <div className="hist-stats">
                          {[
                            { label: "Clases",    val: d.total,     claseValor: "hist-stat__value--total"     },
                            { label: "Secciones", val: d.secciones, claseValor: "hist-stat__value--secciones" },
                          ].map(s => (
                            <div key={s.label} className="hist-stat">
                              <div className={`hist-stat__value ${s.claseValor}`}>{s.val}</div>
                              <div className="hist-stat__label">{s.label}</div>
                            </div>
                          ))}
                        </div>

                        {d.programas?.length > 0 && (
                          <div className="hist-tags">
                            <div className="hist-tags__label">Programas</div>
                            <div className="hist-tags__list">
                              {d.programas.map(p => (
                                <span key={p} className="hist-badge hist-badge--success">{p}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {d.trayectos?.length > 0 && (
                          <div className="hist-tags hist-tags--last">
                            <div className="hist-tags__label">Trayectos</div>
                            <div className="hist-tags__list">
                              {d.trayectos.map(t2 => (
                                <span key={t2} className="hist-badge hist-badge--info">{t2}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {!esCurrent && (
                          <button onClick={() => onCambiarLapso(t.lapso)}
                            className="hist-goto">
                            <i className="ti ti-eye" aria-hidden="true" />
                            Consultar horarios de este trimestre
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="hist-detail-empty">Sin datos cargados para este trimestre.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
