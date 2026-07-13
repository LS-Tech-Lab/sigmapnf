import React, { useState, useEffect, useMemo } from 'react';
import { DAYS, trayectoClass } from '../constants';
import { getHoraDisplayDeRegistro, getHoraMin } from '../utils/time';
import { parseClase } from '../utils/parsing';
import Avatar from './Avatar';
import StatCard from './StatCard';
import './DocentesView.css';

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
    <div className="dv-root">
      {modoConsulta && (
        <div className="dv-modo-banner">
          <i className="ti ti-archive dv-modo-icon" aria-hidden="true" />
          <span className="dv-modo-text">
            Modo consulta — trimestre {lapso} (solo lectura)
          </span>
        </div>
      )}
    <div className="docentes-layout dv-body">
      <div className="docentes-left-panel dv-left-panel">
        {/* M-4: banner de cédulas pendientes */}
        {sinCedula.length > 0 && (
          <div className="dv-cedula-banner">
            <i className="ti ti-id-badge-2 dv-cedula-banner-icon" aria-hidden="true" />
            {sinCedula.length} sin cédula
          </div>
        )}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar docente…" className="s-input dv-search-input" />
        <div className="s-card dv-list-card">
          <div className="dv-list-header">{filteredSorted.length} docentes</div>
          {filteredSorted.map(d => (
            <div key={d} onClick={() => { setSel(d); setEditingName(false); }}
              className={`dv-list-item${sel === d ? ' dv-list-item--active' : ''}`}
            >
              <span className="dv-list-item-name">{hasConflict(d) && <i className="ti ti-alert-triangle dv-list-item-conflict-icon" title="Conflictos" aria-hidden="true" />}{getDocName(d)}</span>
              <div className="dv-list-item-right">
                {/* M-4: badge de cédula pendiente */}
                {!(getDocCedula && getDocCedula(d)) && (
                  <i className="ti ti-id-badge-2 dv-list-item-cedula-icon" title="Sin cédula" aria-label="Sin cédula" aria-hidden="true" />
                )}
                <span className="dv-list-item-count">{byDocente[d].length}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="dv-detail-panel">
        {!sel ? <div className="dv-detail-empty">Selecciona un docente para ver su horario</div> : (
          <div>
            <div className="s-card dv-header-card">
              <Avatar name={getDocName(sel)} size={52} />
              <div className="dv-header-main">
                {editingName ? (
                  <div className="dv-name-edit-row">
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus className="s-input dv-name-edit-input" />
                    <button onClick={saveEdit} disabled={saving} className="dv-btn-save">{saving ? "Guardando..." : "Guardar"}</button>
                    <button onClick={() => setEditingName(false)} className="dv-btn-cancel">Cancelar</button>
                  </div>
                ) : (
                  <div className="dv-name-row">
                    <div className="dv-name-text">{getDocName(sel)}</div>
                    {onSaveDocenteName && (
                      <button onClick={() => { setEditValue(getDocName(sel)); setEditingName(true); }} title="Editar" className="dv-edit-btn"><i className="ti ti-pencil" aria-hidden="true" /> Editar</button>
                    )}
                  </div>
                )}
                <div className="dv-meta-row">{selEntries.length} clases asignadas{selConflicts.length > 0 && <span className="dv-conflicto-badge"><i className="ti ti-alert-triangle" aria-hidden="true" /> {selConflicts.length} conflicto{selConflicts.length > 1 ? "s" : ""}</span>}</div>
                <div className="dv-cedula-row">
                  {editingCedula ? (
                    <>
                      <input
                        value={cedulaValue}
                        onChange={e => setCedulaValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveCedulaEdit(); if (e.key === "Escape") setEditingCedula(false); }}
                        autoFocus
                        placeholder="V-12345678"
                        className="s-input dv-cedula-input"
                      />
                      <button onClick={saveCedulaEdit} disabled={savingCedula} className="dv-btn-save dv-btn-save--sm">{savingCedula ? "Guardando..." : "Guardar"}</button>
                      <button onClick={() => setEditingCedula(false)} className="dv-btn-cancel dv-btn-cancel--sm">Cancelar</button>
                    </>
                  ) : (
                    <>
                      <span className="dv-cedula-label"><i className="ti ti-id-badge-2" aria-hidden="true" /> Cédula:</span>
                      <span className={`dv-cedula-value${getDocCedula && getDocCedula(sel) ? ' dv-cedula-value--set' : ' dv-cedula-value--unset'}`}>
                        {getDocCedula && getDocCedula(sel) ? getDocCedula(sel) : "sin vincular"}
                      </span>
                      {onSaveDocenteCedula && (
                        <button onClick={() => { setCedulaValue(getDocCedula ? getDocCedula(sel) : ""); setEditingCedula(true); }} title="Editar cédula" className="dv-edit-btn dv-edit-btn--sm"><i className="ti ti-pencil" aria-hidden="true" /></button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="dv-trayecto-badges">{[...new Set(selEntries.map(e => e.trayecto))].sort().map(t => <span key={t} className={`dv-trayecto-badge ${trayectoClass(t)}`}>T.{t}</span>)}</div>
            </div>
            {selConflicts.map((c, i) => (
              <div key={i} className="dv-conflict-card">
                <i className="ti ti-alert-triangle dv-conflict-icon" aria-hidden="true" />
                <div>
                  <div className="dv-conflict-title">Conflicto: {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {getHoraDisplayDeRegistro(c.entries[0])}</div>
                  <div className="dv-conflict-detail">{c.entries.map(e => parseClase(e.clase).materia).join(" · ")}</div>
                </div>
              </div>
            ))}
            {docenteStats && (
              <>
                <div className="dv-stats-grid">
                  <StatCard label="Clases" value={docenteStats.totalClases} icon="ti-calendar-event" variant="brand" />
                  <StatCard label="Materias" value={docenteStats.totalMaterias} icon="ti-book-2" variant="warning" />
                  <StatCard label="Secciones" value={docenteStats.totalSecciones} icon="ti-school" variant="success" />
                  <StatCard label="Trayectos" value={docenteStats.totalTrayectos} icon="ti-chart-bar" variant="role-coord" />
                </div>
                <div className="s-card dv-day-card">
                  <div className="dv-day-title"><i className="ti ti-calendar-event" aria-hidden="true" /> Distribución por día</div>
                  <div className="dv-day-row">
                    {DAYS.map(day => {
                      const count = docenteStats.horasPorDia[day] || 0, maxCount = Math.max(...Object.values(docenteStats.horasPorDia), 1), isMax = count === maxCount && count > 0;
                      const cellMod = count > 0 ? (isMax ? ' dv-day-cell--max' : ' dv-day-cell--active') : '';
                      return (
                        <div key={day} className={`dv-day-cell${cellMod}`}>
                          <div className="dv-day-cell-label">{day.slice(0, 3)}</div>
                          <div className="dv-day-cell-count">{count}</div>
                          {count > 0 && <div className="dv-day-cell-sub">clases</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <div className="s-card">
              <div className="dv-table-header"><i className="ti ti-list-details" aria-hidden="true" /> Asignaciones</div>
              <div className="dv-table-wrap">
                <table className="dv-table">
                  <thead>
                    <tr>
                      <th className="s-th">Día</th>
                      <th className="s-th">Hora</th>
                      <th className="s-th">Materia</th>
                      <th className="s-th">Trayecto</th>
                      <th className="s-th">Sección</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((e, i) => {
                      const { materia } = parseClase(e.clase);
                      const prevEntry = i > 0 ? sortedEntries[i-1] : null;
                      return (
                        <tr key={i}>
                          <td className={`s-td dv-td-dia ${prevEntry && prevEntry.dia !== e.dia ? "dv-td-dia--nuevo-dia" : "dv-td-dia--mismo-dia"}`}>{e.dia.charAt(0)+e.dia.slice(1).toLowerCase()}</td>
                          <td className="s-td dv-td-hora">{getHoraDisplayDeRegistro(e)}</td>
                          <td className="s-td dv-td-materia">{materia}</td>
                          <td className="s-td"><span className={`dv-trayecto-badge ${trayectoClass(e.trayecto)}`}>{e.trayecto}</span></td>
                          <td className="s-td dv-td-seccion">{e.sheet?.trim() || ""}</td>
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
