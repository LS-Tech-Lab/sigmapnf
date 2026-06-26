import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { S, DAYS, TRAYECTO_COLORS, TRAYECTO_BG } from '../constants';
import { getHoraDisplayDeRegistro, getHoraMin } from '../utils/time';
import { parseClase } from '../utils/parsing';
import Avatar from './Avatar';
import StatCard from './StatCard';

export default function DocentesView({ byDocente, conflicts, initialSel, onConsumeNav, getDocName, onSaveDocenteName, getDocCedula, onSaveDocenteCedula, modoConsulta, lapso }) {
  const sorted = Object.keys(byDocente).sort();
  const [sel, setSel] = useState(initialSel || null), [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false), [editValue, setEditValue] = useState(""), [saving, setSaving] = useState(false);
  const [editingCedula, setEditingCedula] = useState(false), [cedulaValue, setCedulaValue] = useState(""), [savingCedula, setSavingCedula] = useState(false);

  // M-4: contar docentes sin cédula para el indicador de completitud
  const sinCedula = useMemo(
    () => sorted.filter(d => !(getDocCedula && getDocCedula(d))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted.join(","), getDocCedula]
  );

  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel, onConsumeNav]);
  // Solo actualizar editValue cuando cambia la selección, NO cuando cambia getDocName.
  // Si getDocName estuviera en las deps, al guardar se dispararía fetchDocenteNames →
  // nuevo getDocName → efecto se re-ejecuta → sobreescribe editValue mientras el modal
  // sigue abierto, causando que haya que guardar dos veces.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) { setEditValue(getDocName(sel)); setCedulaValue(getDocCedula ? getDocCedula(sel) : ""); } }, [sel]);

  const hasConflict = (name) => conflicts.some(c => c.docente === name);
  const selEntries = byDocente[sel] || [], selConflicts = sel ? conflicts.filter(c => c.docente === sel) : [];
  const filteredSorted = search ? sorted.filter(d => getDocName(d).toLowerCase().includes(search.toLowerCase())) : sorted;

  // Fix rendimiento: el array ordenado de asignaciones se calcula una sola vez
  // aquí, en vez de hacer [...selEntries].sort(...) en cada fila del .map().
  const sortedEntries = useMemo(
    () => [...selEntries].sort((a, b) => DAYS.indexOf(a.dia) - DAYS.indexOf(b.dia) || getHoraMin(a) - getHoraMin(b)),
    [selEntries]
  );

  const docenteStats = useMemo(() => {
    if (!selEntries.length) return null;
    const dias = new Set(selEntries.map(e => e.dia)), trayectos = new Set(selEntries.map(e => e.trayecto));
    const secciones = new Set(selEntries.map(e => e.sheet?.trim()).filter(Boolean)), materias = new Set(selEntries.map(e => parseClase(e.clase).materia));
    const horasPorDia = {}; DAYS.forEach(d => { horasPorDia[d] = selEntries.filter(e => e.dia === d).length; });
    return { totalClases: selEntries.length, totalDias: dias.size, totalTrayectos: trayectos.size, totalSecciones: secciones.size, totalMaterias: materias.size, horasPorDia };
  }, [selEntries]);

  const saveEdit = async () => {
    const t = editValue.trim();
    if (t && sel && onSaveDocenteName) {
      setSaving(true);
      const res = await onSaveDocenteName(sel, t);
      setSaving(false);
      if (res.success) {
        setEditingName(false);
        if (res.targetRaw) setSel(res.targetRaw);
      }
    } else setEditingName(false);
  };

  const saveCedulaEdit = async () => {
    if (sel && onSaveDocenteCedula) {
      setSavingCedula(true);
      const res = await onSaveDocenteCedula(sel, cedulaValue);
      setSavingCedula(false);
      if (res.success) setEditingCedula(false);
    } else setEditingCedula(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, height: 0, overflow: "hidden" }}>
      {modoConsulta && (
        <div style={{ background: "var(--color-warning-bg)", borderBottom: "1px solid var(--color-warning-border)", padding: "7px 20px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <i className="ti ti-archive" aria-hidden="true" style={{ color: "var(--color-warning-text)", fontSize: 14 }} />
          <span style={{ fontSize: 13, color: "var(--color-warning-text)", fontWeight: 600 }}>
            Modo consulta — trimestre {lapso} (solo lectura)
          </span>
        </div>
      )}
    <div className="docentes-layout" style={{ padding: 20, display: "flex", gap: 16, flex: 1, height: 0, overflow: "hidden" }}>
      <div className="docentes-left-panel" style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* M-4: banner de cédulas pendientes */}
        {sinCedula.length > 0 && (
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#92400E", fontWeight: 600 }}>
            <i className="ti ti-id-badge-2" aria-hidden="true" style={{ fontSize: 14, color: "#D97706" }} />
            {sinCedula.length} sin cédula
          </div>
        )}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar docente…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>{filteredSorted.length} docentes</div>
          {filteredSorted.map(d => (
            <div key={d} onClick={() => { setSel(d); setEditingName(false); }}
              style={{
                padding: "10px 14px", cursor: "pointer", fontSize: 14,
                fontWeight: sel === d ? 600 : 400,
                background: sel === d ? "var(--color-background-info)" : "transparent",
                color: sel === d ? "var(--brand-600)" : "var(--navy-700)",
                borderBottom: "1px solid var(--color-background-tertiary)", display: "flex", justifyContent: "space-between", alignItems: "center"
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{hasConflict(d) && <i className="ti ti-alert-triangle" title="Conflictos" style={{ fontSize: 13, color: "var(--color-danger)" }} aria-hidden="true" />}{getDocName(d)}</span>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {/* M-4: badge de cédula pendiente */}
                {!(getDocCedula && getDocCedula(d)) && (
                  <i className="ti ti-id-badge-2" title="Sin cédula" aria-label="Sin cédula" style={{ fontSize: 13, color: "#D97706" }} aria-hidden="true" />
                )}
                <span style={{ fontSize: 12, background: "var(--color-background-tertiary)", borderRadius: 10, padding: "2px 8px", color: "var(--color-text-tertiary)", fontWeight: 600 }}>{byDocente[d].length}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!sel ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "var(--color-text-tertiary)", fontSize: 15, fontWeight: 500 }}>Selecciona un docente para ver su horario</div> : (
          <div>
            <div style={{ ...S.card, padding: "18px 22px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={getDocName(sel)} size={52} />
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus style={{ ...S.input, fontSize: 16, fontWeight: 600, flex: 1 }} />
                    <button onClick={saveEdit} disabled={saving} style={{ padding: "6px 14px", background: "var(--brand-500)", color: "#fff", border: "none", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : "Guardar"}</button>
                    <button onClick={() => setEditingName(false)} style={{ padding: "6px 12px", background: "var(--color-background-tertiary)", color: "var(--color-text-tertiary)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>{getDocName(sel)}</div>
                    {onSaveDocenteName && (
                      <button onClick={() => { setEditValue(getDocName(sel)); setEditingName(true); }} title="Editar" style={{ background: "none", border: "1px solid var(--color-border-tertiary)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}><i className="ti ti-pencil" aria-hidden="true" /> Editar</button>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginTop: 4, fontWeight: 500 }}>{selEntries.length} clases asignadas{selConflicts.length > 0 && <span style={{ marginLeft: 10, background: "var(--color-danger-bg)", color: "var(--color-danger)", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}><i className="ti ti-alert-triangle" aria-hidden="true" /> {selConflicts.length} conflicto{selConflicts.length > 1 ? "s" : ""}</span>}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  {editingCedula ? (
                    <>
                      <input
                        value={cedulaValue}
                        onChange={e => setCedulaValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveCedulaEdit(); if (e.key === "Escape") setEditingCedula(false); }}
                        autoFocus
                        placeholder="V-12345678"
                        style={{ ...S.input, fontSize: 13, fontWeight: 600, width: 160, fontFamily: "monospace" }}
                      />
                      <button onClick={saveCedulaEdit} disabled={savingCedula} style={{ padding: "5px 12px", background: "var(--brand-500)", color: "#fff", border: "none", borderRadius: 6, cursor: savingCedula ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, opacity: savingCedula ? 0.6 : 1 }}>{savingCedula ? "Guardando..." : "Guardar"}</button>
                      <button onClick={() => setEditingCedula(false)} style={{ padding: "5px 10px", background: "var(--color-background-tertiary)", color: "var(--color-text-tertiary)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}><i className="ti ti-id-badge-2" aria-hidden="true" /> Cédula:</span>
                      <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: getDocCedula && getDocCedula(sel) ? "var(--color-text-primary)" : "var(--color-border-secondary)" }}>
                        {getDocCedula && getDocCedula(sel) ? getDocCedula(sel) : "sin vincular"}
                      </span>
                      {onSaveDocenteCedula && (
                        <button onClick={() => { setCedulaValue(getDocCedula ? getDocCedula(sel) : ""); setEditingCedula(true); }} title="Editar cédula" style={{ background: "none", border: "1px solid var(--color-border-tertiary)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 500, display: "inline-flex", alignItems: "center" }}><i className="ti ti-pencil" aria-hidden="true" /></button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{[...new Set(selEntries.map(e => e.trayecto))].sort().map(t => <span key={t} style={{ background: TRAYECTO_BG[t] || "var(--color-background-subtle)", color: TRAYECTO_COLORS[t] || "#555", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>T.{t}</span>)}</div>
            </div>
            {selConflicts.map((c, i) => (
              <div key={i} style={{ background: "var(--color-danger-bg)", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 16px", marginBottom: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 17, color: "var(--color-danger)", marginTop: 1 }} aria-hidden="true" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#991B1B" }}>Conflicto: {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {getHoraDisplayDeRegistro(c.entries[0])}</div>
                  <div style={{ fontSize: 12, color: "var(--color-danger-dark)", marginTop: 4, fontWeight: 500 }}>{c.entries.map(e => parseClase(e.clase).materia).join(" · ")}</div>
                </div>
              </div>
            ))}
            {docenteStats && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
                  <StatCard label="Clases" value={docenteStats.totalClases} icon="ti-calendar-event" color="var(--brand-500)" />
                  <StatCard label="Materias" value={docenteStats.totalMaterias} icon="ti-book-2" color="var(--color-warning)" />
                  <StatCard label="Secciones" value={docenteStats.totalSecciones} icon="ti-school" color="var(--color-success)" />
                  <StatCard label="Trayectos" value={docenteStats.totalTrayectos} icon="ti-chart-bar" color="var(--color-role-coord)" />
                </div>
                <div style={{ ...S.card, padding: "14px 18px", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--navy-700)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><i className="ti ti-calendar-event" aria-hidden="true" /> Distribución por día</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DAYS.map(day => {
                      const count = docenteStats.horasPorDia[day] || 0, maxCount = Math.max(...Object.values(docenteStats.horasPorDia), 1), isMax = count === maxCount && count > 0;
                      return (
                        <div key={day} style={{ flex: 1, minWidth: 80, textAlign: "center", padding: "10px 6px", borderRadius: 8, background: count > 0 ? (isMax ? "var(--color-background-info)" : "var(--color-background-secondary)") : "var(--color-background-tertiary)", border: `1px solid ${count > 0 ? (isMax ? "var(--brand-500)" : "var(--color-border-tertiary)") : "var(--color-border-tertiary)"}` }}>
                          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>{day.slice(0, 3)}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: count > 0 ? (isMax ? "var(--brand-600)" : "var(--navy-700)") : "var(--color-border-secondary)" }}>{count}</div>
                          {count > 0 && <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 2 }}>clases</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <div style={S.card}>
              <div style={{ padding: "14px 18px", borderBottom: "2px solid var(--color-border-tertiary)", fontSize: 14, fontWeight: 700, color: "var(--navy-700)", display: "flex", alignItems: "center", gap: 7 }}><i className="ti ti-list-details" aria-hidden="true" /> Asignaciones</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...S.th, width: 100 }}>Día</th>
                      <th style={{ ...S.th, width: 180 }}>Hora</th>
                      <th style={S.th}>Materia</th>
                      <th style={{ ...S.th, width: 90 }}>Trayecto</th>
                      <th style={{ ...S.th, width: 130 }}>Sección</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((e, i) => {
                      const { materia } = parseClase(e.clase);
                      const prevEntry = i > 0 ? sortedEntries[i-1] : null;
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFB" }}>
                          <td style={{ ...S.td, fontWeight: 600, color: "var(--color-text-primary)", borderTop: prevEntry && prevEntry.dia !== e.dia ? "2px solid var(--color-border-tertiary)" : "1px solid var(--color-background-tertiary)" }}>{e.dia.charAt(0)+e.dia.slice(1).toLowerCase()}</td>
                          <td style={{ ...S.td, color: "var(--color-text-tertiary)", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500 }}>{getHoraDisplayDeRegistro(e)}</td>
                          <td style={{ ...S.td, fontWeight: 600, fontSize: 13 }}>{materia}</td>
                          <td style={S.td}><span style={{ background: TRAYECTO_BG[e.trayecto] || "var(--color-background-subtle)", color: TRAYECTO_COLORS[e.trayecto] || "#555", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{e.trayecto}</span></td>
                          <td style={{ ...S.td, color: "var(--color-text-tertiary)", fontWeight: 500, fontSize: 12 }}>{e.sheet?.trim() || ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
