import React from 'react';
import { S, DAYS, BLOQUES_DIURNO, BLOQUES_VESPERTINO } from '../constants';
import { getTurnoDeRegistro } from '../utils/turno';
import TurnoGrid from './TurnoGrid';

export default function HorariosView({
  filtered,
  selectedTrayecto, setSelectedTrayecto,
  selectedSeccion, setSelectedSeccion,
  activeDay, setActiveDay,
  seccionesByTrayecto,
  expandedCell, setExpandedCell,
  getDocName, getMateriaName,
  allTrayectos
}) {
  const days = activeDay === "all" ? DAYS : [activeDay];
  const fd = filtered.filter(d => getTurnoDeRegistro(d) === "DIURNO");
  const fv = filtered.filter(d => getTurnoDeRegistro(d) === "VESPERTINO");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="horarios-filters" style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #E5E7EB", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827", marginRight: 4 }}>📅 Horarios</h1>
        <select value={selectedTrayecto} onChange={e => { setSelectedTrayecto(e.target.value); setSelectedSeccion("all"); }} style={S.select}>
          <option value="all">Todos los trayectos</option>
          {allTrayectos.map(t => <option key={t} value={t}>Trayecto {t}</option>)}
        </select>
        <select value={selectedSeccion} onChange={e => setSelectedSeccion(e.target.value)} style={S.select}>
          <option value="all">Todas las secciones</option>
          {seccionesByTrayecto.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 13, color: "#6B7280", marginLeft: "auto", fontWeight: 600 }}>{filtered.length} clases</span>
      </div>
      <div className="day-buttons" style={{ padding: "10px 20px", background: "#fff", borderBottom: "1px solid #F3F4F6", display: "flex", gap: 6 }}>
        {["all", ...DAYS].map(d => <button key={d} onClick={() => setActiveDay(d)} style={S.btn(activeDay === d)}>{d === "all" ? "Semana completa" : d.charAt(0) + d.slice(1).toLowerCase()}</button>)}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {fd.length > 0 && <TurnoGrid bloques={BLOQUES_DIURNO} turnoLabel="DIURNO" filtered={fd} days={days} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} />}
        {fv.length > 0 && <TurnoGrid bloques={BLOQUES_VESPERTINO} turnoLabel="VESPERTINO" filtered={fv} days={days} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} />}
        {filtered.length === 0 && <div style={{ ...S.card, padding: "60px 20px", textAlign: "center", color: "#9CA3AF", fontSize: 15, fontWeight: 500 }}>No hay clases para los filtros seleccionados.</div>}
      </div>
    </div>
  );
}
