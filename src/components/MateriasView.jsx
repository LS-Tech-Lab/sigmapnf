import React, { useState, useEffect, useMemo } from 'react';
import { DAYS, TRAYECTO_COLORS, TRAYECTO_BG } from '../constants';
import { getHoraDisplayDeRegistro, getHoraMin } from '../utils/time';
import { getTurnoDeRegistro } from '../utils/turno';
import { parseClase } from '../utils/parsing';
import Avatar from './Avatar';
import './MateriasView.css';

export default function MateriasView({ byMateria, initialSel, onConsumeNav, getMateriaName, onSaveMateriaName, data, getDocName, modoConsulta, lapso }) {
  const sorted = Object.keys(byMateria).sort();
  const [sel, setSel] = useState(initialSel || null), [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false), [editValue, setEditValue] = useState(""), [saving, setSaving] = useState(false);

  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel, onConsumeNav]);
  // Solo actualizar editValue cuando cambia la selección, NO cuando cambia getMateriaName.
  // Misma razón que DocentesView: evitar condición de carrera al guardar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) { setEditValue(getMateriaName(sel)); setEditingName(false); } }, [sel]);

  const selEntries = sel && byMateria[sel] ? byMateria[sel] : [];
  const filteredSorted = search ? sorted.filter(m => getMateriaName(m).toLowerCase().includes(search.toLowerCase())) : sorted;

  const saveEdit = async () => {
    const t = editValue.trim();
    if (t && sel && onSaveMateriaName) {
      setSaving(true);
      const res = await onSaveMateriaName(sel, t);
      setSaving(false);
      if (res.success) {
        setEditingName(false);
        if (res.targetRaw) setSel(res.targetRaw);
      }
    } else setEditingName(false);
  };

  const asignaciones = useMemo(() => {
    if (!selEntries.length) return [];
    return selEntries.slice().sort((a, b) => {
      const ia = DAYS.indexOf(a.dia), ib = DAYS.indexOf(b.dia);
      return (ia !== -1 ? ia : 9) - (ib !== -1 ? ib : 9) || getHoraMin(a) - getHoraMin(b);
    });
  }, [selEntries]);

  return (
    <div className="mv-root">
      {modoConsulta && (
        <div className="mv-modo-banner">
          <i className="ti ti-archive mv-modo-icon" aria-hidden="true" />
          <span className="mv-modo-text">
            Modo consulta — trimestre {lapso} (solo lectura)
          </span>
        </div>
      )}
    <div className="materias-layout mv-body">
      <div className="materias-left-panel mv-left-panel">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar materia…" className="s-input mv-search-input" />
        <div className="s-card mv-list-card">
          <div className="mv-list-header">{filteredSorted.length} materias</div>
          {filteredSorted.map(m => (
            <div key={m} onClick={() => { setSel(m); setEditingName(false); }}
              className={`mv-list-item${sel === m ? ' mv-list-item--active' : ''}`}
            >
              <span>{getMateriaName(m)}</span>
              <span className="mv-list-item-count">{byMateria[m].length}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mv-detail-panel">
        {!sel ? <div className="mv-detail-empty">Selecciona una materia para ver detalles</div> : (
          <>
            <div className="s-card mv-header-card">
              <Avatar name={getMateriaName(sel)} size={52} />
              <div className="mv-header-main">
                {editingName ? (
                  <div className="mv-name-edit-row">
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus className="s-input mv-name-edit-input" />
                    <button onClick={saveEdit} disabled={saving} className="mv-btn-save">{saving ? "Guardando..." : "Guardar"}</button>
                    <button onClick={() => setEditingName(false)} className="mv-btn-cancel">Cancelar</button>
                  </div>
                ) : (
                  <div className="mv-name-row">
                    <div className="mv-name-text">{getMateriaName(sel)}</div>
                    {onSaveMateriaName && (
                      <button onClick={() => { setEditValue(getMateriaName(sel)); setEditingName(true); }} title="Editar" className="mv-edit-btn"><i className="ti ti-pencil" aria-hidden="true" /> Editar</button>
                    )}
                  </div>
                )}
                <div className="mv-meta-row">
                  {selEntries.length} clases asignadas
                  {selEntries.length > 0 && <span className="mv-trayecto-count-badge">{new Set(selEntries.map(e => e.trayecto)).size} trayecto(s)</span>}
                </div>
              </div>
            </div>
            <div className="s-card">
              <div className="mv-table-header"><i className="ti ti-list-details" aria-hidden="true" /> Asignaciones</div>
              <div className="mv-table-wrap">
                <table className="mv-table">
                  <thead>
                    <tr>
                      {["Día", "Hora", "Turno", "Sección", "Trayecto", "Docente"].map(h => <th key={h} className="s-th">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {asignaciones.map((e, i) => {
                      const tr = getTurnoDeRegistro(e);
                      const { docente: docenteParseado } = parseClase(e.clase);
                      const rd = e.docentes?.nombre_raw || docenteParseado;
                      return (
                        <tr key={i}>
                          <td className="s-td mv-td-dia">{e.dia.charAt(0)+e.dia.slice(1).toLowerCase()}</td>
                          <td className="s-td mv-td-hora">{getHoraDisplayDeRegistro(e)}</td>
                          <td className="s-td"><span className={`mv-turno-badge${tr === "DIURNO" ? ' mv-turno-badge--diurno' : ' mv-turno-badge--vespertino'}`}><span className="mv-turno-badge-inner"><i className={`ti ${tr === "DIURNO" ? "ti-sun-high" : "ti-moon-stars"}`} aria-hidden="true" /> {tr === "DIURNO" ? "Diurno" : "Vespertino"}</span></span></td>
                          <td className="s-td mv-td-seccion">{e.sheet?.trim() || ""}</td>
                          <td className="s-td"><span className="mv-trayecto-badge" style={{ background: TRAYECTO_BG[e.trayecto] || "var(--color-background-subtle)", color: TRAYECTO_COLORS[e.trayecto] || "#555" }}>{e.trayecto}</span></td>
                          <td className="s-td mv-td-docente">{rd && getDocName ? getDocName(rd) : (rd || "—")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </div>
  );
}
