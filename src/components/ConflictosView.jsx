import React from 'react';
import { S, TRAYECTO_COLORS, TRAYECTO_BG } from '../constants';
import { getHoraDisplayDeRegistro } from '../utils/time';
import { parseClase } from '../utils/parsing';

export default function ConflictosView({ conflicts, onGoDocente, getDocName }) {
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>⚠️ Conflictos detectados</h1>
        <span style={{ background: conflicts.length > 0 ? "#FEF2F2" : "#F0FDF4", color: conflicts.length > 0 ? "#DC2626" : "#16A34A", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
          {conflicts.length}
        </span>
      </div>
      {!conflicts.length ? (
        <div style={{ ...S.card, padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 48 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#111827" }}>Sin conflictos</div>
          <div style={{ fontSize: 14, color: "#6B7280", marginTop: 6, fontWeight: 500 }}>No se detectaron solapamientos horarios.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {conflicts.map((c, i) => (
            <div key={i} style={{ ...S.card, borderLeft: "4px solid #EF4444", padding: "14px 18px" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <button onClick={() => onGoDocente(c.docente)} style={{ fontSize: 15, fontWeight: 700, color: "#DC2626", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                      {getDocName(c.docente)}
                    </button>
                    <span style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>— {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {getHoraDisplayDeRegistro(c.entries[0])}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {c.entries.map((e, j) => {
                      const { materia } = parseClase(e.clase);
                      const col = TRAYECTO_COLORS[e.trayecto] || "#555", bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5";
                      return (
                        <div key={j} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 500 }}>
                          <div style={{ fontWeight: 600, color: col }}>{materia}</div>
                          <div style={{ color: col, opacity: 0.7, fontSize: 11 }}>{e.sheet.trim()} · T.{e.trayecto}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
