import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  formatLapso, compareLapsos, getSiguienteLapso,
  getCurrentLapso, isValidLapso
} from "../utils/lapso";
import "./HistorialView.css";

// ── Utilidades ────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" });
}

function duracion(inicio, fin) {
  if (!inicio || !fin) return null;
  const dias = Math.round((new Date(fin) - new Date(inicio)) / 86400000);
  if (dias < 7) return `${dias} días`;
  const sem = Math.round(dias / 7);
  return `${sem} semana${sem !== 1 ? "s" : ""}`;
}

const ESTADO_BADGE = {
  activo:    { clase: "hist-badge--activo",    label: "Activo"    },
  cerrado:   { clase: "hist-badge--cerrado",   label: "Cerrado"   },
  archivado: { clase: "hist-badge--archivado", label: "Archivado" },
};

function StatusBadge({ estado }) {
  const c = ESTADO_BADGE[estado] || ESTADO_BADGE.cerrado;
  return <span className={`hist-badge ${c.clase}`}>{c.label}</span>;
}

// ── Modal de cierre / creación de trimestre ───────────────────────────────────

function ModalTrimestre({ modo, lapsoSugerido, onConfirm, onCancel, loading }) {
  const esCrear = modo === "crear";
  const [lapso,       setLapso]       = useState(lapsoSugerido || "");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin,    setFechaFin]    = useState("");
  const [observacion, setObservacion] = useState("");

  useEffect(() => {
    if (!esCrear) setFechaFin(new Date().toISOString().slice(0, 10));
  }, [esCrear]);

  const valido = esCrear
    ? isValidLapso(lapso) && fechaInicio?.trim()
    : fechaFin?.trim();

  const confirmClase = !valido
    ? "hist-modal__confirm--disabled"
    : esCrear ? "hist-modal__confirm--crear" : "hist-modal__confirm--cerrar";

  return (
    <div className="hist-modal-overlay">
      <div className="hist-modal">

        <div className="hist-modal__icon-wrap">
          <i className={`ti ${esCrear ? "ti-school" : "ti-lock"} hist-modal__icon ${esCrear ? "hist-modal__icon--crear" : "hist-modal__icon--cerrar"}`}
             aria-hidden="true" />
        </div>
        <h2 className="hist-modal__title">
          {esCrear ? "Activar nuevo trimestre" : `Cerrar trimestre ${formatLapso(lapsoSugerido)}`}
        </h2>
        <p className="hist-modal__desc">
          {esCrear
            ? "Completa los datos del nuevo período académico."
            : "El trimestre pasará al historial como solo lectura. Completa la información antes de cerrar."}
        </p>

        <div className="hist-modal__fields">

          {esCrear && (
            <div>
              <label className="hist-label">Código del trimestre *</label>
              <input value={lapso} onChange={e => setLapso(e.target.value)}
                placeholder="ej: 3-2026"
                className="hist-field__input" />
              <span className="hist-field__hint">Formato: [número]-[año] → 1-2027, 2-2027, 3-2027…</span>
            </div>
          )}

          <div>
            <label className="hist-label">{esCrear ? "Fecha de inicio *" : "Fecha de inicio"}</label>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
              className="hist-field__input" />
          </div>

          <div>
            <label className="hist-label">{esCrear ? "Fecha estimada de culminación" : "Fecha de culminación *"}</label>
            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
              className="hist-field__input" />
            {fechaInicio && fechaFin && (
              <span className="hist-field__hint hist-field__hint--accent">
                Duración: {duracion(fechaInicio, fechaFin)}
              </span>
            )}
          </div>

          <div>
            <label className="hist-label">Observaciones {esCrear ? "" : "(opcional)"}</label>
            <textarea value={observacion} onChange={e => setObservacion(e.target.value)}
              placeholder={esCrear
                ? "Notas sobre este período, sede, modalidad, etc."
                : "Ej: Trimestre extendido por paro nacional, actividades suspendidas en semana 8…"}
              rows={3}
              className="hist-field__input hist-field__input--textarea" />
          </div>
        </div>

        <div className="hist-modal__actions">
          <button onClick={onCancel} className="hist-modal__cancel">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm({ lapso: esCrear ? lapso : lapsoSugerido, fechaInicio, fechaFin, observacion })}
            disabled={!valido || loading}
            className={`hist-modal__confirm ${confirmClase}`}>
            {loading ? "Procesando…" : (
              <>
                <i className={`ti ${esCrear ? "ti-circle-check" : "ti-lock"} hist-modal__confirm-icon`}
                   aria-hidden="true" />
                {esCrear ? `Activar ${lapso || "…"}` : "Confirmar cierre"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Panel de comparación entre trimestres ─────────────────────────────────────

const METRICAS_DOT_CLASE = {
  total: "hist-comp-dot--total",
  secciones: "hist-comp-dot--secciones",
  docentes: "hist-comp-dot--docentes",
  materias: "hist-comp-dot--materias",
};

function ComparadorPanel({ trimestres, detalles }) {
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");

  const cerrados = trimestres.filter(t => t.estado !== "activo");

  useEffect(() => {
    if (cerrados.length >= 2 && !selA) setSelA(cerrados[0].lapso);
    if (cerrados.length >= 2 && !selB) setSelB(cerrados[1]?.lapso || "");
  }, [cerrados.length]);

  const dA = detalles[selA];
  const dB = detalles[selB];

  const metrics = [
    { key: "total",     label: "Clases"    },
    { key: "secciones", label: "Secciones" },
    { key: "docentes",  label: "Docentes"  },
    { key: "materias",  label: "Materias"  },
  ];

  if (cerrados.length < 2) return (
    <div className="hist-comp-empty">
      Necesitas al menos 2 trimestres cerrados para comparar.
    </div>
  );

  return (
    <div>
      {/* Selectores */}
      <div className="hist-comp-selectors">
        {[{ val: selA, set: setSelA, label: "Trimestre A", ladoClase: "a" },
          { val: selB, set: setSelB, label: "Trimestre B", ladoClase: "b" }].map(({ val, set, label, ladoClase }) => (
          <div key={label}>
            <label className={`hist-label hist-label--${ladoClase}`}>{label}</label>
            <select value={val} onChange={e => set(e.target.value)}
              className={`hist-comp-select hist-comp-select--${ladoClase}`}>
              <option value="">— seleccionar —</option>
              {cerrados.map(t => (
                <option key={t.lapso} value={t.lapso}>{formatLapso(t.lapso)}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {selA && selB && selA !== selB ? (
        <>
          <div className="hist-comp-table">
            <div className="hist-comp-th hist-comp-th--metric">Métrica</div>
            <div className="hist-comp-th hist-comp-th--a">{formatLapso(selA)}</div>
            <div className="hist-comp-th hist-comp-th--b">{formatLapso(selB)}</div>

            {metrics.map(m => {
              const va = dA?.[m.key] ?? "…";
              const vb = dB?.[m.key] ?? "…";
              const diff = (typeof va === "number" && typeof vb === "number") ? vb - va : null;
              return (
                <React.Fragment key={m.key}>
                  <div className="hist-comp-td hist-comp-td--metric">
                    <span className={`hist-comp-dot ${METRICAS_DOT_CLASE[m.key]}`}>●</span> {m.label}
                  </div>
                  <div className="hist-comp-td hist-comp-td--a">{va}</div>
                  <div className="hist-comp-td hist-comp-td--b hist-comp-td--flex">
                    {vb}
                    {diff !== null && diff !== 0 && (
                      <span className={`hist-comp-diff ${diff > 0 ? "hist-comp-diff--up" : "hist-comp-diff--down"}`}>
                        {diff > 0 ? `▲ +${diff}` : `▼ ${diff}`}
                      </span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}

            {/* Duración */}
            <div className="hist-comp-td hist-comp-td--metric">
              <i className="ti ti-clock hist-comp-clock-icon" aria-hidden="true" />
              Duración
            </div>
            <div className="hist-comp-td hist-comp-td--a">{dA ? duracion(dA.fechaInicio, dA.fechaFin) || "—" : "…"}</div>
            <div className="hist-comp-td hist-comp-td--b">{dB ? duracion(dB.fechaInicio, dB.fechaFin) || "—" : "…"}</div>
          </div>

          {dA?.programas && dB?.programas && (() => {
            const setA = new Set(dA.programas);
            const setB = new Set(dB.programas);
            const comunes  = dA.programas.filter(p => setB.has(p));
            const soloEnA  = dA.programas.filter(p => !setB.has(p));
            const soloEnB  = dB.programas.filter(p => !setA.has(p));
            return (
              <div className="hist-comp-programs">
                {[
                  { label: "En ambos", items: comunes, ladoClase: "comun" },
                  { label: `Solo en ${formatLapso(selA)}`, items: soloEnA, ladoClase: "a" },
                  { label: `Solo en ${formatLapso(selB)}`, items: soloEnB, ladoClase: "b" },
                ].map(({ label, items, ladoClase }) => (
                  <div key={label} className={`hist-comp-prog-group hist-comp-prog-group--${ladoClase}`}>
                    <div className={`hist-comp-prog-title hist-comp-prog-title--${ladoClase}`}>{label}</div>
                    {items.length === 0
                      ? <div className="hist-comp-prog-empty">Ninguno</div>
                      : items.map(p => <div key={p} className={`hist-comp-prog-item hist-comp-prog-item--${ladoClase}`}>• {p}</div>)
                    }
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      ) : (
        <div className="hist-comp-empty">
          Selecciona dos trimestres diferentes para ver la comparación.
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function HistorialView({ lapsoActivo, onCambiarLapso, showToast, openConfirm, closeConfirm, user, modoConsulta = false, logAudit = null, programaRestringido = null }) {
  const [trimestres,     setTrimestres]     = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [expandido,      setExpandido]      = useState(null);
  const [detalles,       setDetalles]       = useState({});
  const [loadingDet,     setLoadingDet]     = useState(false);
  const [procesando,     setProcesando]     = useState(false);
  const [busqueda,       setBusqueda]       = useState("");
  const [tab,            setTab]            = useState("lista");
  const [modal,          setModal]          = useState(null);
  const [lapsoSiguiente, setLapsoSiguiente] = useState("");

  const cargarTrimestres = useCallback(async () => {
    setLoading(true);
    // D-2 fix: si el usuario tiene restringe_programa, solo mostramos
    // trimestres que contengan horarios de su programa. Para usuarios sin
    // restricción la query es idéntica a la original.
    let data, error;
    if (programaRestringido) {
      // Obtenemos los lapsos donde existe al menos un horario de su programa
      const { data: lapsos, error: errLapsos } = await supabase
        .from("horarios")
        .select("lapso")
        .eq("programa", programaRestringido);
      if (errLapsos) { showToast("Error al cargar historial: " + errLapsos.message, "error"); setLoading(false); return; }
      const lapsoSet = [...new Set((lapsos || []).map(h => h.lapso))];
      if (lapsoSet.length === 0) { setTrimestres([]); setLoading(false); return; }
      ({ data, error } = await supabase
        .from("trimestres")
        .select("*")
        .in("lapso", lapsoSet)
        .order("anio", { ascending: false })
        .order("numero", { ascending: false }));
    } else {
      ({ data, error } = await supabase
        .from("trimestres")
        .select("*")
        .order("anio", { ascending: false })
        .order("numero", { ascending: false }));
    }
    if (error) showToast("Error al cargar historial: " + error.message, "error");
    else setTrimestres(data || []);
    setLoading(false);
  }, [showToast, programaRestringido]);

  useEffect(() => { cargarTrimestres(); }, [cargarTrimestres]);

  const cargarDetalle = async (lapso) => {
    if (detalles[lapso]) { setExpandido(lapso); return; }
    setLoadingDet(true);
    // D-2 fix: si hay restricción de programa, el detalle también se filtra
    let query = supabase.from("horarios").select("programa, trayecto, sheet").eq("lapso", lapso);
    if (programaRestringido) query = query.eq("programa", programaRestringido);
    const { data: horarios } = await query;

    const meta = trimestres.find(t => t.lapso === lapso);

    if (horarios) {
      setDetalles(prev => ({
        ...prev,
        [lapso]: {
          total:      horarios.length,
          secciones:  new Set(horarios.map(h => h.sheet?.trim())).size,
          docentes:   new Set(horarios.map(h => h.trayecto)).size,
          materias:   0,
          programas:  [...new Set(horarios.map(h => h.programa).filter(Boolean))].sort(),
          trayectos:  [...new Set(horarios.map(h => h.trayecto).filter(Boolean))].sort(),
          fechaInicio: meta?.fecha_inicio,
          fechaFin:    meta?.fecha_fin,
        }
      }));
    }
    setExpandido(lapso);
    setLoadingDet(false);
  };

  const handleCerrar = async ({ lapso, fechaInicio, fechaFin, observacion }) => {
    setProcesando(true);
    const [num, anio] = lapso.split("-").map(Number);
    const { error } = await supabase.from("trimestres").upsert(
      {
        lapso, numero: num, anio,
        estado:       "cerrado",
        fecha_inicio: fechaInicio || null,
        fecha_fin:    fechaFin || null,
        notas:        observacion || null,
        cerrado_en:   new Date().toISOString(),
        cerrado_por:  user?.email,
      },
      { onConflict: "lapso" }
    );
    if (error) { showToast("Error al cerrar: " + error.message, "error"); setProcesando(false); return; }
    showToast(`Trimestre ${formatLapso(lapso)} cerrado y archivado.`, "success");
    logAudit?.({ accion: "CERRAR_TRIMESTRE", entidad: "trimestres", lapso, resumen: `Trimestre cerrado: ${formatLapso(lapso)}` });
    setModal(null);
    await cargarTrimestres();
    setLapsoSiguiente(getSiguienteLapso(lapso));
    setTimeout(() => setModal("crear"), 300);
    setProcesando(false);
  };

  const handleCrear = async ({ lapso, fechaInicio, fechaFin, observacion }) => {
    if (!isValidLapso(lapso)) { showToast("Formato inválido (ej: 3-2026)", "error"); return; }
    const yaActivo = trimestres.find(t => t.lapso === lapso && t.estado === "activo");
    if (yaActivo) { showToast("Ese trimestre ya está activo.", "warning"); return; }
    setProcesando(true);
    const [num, anio] = lapso.split("-").map(Number);
    const { error } = await supabase.from("trimestres").upsert(
      {
        lapso, numero: num, anio,
        estado:       "activo",
        fecha_inicio:  fechaInicio || null,
        fecha_fin:     fechaFin    || null,
        notas:         observacion || null,
        creado_en:    new Date().toISOString(),
        creado_por:   user?.email,
      },
      { onConflict: "lapso" }
    );
    if (error) { showToast("Error al crear: " + error.message, "error"); setProcesando(false); return; }
    showToast(`Trimestre ${formatLapso(lapso)} activado.`, "success");
    logAudit?.({ accion: "CREAR_TRIMESTRE", entidad: "trimestres", lapso, resumen: `Nuevo trimestre activado: ${formatLapso(lapso)}` });
    setModal(null);
    onCambiarLapso(lapso);
    await cargarTrimestres();
    setProcesando(false);
  };

  const filtrados = trimestres.filter(t =>
    !busqueda ||
    t.lapso.includes(busqueda) ||
    formatLapso(t.lapso).toLowerCase().includes(busqueda.toLowerCase())
  );

  const trimestreActual = trimestres.find(t => t.lapso === lapsoActivo);

  return (
    <>
      {modal === "cerrar" && (
        <ModalTrimestre
          modo="cerrar"
          lapsoSugerido={lapsoActivo}
          onConfirm={handleCerrar}
          onCancel={() => setModal(null)}
          loading={procesando}
        />
      )}
      {modal === "crear" && (
        <ModalTrimestre
          modo="crear"
          lapsoSugerido={lapsoSiguiente}
          onConfirm={handleCrear}
          onCancel={() => setModal(null)}
          loading={procesando}
        />
      )}

      <div className="hist-page">

        {/* Encabezado */}
        <div className="hist-header">
          <div>
            <h1 className="hist-header__title">Historial de Trimestres</h1>
            <p className="hist-header__subtitle">Gestión y consulta de todos los períodos académicos</p>
          </div>
          <div className="hist-header__actions">
            {!modoConsulta && (
              <>
                <button onClick={() => { setLapsoSiguiente(getSiguienteLapso(lapsoActivo)); setModal("crear"); }}
                  className="hist-btn hist-btn--primary">
                  <i className="ti ti-plus hist-btn__icon" aria-hidden="true" />
                  Nuevo trimestre
                </button>
                <button onClick={() => setModal("cerrar")}
                  className="hist-btn hist-btn--danger">
                  <i className="ti ti-lock hist-btn__icon" aria-hidden="true" />
                  Cerrar trimestre activo
                </button>
              </>
            )}
          </div>
        </div>

        {/* Trimestre activo */}
        <div className="hist-current">
          <div className="hist-current__row">
            <div>
              <div className="hist-current__eyebrow">Trimestre en curso</div>
              <div className="hist-current__lapso">{formatLapso(lapsoActivo)}</div>
              <div className="hist-current__meta">
                {trimestreActual?.fecha_inicio && (
                  <span className="hist-current__meta-item">
                    <i className="ti ti-calendar" aria-hidden="true" />
                    Inicio: <strong>{fmt(trimestreActual.fecha_inicio)}</strong>
                  </span>
                )}
                {trimestreActual?.fecha_fin && (
                  <span className="hist-current__meta-item">
                    <i className="ti ti-flag-finish" aria-hidden="true" />
                    Fin estimado: <strong>{fmt(trimestreActual.fecha_fin)}</strong>
                  </span>
                )}
                {trimestreActual?.fecha_inicio && trimestreActual?.fecha_fin && (
                  <span className="hist-current__meta-item hist-current__meta-item--accent">
                    <i className="ti ti-clock" aria-hidden="true" />
                    {duracion(trimestreActual.fecha_inicio, trimestreActual.fecha_fin)}
                  </span>
                )}
              </div>
              {trimestreActual?.notas && (
                <div className="hist-current__notes">
                  <i className="ti ti-notes hist-current__notes-icon" aria-hidden="true" />
                  {trimestreActual.notas}
                </div>
              )}
            </div>
            <StatusBadge estado="activo" />
          </div>
        </div>

        {/* Tabs */}
        <div className="hist-tabs">
          {[
            { id: "lista",    icon: "ti-list",        label: "Historial" },
            { id: "comparar", icon: "ti-chart-bar",   label: "Comparar trimestres" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`hist-tab ${tab === t.id ? "hist-tab--active" : ""}`}>
              <i className={`ti ${t.icon}`} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB: LISTA ── */}
        {tab === "lista" && (
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
        )}

        {/* ── TAB: COMPARAR ── */}
        {tab === "comparar" && (
          <div className="hist-card hist-comp-card">
            <ComparadorPanel trimestres={trimestres} detalles={detalles} />
            {Object.keys(detalles).length === 0 && trimestres.filter(t => t.estado !== "activo").length >= 2 && (
              <p className="hist-comp-footer-hint">
                <i className="ti ti-info-circle" aria-hidden="true" />
                Expande los trimestres en la pestaña Historial para cargar sus estadísticas y poder comparar.
              </p>
            )}
          </div>
        )}

      </div>
    </>
  );
}
