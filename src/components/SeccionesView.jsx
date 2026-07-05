import React, { useState, useMemo, useEffect } from 'react';
import { DAYS, TRAYECTO_COLORS, TRAYECTO_BG, ALL_TRAYECTOS } from '../constants';
import { getHoraDisplayDeRegistro, getHoraMin } from '../utils/time';
import { parseClase } from '../utils/parsing';
import './SeccionesView.css';

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
    <div className="secciones-layout sv-root">
      <div className="secciones-left-panel sv-left-panel">
        <select value={filterTray} onChange={e => setFilterTray(e.target.value)} className="s-select s-select--full">
          <option value="all">Todos los trayectos</option>
          {ALL_TRAYECTOS.map(t => <option key={t} value={t}>Trayecto {t}</option>)}
        </select>
        <div className="s-card sv-list-panel">
          <div className="sv-list-header">{filteredSecciones.length} secciones</div>
          {filteredSecciones.map(s => {
            const tray = getTrayectoIndicador(s);
            return (
              <div key={s} onClick={() => setSelSheet(s)}
                className={`sv-seccion-item${selSheet === s ? " sv-seccion-item--active" : ""}`}
              >
                <span className="sv-seccion-dot" style={{ "--dot-color": TRAYECTO_COLORS[tray] || "#ccc" }} />
                {s}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sv-right-panel">
        {info && (
          <>
            <div className="s-card sv-info-card">
              <div className="sv-info-header">
                <div>
                  <div className="sv-info-title">{selSheet}</div>
                  <div className="sv-info-subtitle">{programaSeccion}</div>
                </div>
                <span
                  className="sv-trayecto-badge"
                  style={{ "--badge-bg": TRAYECTO_BG[info.trayecto] || "#f3f4f6", "--badge-color": TRAYECTO_COLORS[info.trayecto] || "#555" }}
                >Trayecto {info.trayecto}</span>
              </div>
              <div className="sv-stats-row">
                {[
                  ["Turno", info.turno],
                  ["Sección", info.seccion],
                  ["Sede", info.sede],
                  info.aula && ["Aula", info.aula],
                  ["Total clases", entries.length]
                ].filter(Boolean).map(([l, v]) => (
                  <div key={l}>
                    <div className="sv-stat-label">{l}</div>
                    <div className="sv-stat-value">{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="s-card">
              <div className="sv-days-header">
                {DAYS.map(day => (
                  <div key={day} className="sv-day-header-cell">
                    {day.slice(0, 3)}
                  </div>
                ))}
              </div>
              <div className="sv-days-body">
                {DAYS.map(day => (
                  <div key={day} className="sv-day-col">
                    {(byDay[day] || []).map((e, i) => {
                      const { materia: rm, docente: docenteParseado } = parseClase(e.clase);
                      const rd = e.docentes?.nombre_raw || docenteParseado;
                      const materia = getMateriaName(rm), docente = getDocName(rd);
                      const col = TRAYECTO_COLORS[e.trayecto] || "#555", bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5";
                      return (
                        <div key={i} className="sv-clase-card" style={{ "--clase-bg": bg, "--clase-color": col }}>
                          <div className="sv-clase-materia">{materia.length > 24 ? materia.slice(0, 22) + "…" : materia}</div>
                          <div className="sv-clase-hora">{getHoraDisplayDeRegistro(e)}</div>
                          {docente && <div className="sv-clase-docente">{docente.split(" ")[0]}</div>}
                        </div>
                      );
                    })}
                    {!byDay[day]?.length && <div className="sv-day-empty">—</div>}
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
