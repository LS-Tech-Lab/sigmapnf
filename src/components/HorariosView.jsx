import React, { useState, useEffect } from 'react';
import { DAYS, BLOQUES_DIURNO, BLOQUES_VESPERTINO } from '../constants';
import { getTurnoDeRegistro } from '../utils/turno';
import TurnoGrid from './TurnoGrid';
import ConflictosView from './ConflictosView';

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
  modoConsulta,
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Tabs + filtros ── */}
      <div className="horarios-filters" style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #E2E8F0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: tab === 'horarios' ? 10 : 0, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0F172A", marginRight: 4, display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-calendar-event" style={{ color: "#2563EB" }} aria-hidden="true" /> Horarios
          </h1>
          {/* Pill tabs */}
          <div style={{ display: "flex", gap: 4, background: "#F1F5F9", borderRadius: 10, padding: 4 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 600, transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 6,
                background: tab === t.id ? "#fff" : "transparent",
                color: tab === t.id ? "#0F172A" : "#64748B",
                boxShadow: tab === t.id ? "0 1px 3px rgba(15,23,42,0.10)" : "none",
              }}><i className={`ti ${t.icon}`} aria-hidden="true" /> {t.label}</button>
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
              <span style={{ fontSize: 13, color: "#64748B", marginLeft: "auto", fontWeight: 600 }}>{filtered.length} clases</span>
            </>
          )}
        </div>
        {tab === 'horarios' && (
          <div className="day-buttons" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["all", ...DAYS].map(d => (
              <button key={d} onClick={() => setActiveDay(d)} className={`s-btn ${activeDay === d ? "s-btn--active" : ""}`}>
                {d === "all" ? "Semana completa" : d.charAt(0) + d.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Contenido ── */}
      <div style={{ flex: 1, overflow: "auto", padding: tab === 'conflictos' ? 0 : "12px 16px" }}>
        {tab === 'horarios' && (
          <>
            {fd.length > 0 && <TurnoGrid bloques={BLOQUES_DIURNO} turnoLabel="DIURNO" filtered={fd} days={days} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} />}
            {fv.length > 0 && <TurnoGrid bloques={BLOQUES_VESPERTINO} turnoLabel="VESPERTINO" filtered={fv} days={days} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} />}
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
