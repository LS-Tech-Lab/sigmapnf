import React, { useMemo } from 'react';
import { DAYS, trayectoClass } from '../constants';
import { getTurnoDeRegistro, findStartBlock } from '../utils/turno';
import { countBlocks, getHoraDisplayDeRegistro } from '../utils/time';
import { parseClase } from '../utils/parsing';
import './TurnoGrid.css';

export default function TurnoGrid({ bloques, turnoLabel, filtered, days, expandedCell, setExpandedCell, getDocName, getMateriaName }) {
  const cellMap = useMemo(() => {
    if (!days || !bloques || !filtered) return {};
    const map = {};
    days.forEach(day => {
      map[day] = {};
      const occupied = {};
      bloques.forEach((bloque, bi) => {
        if (occupied[bi]) { map[day][bi] = "skip"; return; }
        const entries = filtered.filter(d => d.dia === day && getTurnoDeRegistro(d) === turnoLabel && findStartBlock(bloques, d.hora) === bi);
        if (!entries.length) { map[day][bi] = null; return; }
        let span = 1;
        entries.forEach(e => { const s = countBlocks(e.hora); if (s > span) span = s; });
        span = Math.min(span, bloques.length - bi);
        map[day][bi] = { entries, span };
        for (let k = bi + 1; k < bi + span; k++) occupied[k] = true;
      });
    });
    return map;
  }, [bloques, days, filtered, turnoLabel]);

  if (!days || !bloques || !filtered) {
    return <div className="tg-loading">Cargando grilla...</div>;
  }

  const esVespertino = turnoLabel !== "DIURNO";

  return (
    <div className="s-card tg-card">
      <div className={`tg-header${esVespertino ? " tg-header--vespertino" : ""}`}>
        <i className={`ti ${turnoLabel === "DIURNO" ? "ti-sun-high" : "ti-moon-stars"} tg-header-icon`} aria-hidden="true" />
        <span className="tg-header-title">{turnoLabel === "DIURNO" ? "Turno Diurno" : "Turno Vespertino"}</span>
        <span className="tg-header-subtitle">{turnoLabel === "DIURNO" ? "7:30 AM – 12:00 PM" : "1:00 PM – 5:30 PM"}</span>
      </div>
      <div className="turno-grid-wrapper">
        <table className="turno-grid-table">
          <colgroup>
            <col className="tg-col-hora" />
            {days.map(d => <col key={d} />)}
          </colgroup>
          <thead>
            <tr className="tg-thead-row">
              <th className="s-th tg-th-hora">Hora</th>
              {days.map(d => <th key={d} className="s-th tg-th-day">{d.charAt(0) + d.slice(1).toLowerCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {bloques.map((bloque, bi) => {
              const cells = days.map(day => {
                const cell = cellMap[day]?.[bi];
                if (cell === "skip") return { skip: true };
                if (!cell) return { empty: true };
                return { data: cell };
              });
              return (
                <tr key={bi} className="tg-row">
                  <td className="tg-cell-hora">
                    <div>{bloque.inicio.replace(/(\d)(AM|PM)/gi, '$1 $2')}</div>
                    <div className="tg-cell-hora-fin">{bloque.fin.replace(/(\d)(AM|PM)/gi, '$1 $2')}</div>
                  </td>
                  {cells.map((cell, ci) => {
                    const day = days[ci];
                    if (cell.skip) return null;
                    const cellKey = `${turnoLabel}__${bi}__${day}`, isExp = expandedCell === cellKey;
                    if (cell.empty) return <td key={day} className="tg-cell-empty" />;
                    const { entries, span } = cell.data;
                    return (
                      <td key={day} rowSpan={span} className={`tg-cell-data tg-cell-data--span-${span}`}>
                        <div className="tg-cell-inner">
                        {entries.map((e, i) => {
                          const { materia: rawMateria, docente: docenteParseado } = parseClase(e.clase);
                          const rawDoc = e.docentes?.nombre_raw || docenteParseado;
                          const materia = getMateriaName(rawMateria), docente = getDocName(rawDoc);
                          const toggleExpand = () => setExpandedCell(isExp ? null : cellKey);
                          return (
                            <div
                              key={i}
                              role="button"
                              tabIndex={0}
                              aria-expanded={isExp}
                              aria-label={`${materia}${docente ? ` — ${docente}` : ""}. Presiona Enter para ${isExp ? "ocultar" : "ver"} detalles.`}
                              onClick={toggleExpand}
                              onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleExpand(); } }}
                              className={`tg-clase ${trayectoClass(e.trayecto)}${isExp ? " tg-clase--expanded" : ""}`}
                            >
                              <div className="tg-clase-materia">{materia}</div>
                              {docente && <div className="tg-clase-docente">{docente}</div>}
                              {isExp && (
                                <div className="tg-clase-detail">
                                  <div className="tg-clase-detail-row"><i className="ti ti-folder" aria-hidden="true" /> {e.sheet.trim()} · T.{e.trayecto}</div>
                                  <div className="tg-clase-detail-row"><i className="ti ti-clock" aria-hidden="true" /> {getHoraDisplayDeRegistro(e)}</div>
                                  <div className="tg-clase-detail-row"><i className="ti ti-door" aria-hidden="true" /> {e.aula || "Sin aula"}</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
