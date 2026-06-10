import React, { useMemo } from 'react';
import { S, DAYS, TRAYECTO_BG, TRAYECTO_COLORS } from '../constants';
import { getTurnoDeRegistro, findStartBlock } from '../utils/turno';
import { countBlocks, getHoraDisplayDeRegistro } from '../utils/time';
import { parseClase } from '../utils/parsing';

export default function TurnoGrid({ bloques, turnoLabel, filtered, days, expandedCell, setExpandedCell, getDocName, getMateriaName }) {
  const cellMap = useMemo(() => {
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

  const ROW_H = 52;

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      <div style={{ padding: "10px 16px", background: turnoLabel === "DIURNO" ? "#EFF6FF" : "#FDF2F8", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{turnoLabel === "DIURNO" ? "☀️" : "🌙"}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: turnoLabel === "DIURNO" ? "#1D4ED8" : "#BE185D" }}>{turnoLabel === "DIURNO" ? "Turno Diurno" : "Turno Vespertino"}</span>
        <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>{turnoLabel === "DIURNO" ? "7:30 AM – 12:00 PM" : "1:00 PM – 5:30 PM"}</span>
      </div>
      <div className="turno-grid-wrapper" style={{ overflowX: "auto" }}>
        <table className="turno-grid-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 600 }}>
          <colgroup>
            <col style={{ width: 110 }} />
            {days.map(d => <col key={d} />)}
          </colgroup>
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              <th style={{ ...S.th, padding: "10px 12px", fontSize: 12, width: 110 }}>Hora</th>
              {days.map(d => <th key={d} style={{ ...S.th, padding: "10px 10px", fontSize: 13, borderLeft: "1px solid #E5E7EB", textAlign: "center" }}>{d.charAt(0) + d.slice(1).toLowerCase()}</th>)}
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
              const rowBg = bi % 2 === 0 ? "#fff" : "#FAFAFA";
              return (
                <tr key={bi} style={{ height: ROW_H }}>
                  <td style={{ padding: "6px 10px", fontSize: 12, fontWeight: 700, color: "#374151", background: rowBg, verticalAlign: "middle", whiteSpace: "nowrap", borderTop: "1px solid #E5E7EB", lineHeight: 1.4 }}>
                    <div>{bloque.inicio.replace(/(\d)(AM|PM)/gi, '$1 $2')}</div>
                    <div style={{ color: "#9CA3AF", fontWeight: 400, fontSize: 10 }}>{bloque.fin.replace(/(\d)(AM|PM)/gi, '$1 $2')}</div>
                  </td>
                  {cells.map((cell, ci) => {
                    const day = days[ci];
                    if (cell.skip) return null;
                    const cellKey = `${turnoLabel}__${bi}__${day}`, isExp = expandedCell === cellKey;
                    if (cell.empty) return <td key={day} style={{ padding: "4px", borderTop: "1px solid #E5E7EB", borderLeft: "1px solid #E5E7EB", background: rowBg }} />;
                    const { entries, span } = cell.data;
                    return (
                      <td key={day} rowSpan={span} style={{ padding: "4px", borderTop: "1px solid #E5E7EB", borderLeft: "1px solid #E5E7EB", verticalAlign: "top", height: span * ROW_H }}>
                        {entries.map((e, i) => {
                          const { materia: rawMateria, docente: rawDoc } = parseClase(e.clase);
                          const materia = getMateriaName(rawMateria), docente = getDocName(rawDoc);
                          const bg = TRAYECTO_BG[e.trayecto] || "#f0f0f0", col = TRAYECTO_COLORS[e.trayecto] || "#555";
                          return (
                            <div
                              key={i}
                              onClick={() => setExpandedCell(isExp ? null : cellKey)}
                              style={{
                                background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6,
                                padding: isExp ? "6px 8px" : "5px 8px", marginBottom: i < entries.length - 1 ? 3 : 0,
                                cursor: "pointer", transition: "all 0.15s",
                                boxShadow: isExp ? `0 0 0 2px ${col}55, 0 2px 8px rgba(0,0,0,0.08)` : "0 1px 2px rgba(0,0,0,0.04)",
                                height: !isExp && span > 0 ? `calc(${span * ROW_H - 10}px / ${entries.length})` : "auto",
                                minHeight: 38, display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden",
                              }}
                            >
                              <div style={{ fontSize: 13, fontWeight: 700, color: col, lineHeight: 1.3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{materia}</div>
                              {docente && <div style={{ fontSize: 12, fontWeight: 600, color: col, opacity: 0.85, lineHeight: 1.2, marginTop: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{docente}</div>}
                              {isExp && (
                                <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${col}30`, fontSize: 12, display: "flex", flexDirection: "column", gap: 3, fontWeight: 500 }}>
                                  <div>📂 {e.sheet.trim()} · T.{e.trayecto}</div>
                                  <div>⏰ {getHoraDisplayDeRegistro(e)}</div>
                                  <div>🏫 {e.aula || "Sin aula"}</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
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
