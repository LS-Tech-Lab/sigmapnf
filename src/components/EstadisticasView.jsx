import React, { useMemo } from 'react';
import { S, DAYS, ALL_TRAYECTOS, TRAYECTO_COLORS, TRAYECTO_BG } from '../constants';
import StatCard from './StatCard';

export default function EstadisticasView({ stats, byDocente, byMateria, data, getDocName, getMateriaName }) {
  const trayectoCount = {}, dayCount = {}, turnoCount = {};
  data.forEach(d => {
    trayectoCount[d.trayecto] = (trayectoCount[d.trayecto] || 0) + 1;
    turnoCount[d.turno] = (turnoCount[d.turno] || 0) + 1;
  });
  DAYS.forEach(d => { dayCount[d] = data.filter(r => r.dia === d).length; });
  const maxDay = Math.max(...Object.values(dayCount), 1);
  const top8Docentes = Object.entries(byDocente).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const maxLoadDocente = Math.max(...top8Docentes.map(([, e]) => e.length), 1);
  const topMaterias = Object.entries(byMateria).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  const maxMat = topMaterias[0]?.[1] || 1;
  const totalClases = data.length, seccionesCount = new Set(data.map(d => d.sheet.trim())).size;

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>📊 Estadísticas</h1>
      <div className="stats-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard label="Total de clases" value={totalClases} icon="📅" color="#2563EB" />
        <StatCard label="Secciones" value={seccionesCount} icon="🏫" color="#059669" />
        <StatCard label="Docentes" value={stats.docentes} icon="👥" color="#7C3AED" />
        <StatCard label="Materias únicas" value={stats.materias} icon="📖" color="#D97706" />
      </div>
      <div className="stats-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Clases por trayecto</div>
          {Object.entries(trayectoCount).sort().map(([t, c]) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ background: TRAYECTO_BG[t] || "#f3f4f6", color: TRAYECTO_COLORS[t] || "#555", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{t}</span>
              <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}>
                <div style={{ width: `${(c/totalClases)*100}%`, height: "100%", background: TRAYECTO_COLORS[t] || "#888", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 13, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{c}</span>
            </div>
          ))}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Distribución por día</div>
          {DAYS.map(d => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 13, width: 80, color: "#6B7280", fontWeight: 500 }}>{d.charAt(0)+d.slice(1).toLowerCase()}</span>
              <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}>
                <div style={{ width: `${(dayCount[d]/maxDay)*100}%`, height: "100%", background: "#059669", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 13, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{dayCount[d]}</span>
            </div>
          ))}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Docentes con mayor carga</div>
          {top8Docentes.map(([doc, entries], idx) => (
            <div key={doc} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#D1D5DB", width: 16 }}>{idx+1}</span>
              <span style={{ fontSize: 13, flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{getDocName(doc)}</span>
              <div style={{ width: 100, background: "#F3F4F6", borderRadius: 4, height: 10, overflow: "hidden" }}>
                <div style={{ width: `${(entries.length/maxLoadDocente)*100}%`, height: "100%", background: "#7C3AED", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 13, width: 24, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{entries.length}</span>
            </div>
          ))}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Materias más frecuentes</div>
          {topMaterias.map(([mat, entries], idx) => {
            const cnt = entries.length;
            return (
              <div key={mat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#D1D5DB", width: 16 }}>{idx+1}</span>
                <span style={{ fontSize: 13, flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={getMateriaName(mat)}>
                  {getMateriaName(mat).length > 28 ? getMateriaName(mat).slice(0,26)+"…" : getMateriaName(mat)}
                </span>
                <div style={{ width: 100, background: "#F3F4F6", borderRadius: 4, height: 10, overflow: "hidden" }}>
                  <div style={{ width: `${(cnt/maxMat)*100}%`, height: "100%", background: "#D97706", borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 13, width: 24, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{cnt}</span>
              </div>
            );
          })}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Distribución por turno</div>
          {Object.entries(turnoCount).sort().map(([t, cnt]) => {
            const pct = totalClases > 0 ? Math.round((cnt/totalClases)*100) : 0;
            const colors = { DIURNO: "#2563EB", VESPERTINO: "#DB2777" };
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 13, width: 90, color: "#6B7280", fontWeight: 500 }}>{t.charAt(0)+t.slice(1).toLowerCase()}</span>
                <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 14, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: colors[t] || "#888", borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 13, color: "#6B7280", fontWeight: 600, width: 60, textAlign: "right" }}>{cnt} ({pct}%)</span>
              </div>
            );
          })}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Secciones por trayecto</div>
          {ALL_TRAYECTOS.map(t => {
            const cnt = [...new Set(data.filter(d => d.trayecto === t).map(d => d.sheet.trim()))].length;
            const pct = seccionesCount > 0 ? (cnt/seccionesCount)*100 : 0;
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ background: TRAYECTO_BG[t] || "#f3f4f6", color: TRAYECTO_COLORS[t] || "#555", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{t}</span>
                <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: TRAYECTO_COLORS[t] || "#888", borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 13, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{cnt}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
