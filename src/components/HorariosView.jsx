import React, { useState } from 'react';
import { S, DAYS, BLOQUES_DIURNO, BLOQUES_VESPERTINO } from '../constants';
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
}) {
  const [tab, setTab] = useState('horarios');
  const days = activeDay === "all" ? DAYS : [activeDay];
  const fd = filtered.filter(d => getTurnoDeRegistro(d) === "DIURNO");
  const fv = filtered.filter(d => getTurnoDeRegistro(d) === "VESPERTINO");

  const TABS = [
    { id: 'horarios', label: '📅 Horarios' },
    { id: 'conflictos', label: `⚠️ Conflictos${conflicts?.length ? ` (${conflicts.length})` : ''}` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Tabs + filtros ── */}
      <div className="horarios-filters" style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #E5E7EB" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: tab === 'horarios' ? 10 : 0, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827", marginRight: 4 }}>📅 Horarios</h1>
          {/* Pill tabs */}
          <div style={{ display: "flex", gap: 4, background: "#F3F4F6", borderRadius: 10, padding: 4 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 600, transition: "all 0.15s",
                background: tab === t.id ? "#fff" : "transparent",
                color: tab === t.id ? "#111827" : "#6B7280",
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}>{t.label}</button>
            ))}
          </div>
          {tab === 'horarios' && (
            <>
              <select value={selectedTrayecto} onChange={e => { setSelectedTrayecto(e.target.value); setSelectedSeccion("all"); }} style={S.select}>
                <option value="all">Todos los trayectos</option>
                {allTrayectos.map(t => <option key={t} value={t}>Trayecto {t}</option>)}
              </select>
              <select value={selectedSeccion} onChange={e => setSelectedSeccion(e.target.value)} style={S.select}>
                <option value="all">Todas las secciones</option>
                {seccionesByTrayecto.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{ fontSize: 13, color: "#6B7280", marginLeft: "auto", fontWeight: 600 }}>{filtered.length} clases</span>
            </>
          )}
        </div>
        {tab === 'horarios' && (
          <div className="day-buttons" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["all", ...DAYS].map(d => (
              <button key={d} onClick={() => setActiveDay(d)} style={S.btn(activeDay === d)}>
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
            {(filtered.length === 0 || (fd.length === 0 && fv.length === 0)) && <div style={{ ...S.card, padding: "60px 20px", textAlign: "center", color: "#9CA3AF", fontSize: 15, fontWeight: 500 }}>No hay clases para los filtros seleccionados.</div>}
          </>
        )}
        {tab === 'conflictos' && (
          <ConflictosView conflicts={conflicts} onGoDocente={onGoDocente} getDocName={getDocName} />
        )}
      </div>
    </div>
  );
}
