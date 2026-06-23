import React, { useState, useEffect, useMemo } from 'react';
import { S, DAYS, TRAYECTO_COLORS, TRAYECTO_BG } from '../constants';
import { getHoraDisplayDeRegistro, getHoraMin } from '../utils/time';
import { getTurnoDeRegistro } from '../utils/turno';
import { parseClase } from '../utils/parsing';
import Avatar from './Avatar';

export default function MateriasView({ byMateria, initialSel, onConsumeNav, getMateriaName, onSaveMateriaName, data, getDocName, modoConsulta, lapso }) {
  const sorted = Object.keys(byMateria).sort();
  const [sel, setSel] = useState(initialSel || null), [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false), [editValue, setEditValue] = useState(""), [saving, setSaving] = useState(false);

  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel, onConsumeNav]);
  // Solo actualizar editValue cuando cambia la selección, NO cuando cambia getMateriaName.
  // Misma razón que DocentesView: evitar condición de carrera al guardar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) { setEditValue(getMateriaName(sel)); setEditingName(false); } }, [sel]);

  const selEntries = sel && byMateria[sel] ? byMateria[sel] : [];
  const filteredSorted = search ? sorted.filter(m => getMateriaName(m).toLowerCase().includes(search.toLowerCase())) : sorted;

  const saveEdit = async () => {
    const t = editValue.trim();
    if (t && sel && onSaveMateriaName) {
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
    <div style={{ display: "flex", flexDirection: "column", flex: 1, height: 0, overflow: "hidden" }}>
      {modoConsulta && (
        <div style={{ background: "#FFFBEB", borderBottom: "1px solid #FDE68A", padding: "7px 20px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <i className="ti ti-archive" aria-hidden="true" style={{ color: "#92400E", fontSize: 14 }} />
          <span style={{ fontSize: 13, color: "#92400E", fontWeight: 600 }}>
            Modo consulta — trimestre {lapso} (solo lectura)
          </span>
        </div>
      )}
    <div className="materias-layout" style={{ padding: 20, display: "flex", gap: 16, flex: 1, height: 0, overflow: "hidden" }}>
      <div className="materias-left-panel" style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar materia…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>{filteredSorted.length} materias</div>
          {filteredSorted.map(m => (
            <div key={m} onClick={() => { setSel(m); setEditingName(false); }}
              style={{
                padding: "10px 14px", cursor: "pointer", fontSize: 14,
                fontWeight: sel === m ? 600 : 400,
                background: sel === m ? "#EFF6FF" : "transparent",
                color: sel === m ? "#1D4ED8" : "#334155",
                borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center"
              }}
            >
              <span>{getMateriaName(m)}</span>
              <span style={{ fontSize: 12, background: "#F1F5F9", borderRadius: 10, padding: "2px 8px", color: "#64748B", fontWeight: 600 }}>{byMateria[m].length}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!sel ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#94A3B8", fontSize: 15, fontWeight: 500 }}>Selecciona una materia para ver detalles</div> : (
          <>
            <div style={{ ...S.card, padding: "18px 22px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={getMateriaName(sel)} size={52} />
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus style={{ ...S.input, fontSize: 16, fontWeight: 600, flex: 1 }} />
                    <button onClick={saveEdit} disabled={saving} style={{ padding: "6px 14px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : "Guardar"}</button>
                    <button onClick={() => setEditingName(false)} style={{ padding: "6px 12px", background: "#F1F5F9", color: "#64748B", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "#0F172A" }}>{getMateriaName(sel)}</div>
                    {onSaveMateriaName && (
                      <button onClick={() => { setEditValue(getMateriaName(sel)); setEditingName(true); }} title="Editar" style={{ background: "none", border: "1px solid #E2E8F0", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: "#64748B", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}><i className="ti ti-pencil" aria-hidden="true" /> Editar</button>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#64748B", marginTop: 4, fontWeight: 500 }}>
                  {selEntries.length} clases asignadas
                  {selEntries.length > 0 && <span style={{ marginLeft: 10, background: "#EFF6FF", color: "#2563EB", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{new Set(selEntries.map(e => e.trayecto)).size} trayecto(s)</span>}
                </div>
              </div>
            </div>
            <div style={S.card}>
              <div style={{ padding: "14px 18px", borderBottom: "2px solid #E2E8F0", fontSize: 14, fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: 7 }}><i className="ti ti-list-details" aria-hidden="true" /> Asignaciones</div>
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
                          <td style={{ ...S.td, color: "#64748B", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500 }}>{getHoraDisplayDeRegistro(e)}</td>
                          <td style={S.td}><span style={{ background: tr === "DIURNO" ? "#EFF6FF" : "#FDF2F8", color: tr === "DIURNO" ? "#2563EB" : "#DB2777", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i className={`ti ${tr === "DIURNO" ? "ti-sun-high" : "ti-moon-stars"}`} aria-hidden="true" /> {tr === "DIURNO" ? "Diurno" : "Vespertino"}</span></span></td>
                          <td style={{ ...S.td, fontWeight: 500, color: "#64748B" }}>{e.sheet?.trim() || ""}</td>
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
    </div>
  );
}
