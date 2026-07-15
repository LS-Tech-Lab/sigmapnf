import React, { useState, useEffect } from 'react';
import { DAYS, BLOQUES_DIURNO, BLOQUES_VESPERTINO } from '../constants';
import { getTurnoDeRegistro } from '../utils/turno';
import TurnoGrid from './TurnoGrid';
import ConflictosView from './ConflictosView';
import './HorariosView.css';

export default function HorariosView({
  filtered,
  selectedTrayecto, setSelectedTrayecto,
  selectedSeccion, setSelectedSeccion,
  activeDay, setActiveDay,
  seccionesByTrayecto,
  expandedCell, setExpandedCell,
  getDocName, getMateriaName,
  allTrayectos,
  conflicts, onGoDocente,
  initialTab, onConsumeInitialTab,
  // UX-14 (implementado 15 de julio): mismo patrón que `DocentesView`/
  // `MateriasView` — `modoConsulta` solo controla el banner de solo-lectura
  // de acá abajo. La capacidad real de editar/borrar se gatea aparte, por
  // permiso, vía `puedeEditar`/`puedeBorrar` (null cuando no se tiene el
  // permiso — ver HorariosLayout.jsx), igual que `onSaveDocenteName` en
  // `DocentesView`.
  modoConsulta,
  lapso,
  puedeEditar, puedeBorrar, onSaveClase, onDeleteClase, openConfirm, closeConfirm,
}) {
  const [tab, setTab] = useState('horarios');

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
      onConsumeInitialTab?.();
    }
  }, [initialTab, onConsumeInitialTab]);

  const days = activeDay === "all" ? DAYS : [activeDay];
  const fd = filtered.filter(d => getTurnoDeRegistro(d) === "DIURNO");
  const fv = filtered.filter(d => getTurnoDeRegistro(d) === "VESPERTINO");

  const TABS = [
    { id: 'horarios', icon: 'ti-calendar-event', label: 'Horarios' },
    { id: 'conflictos', icon: 'ti-alert-triangle', label: `Conflictos${conflicts?.length ? ` (${conflicts.length})` : ''}` },
  ];

  return (
    <div className="hv-root">
      {modoConsulta && (
        <div className="hv-modo-banner">
          <i className="ti ti-archive hv-modo-icon" aria-hidden="true" />
          <span className="hv-modo-text">
            Modo consulta — trimestre {lapso} (solo lectura)
          </span>
        </div>
      )}
      {/* ── Tabs + filtros ── */}
      <div className="hv-filters">
        <div className={`hv-filters-row${tab === 'conflictos' ? ' hv-filters-row--conflictos' : ''}`}>
          <h1 className="hv-title">
            <i className="ti ti-calendar-event hv-title-icon" aria-hidden="true" /> Horarios
          </h1>
          {/* Pill tabs */}
          <div className="hv-tabs">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`hv-tab${tab === t.id ? ' hv-tab--active' : ''}`}>
                <i className={`ti ${t.icon}`} aria-hidden="true" /> {t.label}
              </button>
            ))}
          </div>
          {tab === 'horarios' && (
            <>
              <select value={selectedTrayecto} onChange={e => { setSelectedTrayecto(e.target.value); setSelectedSeccion("all"); }} className="s-select">
                <option value="all">Todos los trayectos</option>
                {allTrayectos.map(t => <option key={t} value={t}>Trayecto {t}</option>)}
              </select>
              <select value={selectedSeccion} onChange={e => setSelectedSeccion(e.target.value)} className="s-select">
                <option value="all">Todas las secciones</option>
                {seccionesByTrayecto.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="hv-count">{filtered.length} clases</span>
            </>
          )}
        </div>
        {tab === 'horarios' && (
          <div className="hv-days">
            {["all", ...DAYS].map(d => (
              <button key={d} onClick={() => setActiveDay(d)} className={`s-btn ${activeDay === d ? "s-btn--active" : ""}`}>
                {d === "all" ? "Semana completa" : d.charAt(0) + d.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Contenido ── */}
      <div className={`hv-content${tab === 'conflictos' ? ' hv-content--conflictos' : ''}`}>
        {tab === 'horarios' && (
          <>
            {fd.length > 0 && <TurnoGrid bloques={BLOQUES_DIURNO} turnoLabel="DIURNO" filtered={fd} days={days} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} puedeEditar={puedeEditar} puedeBorrar={puedeBorrar} onSaveClase={onSaveClase} onDeleteClase={onDeleteClase} openConfirm={openConfirm} closeConfirm={closeConfirm} />}
            {fv.length > 0 && <TurnoGrid bloques={BLOQUES_VESPERTINO} turnoLabel="VESPERTINO" filtered={fv} days={days} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} puedeEditar={puedeEditar} puedeBorrar={puedeBorrar} onSaveClase={onSaveClase} onDeleteClase={onDeleteClase} openConfirm={openConfirm} closeConfirm={closeConfirm} />}
            {(filtered.length === 0 || (fd.length === 0 && fv.length === 0)) && <div className="s-card s-empty-state">No hay clases para los filtros seleccionados.</div>}
          </>
        )}
        {tab === 'conflictos' && (
          <ConflictosView conflicts={conflicts} onGoDocente={onGoDocente} getDocName={getDocName} />
        )}
      </div>
    </div>
  );
}
