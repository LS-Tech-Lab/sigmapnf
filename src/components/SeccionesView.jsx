import React, { useState, useMemo, useEffect } from 'react';
import { S, DAYS, TRAYECTO_COLORS, TRAYECTO_BG, ALL_TRAYECTOS } from '../constants';
import { getHoraDisplayDeRegistro, getHoraMin } from '../utils/time';
import { parseClase } from '../utils/parsing';

export default function SeccionesView({ data, getDocName, getMateriaName }) {
  const allSecciones = useMemo(() => [...new Set(data.map(d => d.sheet.trim()))].sort(), [data]);
  const [selSheet, setSelSheet] = useState(null), [filterTray, setFilterTray] = useState("all");
  
  useEffect(() => { if (allSecciones.length && (!selSheet || !allSecciones.includes(selSheet))) setSelSheet(allSecciones[0]); }, [allSecciones, selSheet]);
  
  const filteredSecciones = useMemo(() => filterTray === "all" ? allSecciones : allSecciones.filter(s => data.some(d => d.sheet.trim() === s && d.trayecto === filterTray)), [filterTray, allSecciones, data]);

  // Fix: en lugar de tomar el trayecto del primer registro (data.find), se calculan
  // todos los trayectos presentes por sección. Si hay más de uno, se muestra el
  // que coincide con el filtro activo (o el primero, ordenado, si el filtro es "all").
  const trayectosBySeccion = useMemo(() => {
    const map = {};
    data.forEach(d => {
      const s = d.sheet.trim();
      if (!map[s]) map[s] = new Set();
      map[s].add(d.trayecto);
    });
    return map;
  }, [data]);

  const getTrayectoIndicador = (s) => {
    const trayectos = trayectosBySeccion[s];
    if (!trayectos || trayectos.size === 0) return null;
    if (filterTray !== "all" && trayectos.has(filterTray)) return filterTray;
    return [...trayectos].sort()[0];
  };

  const entries = useMemo(() => data.filter(d => d.sheet.trim() === selSheet), [data, selSheet]);
  const info = entries[0];
  // Fix: si la sección tiene registros con más de un "programa" (caso edge),
  // se deriva el programa mayoritario en lugar de asumir el del primer registro.
  const programaSeccion = useMemo(() => {
    if (!entries.length) return "";
    const counts = {};
    entries.forEach(e => { if (e.programa) counts[e.programa] = (counts[e.programa] || 0) + 1; });
    const sortedProgramas = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sortedProgramas[0]?.[0] || "";
  }, [entries]);
  const byDay = useMemo(() => DAYS.reduce((acc, day) => { acc[day] = entries.filter(e => e.dia === day).sort((a, b) => getHoraMin(a) - getHoraMin(b)); return acc; }, {}), [entries]);

  return (
    <div className="secciones-layout" style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div className="secciones-left-panel" style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <select value={filterTray} onChange={e => setFilterTray(e.target.value)} style={{ ...S.select, width: "100%" }}>
          <option value="all">Todos los trayectos</option>
          {ALL_TRAYECTOS.map(t => <option key={t} value={t}>Trayecto {t}</option>)}
        </select>
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#6B7280", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filteredSecciones.length} secciones</div>
          {filteredSecciones.map(s => {
            const tray = getTrayectoIndicador(s);
            return (
              <div key={s} onClick={() => setSelSheet(s)}
                style={{
                  padding: "10px 14px", cursor: "pointer", fontSize: 14,
                  fontWeight: selSheet === s ? 600 : 400,
                  background: selSheet === s ? "#EFF6FF" : "transparent",
                  color: selSheet === s ? "#1D4ED8" : "#374151",
                  borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 8
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: TRAYECTO_COLORS[tray] || "#ccc", flexShrink: 0 }} />
                {s}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {info && (
          <>
            <div style={{ ...S.card, padding: "18px 22px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{selSheet}</div>
                  <div style={{ fontSize: 14, color: "#6B7280", marginTop: 2, fontWeight: 500 }}>{programaSeccion}</div>
                </div>
                <span style={{ background: TRAYECTO_BG[info.trayecto] || "#f3f4f6", color: TRAYECTO_COLORS[info.trayecto] || "#555", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>Trayecto {info.trayecto}</span>
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                {[
                  ["Turno", info.turno],
                  ["Sección", info.seccion],
                  ["Sede", info.sede],
                  info.aula && ["Aula", info.aula],
                  ["Total clases", entries.length]
                ].filter(Boolean).map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginTop: 3 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderBottom: "2px solid #E5E7EB" }}>
                {DAYS.map(day => (
                  <div key={day} style={{ padding: "12px 14px", borderRight: "1px solid #E5E7EB", fontWeight: 700, fontSize: 12, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", background: "#F9FAFB" }}>
                    {day.slice(0, 3)}
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)" }}>
                {DAYS.map(day => (
                  <div key={day} style={{ padding: "10px 10px", borderRight: "1px solid #F3F4F6", minHeight: 130 }}>
                    {(byDay[day] || []).map((e, i) => {
                      const { materia: rm, docente: rd } = parseClase(e.clase);
                      const materia = getMateriaName(rm), docente = getDocName(rd);
                      const col = TRAYECTO_COLORS[e.trayecto] || "#555", bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5";
                      return (
                        <div key={i} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "6px 10px", marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: col, lineHeight: 1.3 }}>{materia.length > 24 ? materia.slice(0, 22) + "…" : materia}</div>
                          <div style={{ fontSize: 11, color: col, opacity: 0.75, marginTop: 2, fontWeight: 500 }}>{getHoraDisplayDeRegistro(e)}</div>
                          {docente && <div style={{ fontSize: 11, color: col, opacity: 0.7, marginTop: 2, fontWeight: 500 }}>{docente.split(" ")[0]}</div>}
                        </div>
                      );
                    })}
                    {!byDay[day]?.length && <div style={{ fontSize: 12, color: "#D1D5DB", textAlign: "center", marginTop: 30, fontWeight: 500 }}>—</div>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
