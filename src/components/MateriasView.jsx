import React, { useState, useEffect, useMemo } from 'react';
import { S, DAYS, TRAYECTO_COLORS, TRAYECTO_BG } from '../constants';
import { getHoraDisplayDeRegistro, getHoraMin } from '../utils/time';
import { getTurnoDeRegistro } from '../utils/turno';
import { parseClase } from '../utils/parsing';
import Avatar from './Avatar';

export default function MateriasView({ byMateria, initialSel, onConsumeNav, getMateriaName, onSaveMateriaName, data, getDocName }) {
  const sorted = Object.keys(byMateria).sort();
  const [sel, setSel] = useState(initialSel || null), [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false), [editValue, setEditValue] = useState(""), [saving, setSaving] = useState(false);

  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel, onConsumeNav]);
  useEffect(() => { if (sel) { setEditValue(getMateriaName(sel)); setEditingName(false); } }, [sel, getMateriaName]);

  const selEntries = sel && byMateria[sel] ? byMateria[sel] : [];
  const filteredSorted = search ? sorted.filter(m => getMateriaName(m).toLowerCase().includes(search.toLowerCase())) : sorted;

  const saveEdit = async () => {
    const t = editValue.trim();
    if (t && sel) {
      setSaving(true);
      const res = await onSaveMateriaName(sel, t);
      setSaving(false);
      if (res.success) {
        setEditingName(false);
        if (res.targetRaw) setSel(res.targetRaw);
      }
    } else setEditingName(false);
  };

  const asignaciones = useMemo(() => {
    if (!selEntries.length) return [];
    return selEntries.slice().sort((a, b) => {
      const ia = DAYS.indexOf(a.dia), ib = DAYS.indexOf(b.dia);
      return (ia !== -1 ? ia : 9) - (ib !== -1 ? ib : 9) || getHoraMin(a) - getHoraMin(b);
    });
  }, [selEntries]);

  return (
    <div className="materias-layout" style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div className="materias-left-panel" style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar materia…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filteredSorted.length} materias</div>
          {filteredSorted.map(m => (
            <div key={m} onClick={() => { setSel(m); setEditingName(false); }}
              style={{
                padding: "10px 14px", cursor: "pointer", fontSize: 14,
                fontWeight: sel === m ? 600 : 400,
                background: sel === m ? "#EFF6FF" : "transparent",
                color: sel === m ? "#1D4ED8" : "#374151",
                borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center"
              }}
            >
              <span>{getMateriaName(m)}</span>
              <span style={{ fontSize: 12, background: "#F3F4F6", borderRadius: 10, padding: "2px 8px", color: "#6B7280", fontWeight: 600 }}>{byMateria[m].length}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!sel ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9CA3AF", fontSize: 15, fontWeight: 500 }}>Selecciona una materia para ver detalles</div> : (
          <>
            <div style={{ ...S.card, padding: "18px 22px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={getMateriaName(sel)} size={52} />
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus style={{ ...S.input, fontSize: 16, fontWeight: 600, flex: 1 }} />
                    <button onClick={saveEdit} disabled={saving} style={{ padding: "6px 14px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : "Guardar"}</button>
                    <button onClick={() => setEditingName(false)} style={{ padding: "6px 12px", background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "#111827" }}>{getMateriaName(sel)}</div>
                    <button onClick={() => { setEditValue(getMateriaName(sel)); setEditingName(true); }} title="Editar" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: "#6B7280", fontWeight: 500 }}>✏️ Editar</button>
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4, fontWeight: 500 }}>
                  {selEntries.length} clases asignadas
                  {selEntries.length > 0 && <span style={{ marginLeft: 10, background: "#EFF6FF", color: "#2563EB", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{new Set(selEntries.map(e => e.trayecto)).size} trayecto(s)</span>}
                </div>
              </div>
            </div>
            <div style={S.card}>
              <div style={{ padding: "14px 18px", borderBottom: "2px solid #E5E7EB", fontSize: 14, fontWeight: 700, color: "#374151" }}>📋 Asignaciones</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Día", "Hora", "Turno", "Sección", "Trayecto", "Docente"].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {asignaciones.map((e, i) => {
                      const tr = getTurnoDeRegistro(e);
                      const { docente: rd } = parseClase(e.clase);
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFB" }}>
                          <td style={{ ...S.td, fontWeight: 500 }}>{e.dia.charAt(0)+e.dia.slice(1).toLowerCase()}</td>
                          <td style={{ ...S.td, color: "#6B7280", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500 }}>{getHoraDisplayDeRegistro(e)}</td>
                          <td style={S.td}><span style={{ background: tr === "DIURNO" ? "#EFF6FF" : "#FDF2F8", color: tr === "DIURNO" ? "#2563EB" : "#DB2777", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{tr === "DIURNO" ? "☀️ Diurno" : "🌙 Vespertino"}</span></td>
                          <td style={{ ...S.td, fontWeight: 500, color: "#6B7280" }}>{e.sheet?.trim() || ""}</td>
                          <td style={S.td}><span style={{ background: TRAYECTO_BG[e.trayecto] || "#f3f4f6", color: TRAYECTO_COLORS[e.trayecto] || "#555", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{e.trayecto}</span></td>
                          <td style={{ ...S.td, fontWeight: 500 }}>{rd && getDocName ? getDocName(rd) : (rd || "—")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
