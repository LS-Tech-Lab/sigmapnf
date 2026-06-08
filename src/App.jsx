import { useState, useMemo, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// ========== Configuración de Supabase ==========
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ========== Constantes globales ==========
const DAYS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];
const TRAYECTO_COLORS = {
  "1-1": "#2563EB", "1-2": "#059669",
  "2-1": "#DC2626", "2-2": "#DB2777",
  "3-1": "#D97706", "3-2": "#65A30D",
  "4-1": "#7C3AED", "4-2": "#4338CA",
};
const TRAYECTO_BG = {
  "1-1": "#EFF6FF", "1-2": "#ECFDF5",
  "2-1": "#FEF2F2", "2-2": "#FDF2F8",
  "3-1": "#FFFBEB", "3-2": "#F7FEE7",
  "4-1": "#F5F3FF", "4-2": "#EEF2FF",
};

function normalizeTurno(t) {
  if (!t) return t;
  const u = t.toUpperCase().trim();
  if (u === "MATUTINO") return "DIURNO";
  if (u === "VESPETINO") return "VESPERTINO";
  return u;
}

function parseClase(clase) {
  const parts = clase.trim().split(/\s+(?:Profes?\.?|Prof\.?)\s+/i);
  const materia = parts[0].trim();
  const docente = parts[1] ? parts[1].trim() : "";
  return { materia, docente };
}

function getUniqueHoras(data) {
  const h = [...new Set(data.map(d => d.hora))];
  const toMin = (s) => {
    const m = s.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return 0;
    let hh = parseInt(m[1]), mi = parseInt(m[2]);
    if (m[3].toUpperCase() === "PM" && hh !== 12) hh += 12;
    if (m[3].toUpperCase() === "AM" && hh === 12) hh = 0;
    return hh * 60 + mi;
  };
  return h.sort((a, b) => toMin(a) - toMin(b));
}

const S = {
  card: { background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", overflow: "hidden" },
  th: { padding: "9px 14px", fontSize: 11, fontWeight: 600, color: "#6B7280", textAlign: "left", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB", textTransform: "uppercase", letterSpacing: "0.05em" },
  td: { padding: "10px 14px", fontSize: 13, borderTop: "1px solid #F3F4F6" },
  badge: (bg, col) => ({ background: bg, color: col, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600 }),
  btn: (active) => ({
    padding: "6px 14px", borderRadius: 20, border: "1px solid",
    borderColor: active ? "#2563EB" : "#E5E7EB",
    background: active ? "#EFF6FF" : "#fff",
    color: active ? "#1D4ED8" : "#6B7280",
    cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 400,
    transition: "all 0.15s",
  }),
  select: { fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff", color: "#111827", cursor: "pointer" },
  input: { fontSize: 13, padding: "6px 12px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff", color: "#111827", outline: "none" },
};

// ========== Componentes auxiliares ==========
function Avatar({ name, size = 36 }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, background: `hsl(${hue},55%,90%)`, color: `hsl(${hue},55%,35%)`, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

function StatCard({ label, value, icon, color = "#2563EB" }) {
  return (
    <div style={{ ...S.card, padding: "20px", display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{icon}</div>
      <div><div style={{ fontSize: 28, fontWeight: 700, color: "#111827", lineHeight: 1 }}>{value}</div><div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4, fontWeight: 500 }}>{label}</div></div>
    </div>
  );
}

function GlobalSearch({ onNavigate, docenteNames, data }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef();

  const results = useMemo(() => {
    if (q.length < 2) return [];
    const lo = q.toLowerCase();
    const seen = new Set();
    const out = [];
    data.forEach(d => {
      const { materia, docente: rawDocente } = parseClase(d.clase);
      const docente = docenteNames[rawDocente] || rawDocente;
      const key = `${materia}__${rawDocente}`;
      if (!seen.has(key) && (materia.toLowerCase().includes(lo) || docente.toLowerCase().includes(lo))) {
        seen.add(key);
        out.push({ type: rawDocente ? "clase" : "materia", materia, docente, trayecto: d.trayecto, sheet: d.sheet.trim() });
      }
    });
    return out.slice(0, 8);
  }, [q, docenteNames, data]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", width: 280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 12px" }}>
        <span style={{ fontSize: 16, color: "#9CA3AF" }}>🔍</span>
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Buscar materia, docente…" style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, color: "#111827", width: "100%" }} />
        {q && <button onClick={() => setQ("")} style={{ border: "none", background: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16, padding: 0 }}>×</button>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", zIndex: 200, overflow: "hidden" }}>
          {results.map((r, i) => (
            <div key={i} onClick={() => { onNavigate(r); setOpen(false); setQ(""); }} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderTop: i > 0 ? "1px solid #F3F4F6" : "none" }} onMouseEnter={e => e.currentTarget.style.background = "#F9FAFB"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={S.badge(TRAYECTO_BG[r.trayecto] || "#f3f4f6", TRAYECTO_COLORS[r.trayecto] || "#555")}>{r.trayecto}</span>
              <div><div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{r.materia}</div>{r.docente && <div style={{ fontSize: 11, color: "#9CA3AF" }}>{r.docente}</div>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== Vistas principales (adaptadas para recibir data como prop) ==========
function HorariosView({ filtered, gridData, selectedTrayecto, setSelectedTrayecto, selectedSeccion, setSelectedSeccion, selectedTurno, setSelectedTurno, activeDay, setActiveDay, seccionesByTrayecto, expandedCell, setExpandedCell, getDocName, allTrayectos, allTurnos }) {
  const days = activeDay === "all" ? DAYS : [activeDay];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #E5E7EB", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#111827", marginRight: 4 }}>📅 Horarios</h1>
        <select value={selectedTrayecto} onChange={e => { setSelectedTrayecto(e.target.value); setSelectedSeccion("all"); }} style={S.select}>
          <option value="all">Todos los trayectos</option>
          {allTrayectos.map(t => <option key={t} value={t}>Trayecto {t}</option>)}
        </select>
        <select value={selectedSeccion} onChange={e => setSelectedSeccion(e.target.value)} style={S.select}>
          <option value="all">Todas las secciones</option>
          {seccionesByTrayecto.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={selectedTurno} onChange={e => setSelectedTurno(e.target.value)} style={S.select}>
          <option value="all">Todos los turnos</option>
          {allTurnos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 13, color: "#9CA3AF", marginLeft: "auto" }}>{filtered.length} clases</span>
      </div>
      <div style={{ padding: "10px 20px", background: "#fff", borderBottom: "1px solid #F3F4F6", display: "flex", gap: 6 }}>
        {["all", ...DAYS].map(d => (<button key={d} onClick={() => setActiveDay(d)} style={S.btn(activeDay === d)}>{d === "all" ? "Semana completa" : d.charAt(0) + d.slice(1).toLowerCase()}</button>))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        <div style={S.card}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead><tr><th style={{ ...S.th, width: 130 }}>Hora</th>{days.map(d => (<th key={d} style={{ ...S.th, borderLeft: "1px solid #E5E7EB" }}>{d.charAt(0) + d.slice(1).toLowerCase()}</th>))}</tr></thead>
            <tbody>
              {getUniqueHoras(filtered).map((hora, ri) => (
                <tr key={hora}>
                  <td style={{ ...S.td, fontSize: 11, fontWeight: 600, color: "#9CA3AF", whiteSpace: "nowrap", background: ri % 2 === 0 ? "#fff" : "#FAFAFA" }}>{hora}</td>
                  {days.map(day => {
                    const entries = gridData[`${hora}__${day}`] || [];
                    const cellKey = `${hora}__${day}`;
                    const isExp = expandedCell === cellKey;
                    return (
                      <td key={day} style={{ padding: "4px 6px", borderTop: "1px solid #F3F4F6", borderLeft: "1px solid #F3F4F6", verticalAlign: "top", background: ri % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        {entries.map((e, i) => {
                          const { materia, docente: rawDoc } = parseClase(e.clase);
                          const docente = getDocName(rawDoc);
                          const bg = TRAYECTO_BG[e.trayecto] || "#f0f0f0";
                          const col = TRAYECTO_COLORS[e.trayecto] || "#555";
                          return (
                            <div key={i} onClick={() => setExpandedCell(isExp ? null : cellKey)} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "5px 8px", marginBottom: i < entries.length - 1 ? 3 : 0, cursor: "pointer", transition: "box-shadow 0.15s", boxShadow: isExp ? `0 0 0 1.5px ${col}40` : "none" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: col, lineHeight: 1.3 }}>{materia.length > 28 ? materia.slice(0, 26) + "…" : materia}</div>
                              {docente && <div style={{ fontSize: 11, color: col, opacity: 0.7, marginTop: 1 }}>{docente}</div>}
                              {isExp && (<div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${col}25`, fontSize: 11 }}><div style={{ color: col, opacity: 0.85 }}>📂 {e.sheet.trim()}</div><div style={{ color: col, opacity: 0.85 }}>🏫 {e.aula || "Sin aula"}</div><div style={{ color: col, opacity: 0.85 }}>⏰ {e.turno}</div></div>)}
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SeccionesView({ data, getDocName }) {
  const allSecciones = useMemo(() => [...new Set(data.map(d => d.sheet.trim()))].sort(), [data]);
  const [selSheet, setSelSheet] = useState(allSecciones[0]);
  const [filterTray, setFilterTray] = useState("all");
  const entries = data.filter(d => d.sheet.trim() === selSheet);
  const info = entries[0];

  const filteredSecciones = filterTray === "all" ? allSecciones : allSecciones.filter(s => data.find(d => d.sheet.trim() === s)?.trayecto === filterTray);

  const byDay = DAYS.reduce((acc, day) => {
    acc[day] = entries.filter(e => e.dia === day).sort((a, b) => {
      const toM = s => { const m = s.match(/(\d+):(\d+)\s*(AM|PM)/i); if (!m) return 0; let h = +m[1], mi = +m[2]; if (m[3].toUpperCase() === "PM" && h !== 12) h += 12; if (m[3].toUpperCase() === "AM" && h === 12) h = 0; return h * 60 + mi; };
      return toM(a.hora) - toM(b.hora);
    });
    return acc;
  }, {});

  return (
    <div style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <select value={filterTray} onChange={e => setFilterTray(e.target.value)} style={{ ...S.select, width: "100%" }}>
          <option value="all">Todos los trayectos</option>
          {ALL_TRAYECTOS.map(t => <option key={t} value={t}>Trayecto {t}</option>)}
        </select>
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filteredSecciones.length} secciones</div>
          {filteredSecciones.map(s => {
            const tray = data.find(d => d.sheet.trim() === s)?.trayecto;
            return (
              <div key={s} onClick={() => setSelSheet(s)} style={{ padding: "9px 14px", cursor: "pointer", fontSize: 13, background: selSheet === s ? "#EFF6FF" : "transparent", color: selSheet === s ? "#1D4ED8" : "#374151", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 8, fontWeight: selSheet === s ? 600 : 400 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: TRAYECTO_COLORS[tray] || "#ccc", flexShrink: 0 }} />{s}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {info && (
          <>
            <div style={{ ...S.card, padding: "16px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}><div><div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{selSheet}</div><div style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>{info.programa}</div></div><span style={S.badge(TRAYECTO_BG[info.trayecto] || "#f3f4f6", TRAYECTO_COLORS[info.trayecto] || "#555")}>Trayecto {info.trayecto}</span></div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>{[["Turno", info.turno], ["Sección", info.seccion], ["Sede", info.sede], info.aula && ["Aula", info.aula], ["Total clases", entries.length]].filter(Boolean).map(([label, value]) => (<div key={label}><div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>{label}</div><div style={{ fontSize: 13, fontWeight: 600, color: "#111827", marginTop: 2 }}>{value}</div></div>))}</div>
            </div>
            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderBottom: "1px solid #E5E7EB" }}>{DAYS.map(day => (<div key={day} style={{ padding: "10px 12px", borderRight: "1px solid #E5E7EB", fontWeight: 600, fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em", background: "#F9FAFB" }}>{day.slice(0, 3)}</div>))}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)" }}>{DAYS.map(day => (<div key={day} style={{ padding: "10px 10px", borderRight: "1px solid #F3F4F6", minHeight: 120, verticalAlign: "top" }}>{(byDay[day] || []).map((e, i) => { const { materia, docente: rawDoc } = parseClase(e.clase); const docente = getDocName(rawDoc); const col = TRAYECTO_COLORS[e.trayecto] || "#555"; const bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5"; return (<div key={i} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 5, padding: "5px 8px", marginBottom: 5 }}><div style={{ fontSize: 11, fontWeight: 600, color: col, lineHeight: 1.3 }}>{materia.length > 22 ? materia.slice(0, 20) + "…" : materia}</div><div style={{ fontSize: 10, color: col, opacity: 0.7, marginTop: 2 }}>{e.hora.split(" ")[0]}</div>{docente && <div style={{ fontSize: 10, color: col, opacity: 0.65, marginTop: 1 }}>{docente.split(" ")[0]}</div>}</div>); })}{byDay[day].length === 0 && (<div style={{ fontSize: 11, color: "#D1D5DB", textAlign: "center", marginTop: 20 }}>—</div>)}</div>))}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DocentesView({ byDocente, conflicts, initialSel, onConsumeNav, docenteNames, setDocenteNames, getDocName, data }) {
  const sorted = Object.keys(byDocente).sort();
  const [sel, setSel] = useState(initialSel || null);
  const [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editValue, setEditValue] = useState("");
  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel]);
  useEffect(() => { if (sel) setEditValue(getDocName(sel)); }, [sel, getDocName]);

  const hasConflict = (name) => conflicts.some(c => c.docente === name);
  const selEntries = sel ? byDocente[sel] : [];
  const selConflicts = sel ? conflicts.filter(c => c.docente === sel) : [];

  const filteredSorted = search ? sorted.filter(d => getDocName(d).toLowerCase().includes(search.toLowerCase())) : sorted;

  const docGrid = useMemo(() => {
    const map = {};
    selEntries.forEach(e => { const key = `${e.hora}__${e.dia}`; if (!map[key]) map[key] = []; map[key].push(e); });
    return map;
  }, [selEntries]);

  const usedHoras = getUniqueHoras(selEntries);
  const saveEdit = () => { const trimmed = editValue.trim(); if (trimmed && sel) setDocenteNames(prev => ({ ...prev, [sel]: trimmed })); setEditingName(false); };

  return (
    <div style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar docente…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}><div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filteredSorted.length} docentes</div>{filteredSorted.map(d => (<div key={d} onClick={() => { setSel(d); setEditingName(false); }} style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, background: sel === d ? "#EFF6FF" : "transparent", color: sel === d ? "#1D4ED8" : "#374151", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: sel === d ? 600 : 400 }}><span style={{ display: "flex", alignItems: "center", gap: 6 }}>{hasConflict(d) && <span title="Tiene conflictos" style={{ fontSize: 14 }}>⚠️</span>}{getDocName(d)}</span><span style={{ fontSize: 11, background: "#F3F4F6", borderRadius: 10, padding: "1px 7px", color: "#6B7280", fontWeight: 600 }}>{byDocente[d].length}</span></div>))}</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>{!sel ? (<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9CA3AF", fontSize: 14 }}>Selecciona un docente para ver su horario</div>) : (<><div style={{ ...S.card, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}><Avatar name={getDocName(sel)} size={48} /><div style={{ flex: 1 }}>{editingName ? (<div style={{ display: "flex", alignItems: "center", gap: 8 }}><input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus style={{ ...S.input, fontSize: 15, fontWeight: 600, flex: 1 }} /><button onClick={saveEdit} style={{ padding: "5px 12px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Guardar</button><button onClick={() => setEditingName(false)} style={{ padding: "5px 10px", background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Cancelar</button></div>) : (<div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>{getDocName(sel)}</div><button onClick={() => { setEditValue(getDocName(sel)); setEditingName(true); }} title="Editar nombre" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4 }}>✏️ Editar</button></div>)}<div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>{selEntries.length} clases asignadas{selConflicts.length > 0 && (<span style={{ marginLeft: 10, ...S.badge("#FEF2F2", "#DC2626") }}>⚠️ {selConflicts.length} conflicto{selConflicts.length > 1 ? "s" : ""}</span>)}</div></div><div style={{ display: "flex", gap: 8 }}>{[...new Set(selEntries.map(e => e.trayecto))].map(t => (<span key={t} style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>T.{t}</span>))}</div></div>{selConflicts.map((c, i) => (<div key={i} style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 16px", marginBottom: 10, display: "flex", gap: 10, alignItems: "flex-start" }}><span style={{ fontSize: 18 }}>⚠️</span><div><div style={{ fontSize: 13, fontWeight: 600, color: "#991B1B" }}>Conflicto: {c.dia.charAt(0) + c.dia.slice(1).toLowerCase()} · {c.hora}</div><div style={{ fontSize: 12, color: "#B91C1C", marginTop: 4 }}>{c.entries.map(e => parseClase(e.clase).materia).join(" · ")}</div></div></div>))}{usedHoras.length > 0 && (<div style={{ ...S.card, marginBottom: 16 }}><div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E7EB", fontSize: 13, fontWeight: 600, color: "#374151" }}>Vista semanal</div><div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", minWidth: "100%" }}><thead><tr><th style={{ ...S.th, width: 120 }}>Hora</th>{DAYS.map(d => <th key={d} style={{ ...S.th, borderLeft: "1px solid #E5E7EB" }}>{d.slice(0, 3)}</th>)}</tr></thead><tbody>{usedHoras.map((hora, ri) => (<tr key={hora}><td style={{ ...S.td, fontSize: 11, color: "#9CA3AF", fontWeight: 600, background: ri % 2 === 0 ? "#fff" : "#FAFAFA" }}>{hora}</td>{DAYS.map(day => { const es = docGrid[`${hora}__${day}`] || []; return (<td key={day} style={{ padding: "4px 6px", borderTop: "1px solid #F3F4F6", borderLeft: "1px solid #F3F4F6", background: ri % 2 === 0 ? "#fff" : "#FAFAFA", verticalAlign: "top" }}>{es.map((e, i) => { const { materia } = parseClase(e.clase); const col = TRAYECTO_COLORS[e.trayecto] || "#555"; const bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5"; return (<div key={i} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 5, padding: "4px 7px" }}><div style={{ fontSize: 11, fontWeight: 600, color: col }}>{materia.length > 18 ? materia.slice(0, 16) + "…" : materia}</div><div style={{ fontSize: 10, color: col, opacity: 0.7 }}>{e.sheet.trim()}</div></div>); })}</td>); })}</tr>))}</tbody></table></div></div>)}<div style={S.card}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Día", "Hora", "Materia", "Trayecto", "Sección"].map(h => (<th key={h} style={S.th}>{h}</th>))}</tr></thead><tbody>{selEntries.sort((a, b) => DAYS.indexOf(a.dia) - DAYS.indexOf(b.dia)).map((e, i) => { const { materia } = parseClase(e.clase); return (<tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}><td style={S.td}>{e.dia.charAt(0) + e.dia.slice(1).toLowerCase()}</td><td style={{ ...S.td, color: "#9CA3AF", whiteSpace: "nowrap" }}>{e.hora}</td><td style={{ ...S.td, fontWeight: 500 }}>{materia}</td><td style={S.td}><span style={S.badge(TRAYECTO_BG[e.trayecto] || "#f3f4f6", TRAYECTO_COLORS[e.trayecto] || "#555")}>{e.trayecto}</span></td><td style={{ ...S.td, color: "#6B7280" }}>{e.sheet.trim()}</td></tr>); })}</tbody></table></div></>)}</div>
    </div>
  );
}

function MateriasView({ data, getDocName }) {
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState(null);

  const byMateria = useMemo(() => {
    const map = {};
    data.forEach(d => {
      const { materia, docente } = parseClase(d.clase);
      if (!map[materia]) map[materia] = [];
      map[materia].push({ ...d, docente });
    });
    return map;
  }, [data]);

  const sorted = Object.keys(byMateria).sort();
  const filtered = search ? sorted.filter(m => m.toLowerCase().includes(search.toLowerCase())) : sorted;
  const selEntries = sel ? byMateria[sel] : [];
  const docentesForMateria = sel ? [...new Set(selEntries.map(e => e.docente).filter(Boolean))] : [];
  const seccionesForMateria = sel ? [...new Set(selEntries.map(e => e.sheet.trim()))] : [];

  useEffect(() => { if (filtered.length > 0 && !sel) setSel(filtered[0]); }, [filtered, sel]);

  return (
    <div style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar materia…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}><div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filtered.length} materias</div>{filtered.map(m => (<div key={m} onClick={() => setSel(m)} style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, background: sel === m ? "#EFF6FF" : "transparent", color: sel === m ? "#1D4ED8" : "#374151", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: sel === m ? 600 : 400 }}><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m}</span><span style={{ fontSize: 11, background: "#F3F4F6", borderRadius: 10, padding: "1px 7px", color: "#6B7280", fontWeight: 600, marginLeft: 6, flexShrink: 0 }}>{byMateria[m].length}</span></div>))}</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>{!sel ? (<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9CA3AF", fontSize: 14 }}>Selecciona una materia para ver detalles</div>) : (<><div style={{ ...S.card, padding: "16px 20px", marginBottom: 16 }}><div style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 10 }}>{sel}</div><div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}><div><div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Total clases</div><div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{selEntries.length}</div></div><div><div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Docentes</div><div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{docentesForMateria.length}</div></div><div><div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Secciones</div><div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{seccionesForMateria.length}</div></div><div><div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Trayectos</div><div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>{[...new Set(selEntries.map(e => e.trayecto))].sort().map(t => (<span key={t} style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>T.{t}</span>))}</div></div></div></div>{docentesForMateria.length > 0 && (<div style={{ ...S.card, marginBottom: 16 }}><div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E7EB", fontSize: 13, fontWeight: 600, color: "#374151" }}>👥 Docentes que imparten esta materia</div><div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap" }}>{docentesForMateria.map(d => (<div key={d} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 12px" }}><Avatar name={getDocName(d)} size={28} /><span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{getDocName(d)}</span></div>))}</div></div>)}<div style={S.card}><div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E7EB", fontSize: 13, fontWeight: 600, color: "#374151" }}>Todas las asignaciones</div><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Día", "Hora", "Turno", "Docente", "Trayecto", "Sección"].map(h => (<th key={h} style={S.th}>{h}</th>))}</tr></thead><tbody>{selEntries.sort((a, b) => { const di = DAYS.indexOf(a.dia) - DAYS.indexOf(b.dia); return di !== 0 ? di : a.hora.localeCompare(b.hora); }).map((e, i) => (<tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}><td style={S.td}>{e.dia.charAt(0) + e.dia.slice(1).toLowerCase()}</td><td style={{ ...S.td, color: "#9CA3AF", whiteSpace: "nowrap" }}>{e.hora}</td><td style={S.td}><span style={S.badge(e.turno === "DIURNO" ? "#EFF6FF" : "#FDF2F8", e.turno === "DIURNO" ? "#2563EB" : "#DB2777")}>{e.turno}</span></td><td style={{ ...S.td, fontWeight: 500 }}>{getDocName(e.docente) || "—"}</td><td style={S.td}><span style={S.badge(TRAYECTO_BG[e.trayecto] || "#f3f4f6", TRAYECTO_COLORS[e.trayecto] || "#555")}>{e.trayecto}</span></td><td style={{ ...S.td, color: "#6B7280" }}>{e.sheet.trim()}</td></tr>))}</tbody></table></div></>)}</div>
    </div>
  );
}

function AsistenciasView({ data, getDocName }) {
  const [turno, setTurno] = useState("DIURNO");
  const [selectedDay, setSelectedDay] = useState(DAYS[0]);
  const printRef = useRef();

  const docentesDelDia = useMemo(() => {
    const map = {};
    data.filter(d => d.turno === turno && d.dia === selectedDay).forEach(d => {
      const { docente, materia } = parseClase(d.clase);
      if (!docente) return;
      if (!map[docente]) map[docente] = { clases: [] };
      map[docente].clases.push({ materia, hora: d.hora, seccion: d.sheet.trim(), trayecto: d.trayecto, aula: d.aula });
    });
    return Object.entries(map).sort((a, b) => getDocName(a[0]).localeCompare(getDocName(b[0])));
  }, [data, turno, selectedDay]);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    win.document.write(`
      <html><head><title>Asistencia Docentes - ${turno} - ${selectedDay}</title>
      <style>*{margin:0;padding:0;box-sizing:border-box;} body{font-family:Arial,sans-serif;font-size:11px;color:#000;} .page{padding:20px;} h1{font-size:15px;margin-bottom:4px;} .subtitle{font-size:11px;color:#555;margin-bottom:16px;} table{width:100%;border-collapse:collapse;margin-bottom:20px;} th{background:#f0f0f0;border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;} td{border:1px solid #ccc;padding:6px 8px;font-size:11px;vertical-align:top;} .docente-name{font-weight:bold;font-size:12px;} .firma-box{width:120px;height:40px;border:1px solid #999;}</style>
      </head><body><div class="page"><h1>Control de Asistencia Docentes</h1><div class="subtitle">PNF en Informática · Cabimas - Sede Los Laureles · ${selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: ${turno.charAt(0)+turno.slice(1).toLowerCase()} · 2-2026</div>
      <table><thead><tr><th style="width:30px">N°</th><th style="width:180px">Docente</th><th>Materia(s) / Sección(es)</th><th style="width:90px">Hora</th><th style="width:80px">Entrada</th><th style="width:80px">Salida</th><th style="width:120px">Firma</th></tr></thead><tbody>
      ${docentesDelDia.map(([rawDoc, info], idx) => { const displayName = getDocName(rawDoc); return `<tr><td>${idx+1}</td><td class="docente-name">${displayName}</td><td>${info.clases.map(c=>`${c.materia} — ${c.seccion}`).join("<br>")}</td><td>${info.clases.map(c=>c.hora).join("<br>")}</td><td></td><td></td><td><div class="firma-box"></div></td></tr>`; }).join("")}
      </tbody></table><div style="margin-top:30px; display:flex; justify-content:space-between;"><div style="text-align:center; width:200px;"><div style="border-top:1px solid #000; margin-top:40px; padding-top:4px; font-size:10px;">Coordinador(a) Académico</div></div><div style="text-align:center; width:200px;"><div style="border-top:1px solid #000; margin-top:40px; padding-top:4px; font-size:10px;">Secretaría</div></div></div></div></body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}><h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>🖨️ Asistencias Diarias por Turno</h1></div>
      <div style={{ ...S.card, padding: "14px 20px", marginBottom: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase" }}>Turno</div><div style={{ display: "flex", gap: 6 }}>{["DIURNO", "VESPERTINO"].map(t => (<button key={t} onClick={() => setTurno(t)} style={{ ...S.btn(turno === t), borderRadius: 8 }}>{t === "DIURNO" ? "☀️ Diurno" : "🌙 Vespertino"}</button>))}</div></div>
        <div><div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase" }}>Día</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{DAYS.map(d => (<button key={d} onClick={() => setSelectedDay(d)} style={S.btn(selectedDay === d)}>{d.charAt(0) + d.slice(1).toLowerCase()}</button>))}</div></div>
        <div style={{ marginLeft: "auto" }}><button onClick={handlePrint} style={{ padding: "8px 18px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>🖨️ Imprimir / PDF</button></div>
      </div>
      <div ref={printRef} style={S.card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}><div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Control de Asistencia Docentes</div><div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>PNF en Informática · Cabimas - Sede Los Laureles · {selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: {turno.charAt(0)+turno.slice(1).toLowerCase()} · 2-2026</div></div>
        {docentesDelDia.length === 0 ? (<div style={{ padding: "40px 20px", textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>No hay docentes registrados para {turno.toLowerCase()} el {selectedDay.toLowerCase()}.</div>) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={{ ...S.th, width: 36 }}>N°</th><th style={{ ...S.th, width: 200 }}>Docente</th><th style={S.th}>Materia(s) / Sección(es)</th><th style={{ ...S.th, width: 120 }}>Hora</th><th style={{ ...S.th, width: 80 }}>Entrada</th><th style={{ ...S.th, width: 80 }}>Salida</th><th style={{ ...S.th, width: 120 }}>Firma</th></tr></thead><tbody>{docentesDelDia.map(([rawDoc, info], idx) => { const displayName = getDocName(rawDoc); return (<tr key={rawDoc} style={{ background: idx % 2 === 0 ? "#fff" : "#FAFAFA" }}><td style={{ ...S.td, textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>{idx + 1}</td><td style={S.td}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={displayName} size={28} /><span style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>{displayName}</span></div></td><td style={{ ...S.td, fontSize: 12 }}>{info.clases.map((c, i) => (<div key={i} style={{ marginBottom: i < info.clases.length - 1 ? 4 : 0 }}><span style={{ fontWeight: 500 }}>{c.materia}</span><span style={{ color: "#9CA3AF", marginLeft: 6 }}>— {c.seccion}</span>{c.trayecto && (<span style={{ ...S.badge(TRAYECTO_BG[c.trayecto] || "#f3f4f6", TRAYECTO_COLORS[c.trayecto] || "#555"), marginLeft: 6 }}>T.{c.trayecto}</span>)}</div>))}</td><td style={{ ...S.td, fontSize: 12, color: "#6B7280" }}>{info.clases.map((c, i) => (<div key={i} style={{ marginBottom: i < info.clases.length - 1 ? 4 : 0 }}>{c.hora}</div>))}</td><td style={{ ...S.td, border: "1px solid #E5E7EB" }}></td><td style={{ ...S.td, border: "1px solid #E5E7EB" }}></td><td style={{ ...S.td, border: "1px solid #E5E7EB", height: 44 }}></td></tr>); })}</tbody></table>
        )}
        {docentesDelDia.length > 0 && (<div style={{ padding: "16px 20px", borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between" }}><div style={{ fontSize: 12, color: "#9CA3AF" }}>Total docentes: <strong style={{ color: "#111827" }}>{docentesDelDia.length}</strong></div><div style={{ fontSize: 12, color: "#9CA3AF" }}>Total clases: <strong style={{ color: "#111827" }}>{docentesDelDia.reduce((a, [, v]) => a + v.clases.length, 0)}</strong></div></div>)}
      </div>
    </div>
  );
}

function ConflictosView({ conflicts, onGoDocente, getDocName }) {
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}><h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>⚠️ Conflictos detectados</h1><span style={S.badge(conflicts.length > 0 ? "#FEF2F2" : "#F0FDF4", conflicts.length > 0 ? "#DC2626" : "#16A34A")}>{conflicts.length} {conflicts.length === 1 ? "conflicto" : "conflictos"}</span></div>
      {conflicts.length === 0 ? (<div style={{ ...S.card, padding: "60px 20px", textAlign: "center" }}><div style={{ fontSize: 48, marginBottom: 12 }}>✅</div><div style={{ fontSize: 17, fontWeight: 600, color: "#111827" }}>Sin conflictos</div><div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 6 }}>No se detectaron solapamientos horarios.</div></div>) : (<><div style={{ ...S.card, padding: "14px 18px", marginBottom: 20, background: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", gap: 10, alignItems: "flex-start" }}><span style={{ fontSize: 20 }}>💡</span><div style={{ fontSize: 13, color: "#92400E" }}><strong>Nota:</strong> Un conflicto ocurre cuando el mismo docente aparece asignado a dos grupos distintos en el mismo día y horario.</div></div><div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{conflicts.map((c, i) => (<div key={i} style={{ ...S.card, borderLeft: "4px solid #EF4444", padding: "14px 18px" }}><div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}><span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span><div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><button onClick={() => onGoDocente(c.docente)} style={{ fontSize: 14, fontWeight: 700, color: "#DC2626", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>{getDocName(c.docente)}</button><span style={{ fontSize: 13, color: "#6B7280" }}>— {c.dia.charAt(0) + c.dia.slice(1).toLowerCase()} · {c.hora}</span></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{c.entries.map((e, j) => { const { materia } = parseClase(e.clase); const col = TRAYECTO_COLORS[e.trayecto] || "#555"; const bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5"; return (<div key={j} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "6px 12px", fontSize: 12 }}><div style={{ fontWeight: 600, color: col }}>{materia}</div><div style={{ color: col, opacity: 0.7, fontSize: 11 }}>{e.sheet.trim()} · T.{e.trayecto}</div></div>); })}</div></div></div></div>))}</div></>)}
    </div>
  );
}

function EstadisticasView({ stats, byDocente, data }) {
  const trayectoCount = {};
  data.forEach(d => { trayectoCount[d.trayecto] = (trayectoCount[d.trayecto] || 0) + 1; });
  const dayCount = {};
  DAYS.forEach(d => { dayCount[d] = data.filter(r => r.dia === d).length; });
  const maxDay = Math.max(...Object.values(dayCount));
  const top8 = Object.entries(byDocente).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const maxLoad = Math.max(...top8.map(([, e]) => e.length));
  const materiaCount = {};
  data.forEach(d => { const { materia } = parseClase(d.clase); materiaCount[materia] = (materiaCount[materia] || 0) + 1; });
  const topMaterias = Object.entries(materiaCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxMat = topMaterias[0]?.[1] || 1;
  const turnoCount = {};
  data.forEach(d => { turnoCount[d.turno] = (turnoCount[d.turno] || 0) + 1; });
  const totalClases = data.length;
  const seccionesCount = new Set(data.map(d => d.sheet.trim())).size;

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 700 }}>📊 Estadísticas</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}><StatCard label="Total de clases" value={totalClases} icon="📅" color="#2563EB" /><StatCard label="Secciones" value={seccionesCount} icon="🏫" color="#059669" /><StatCard label="Docentes" value={stats.docentes} icon="👥" color="#7C3AED" /><StatCard label="Materias únicas" value={stats.materias} icon="📖" color="#D97706" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Clases por trayecto</div>{Object.entries(trayectoCount).sort().map(([t, c]) => (<div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>{t}</span><div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}><div style={{ width: `${(c / totalClases) * 100}%`, height: "100%", background: TRAYECTO_COLORS[t] || "#888", borderRadius: 4 }} /></div><span style={{ fontSize: 12, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{c}</span></div>))}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Distribución por día</div>{DAYS.map(d => (<div key={d} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={{ fontSize: 12, width: 80, color: "#6B7280", fontWeight: 500 }}>{d.charAt(0) + d.slice(1).toLowerCase()}</span><div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}><div style={{ width: `${(dayCount[d] / maxDay) * 100}%`, height: "100%", background: "#059669", borderRadius: 4 }} /></div><span style={{ fontSize: 12, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{dayCount[d]}</span></div>))}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Docentes con mayor carga</div>{top8.map(([doc, entries], idx) => (<div key={doc} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={{ fontSize: 11, fontWeight: 700, color: "#D1D5DB", width: 16 }}>{idx + 1}</span><span style={{ fontSize: 12, flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc}</span><div style={{ width: 100, background: "#F3F4F6", borderRadius: 4, height: 10, overflow: "hidden" }}><div style={{ width: `${(entries.length / maxLoad) * 100}%`, height: "100%", background: "#7C3AED", borderRadius: 4 }} /></div><span style={{ fontSize: 12, width: 24, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{entries.length}</span></div>))}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Materias más frecuentes</div>{topMaterias.map(([mat, cnt], idx) => (<div key={mat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={{ fontSize: 11, fontWeight: 700, color: "#D1D5DB", width: 16 }}>{idx + 1}</span><span style={{ fontSize: 12, flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={mat}>{mat.length > 28 ? mat.slice(0, 26) + "…" : mat}</span><div style={{ width: 100, background: "#F3F4F6", borderRadius: 4, height: 10, overflow: "hidden" }}><div style={{ width: `${(cnt / maxMat) * 100}%`, height: "100%", background: "#D97706", borderRadius: 4 }} /></div><span style={{ fontSize: 12, width: 24, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{cnt}</span></div>))}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Distribución por turno</div>{Object.entries(turnoCount).sort().map(([t, cnt]) => { const pct = Math.round((cnt / totalClases) * 100); const colors = { DIURNO: "#2563EB", VESPERTINO: "#DB2777" }; return (<div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}><span style={{ fontSize: 12, width: 90, color: "#6B7280", fontWeight: 500 }}>{t.charAt(0) + t.slice(1).toLowerCase()}</span><div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 14, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: colors[t] || "#888", borderRadius: 4 }} /></div><span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, width: 60, textAlign: "right" }}>{cnt} ({pct}%)</span></div>); })}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Secciones por trayecto</div>{ALL_TRAYECTOS.map(t => { const cnt = [...new Set(data.filter(d => d.trayecto === t).map(d => d.sheet.trim()))].length; return (<div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>{t}</span><div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}><div style={{ width: `${(cnt / seccionesCount) * 100}%`, height: "100%", background: TRAYECTO_COLORS[t] || "#888", borderRadius: 4 }} /></div><span style={{ fontSize: 12, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{cnt}</span></div>); })}</div>
      </div>
    </div>
  );
}

// ========== Componente principal App ==========
export default function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState("horarios");
  const [selectedTrayecto, setSelectedTrayecto] = useState("all");
  const [selectedSeccion, setSelectedSeccion] = useState("all");
  const [selectedTurno, setSelectedTurno] = useState("all");
  const [activeDay, setActiveDay] = useState("all");
  const [expandedCell, setExpandedCell] = useState(null);
  const [docenteNav, setDocenteNav] = useState(null);
  const [docenteNames, setDocenteNames] = useState({});

  // Cargar datos desde Supabase
  const fetchHorarios = async () => {
    setLoading(true);
    const { data: horarios, error } = await supabase.from("horarios").select("*").order("id", { ascending: true });
    if (error) {
      console.error(error);
      setError(error.message);
    } else {
      setData(horarios || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchHorarios();
  }, []);

  // Procesar archivo Excel
  const handleFileUpload = async (file) => {
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const binaryStr = e.target.result;
      const workbook = XLSX.read(binaryStr, { type: "binary" });
      const allRows = [];
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        let headerRowIdx = -1;
        let horaColIdx = -1;
        let diaCols = { LUNES: -1, MARTES: -1, MIÉRCOLES: -1, JUEVES: -1, VIERNES: -1 };
        for (let i = 0; i < json.length; i++) {
          const row = json[i];
          if (row[0] === "HORA") {
            headerRowIdx = i;
            for (let j = 0; j < row.length; j++) {
              const cell = row[j]?.toString().toUpperCase();
              if (cell === "LUNES") diaCols.LUNES = j;
              else if (cell === "MARTES") diaCols.MARTES = j;
              else if (cell === "MIÉRCOLES") diaCols.MIÉRCOLES = j;
              else if (cell === "JUEVES") diaCols.JUEVES = j;
              else if (cell === "VIERNES") diaCols.VIERNES = j;
            }
            horaColIdx = 0;
            break;
          }
        }
        if (headerRowIdx === -1) continue;
        let programa = "", trayecto = "", seccion = "", turno = "", sede = "", aula = "";
        for (let i = 0; i < headerRowIdx; i++) {
          const row = json[i];
          if (!row) continue;
          const firstCell = row[0]?.toString().trim();
          if (firstCell === "PROGRAMA") programa = row[1]?.toString().trim() || "";
          else if (firstCell === "TRAYECTO") trayecto = row[1]?.toString().trim() || "";
          else if (firstCell === "Sede:") sede = row[1]?.toString().trim() || "";
          else if (firstCell === "Sección") seccion = row[5]?.toString().trim() || "";
          else if (firstCell === "Turno") turno = row[5]?.toString().trim() || "";
          else if (firstCell === "AULA") aula = row[1]?.toString().trim() || "";
        }
        turno = normalizeTurno(turno);
        for (let i = headerRowIdx + 1; i < json.length; i++) {
          const row = json[i];
          const hora = row[horaColIdx]?.toString().trim();
          if (!hora || hora === "") continue;
          for (const [dia, colIdx] of Object.entries(diaCols)) {
            if (colIdx === -1) continue;
            const clase = row[colIdx]?.toString().trim();
            if (clase && clase !== "") {
              allRows.push({ sheet: sheetName, programa, trayecto, seccion, turno, sede, aula: aula || null, dia, hora, clase });
            }
          }
        }
      }
      if (allRows.length === 0) {
        setError("No se encontraron datos válidos en el archivo.");
        setUploading(false);
        return;
      }
      const { error: insertError } = await supabase.from("horarios").insert(allRows);
      if (insertError) {
        console.error(insertError);
        setError("Error al guardar en la base de datos: " + insertError.message);
      } else {
        alert(`✅ Se cargaron ${allRows.length} clases correctamente.`);
        fetchHorarios();
      }
      setUploading(false);
    };
    reader.onerror = () => { setError("Error al leer el archivo."); setUploading(false); };
    reader.readAsBinaryString(file);
  };

  // Cálculos derivados
  const filtered = useMemo(() => {
    return data.filter(d => {
      if (selectedTrayecto !== "all" && d.trayecto !== selectedTrayecto) return false;
      if (selectedSeccion !== "all" && d.sheet.trim() !== selectedSeccion) return false;
      if (selectedTurno !== "all" && d.turno !== selectedTurno) return false;
      if (activeDay !== "all" && d.dia !== activeDay) return false;
      return true;
    });
  }, [data, selectedTrayecto, selectedSeccion, selectedTurno, activeDay]);

  const byDocente = useMemo(() => {
    const map = {};
    data.forEach(d => {
      const { docente } = parseClase(d.clase);
      if (!docente) return;
      if (!map[docente]) map[docente] = [];
      map[docente].push(d);
    });
    return map;
  }, [data]);

  const conflicts = useMemo(() => {
    const issues = [];
    Object.entries(byDocente).forEach(([doc, entries]) => {
      DAYS.forEach(day => {
        const horasUnicas = [...new Set(entries.map(e => e.hora))];
        horasUnicas.forEach(hora => {
          const matches = entries.filter(e => e.dia === day && e.hora === hora);
          if (matches.length > 1) issues.push({ docente: doc, dia: day, hora, entries: matches });
        });
      });
    });
    return issues;
  }, [byDocente]);

  const gridData = useMemo(() => {
    const map = {};
    filtered.forEach(d => {
      const key = `${d.hora}__${d.dia}`;
      if (!map[key]) map[key] = [];
      map[key].push(d);
    });
    return map;
  }, [filtered]);

  const allTrayectos = [...new Set(data.map(d => d.trayecto))].sort();
  const allTurnos = [...new Set(data.map(d => d.turno))].sort();
  const allSecciones = [...new Set(data.map(d => d.sheet.trim()))].sort();
  const seccionesByTrayecto = useMemo(() =>
    allSecciones.filter(s => selectedTrayecto === "all" || data.some(d => d.sheet.trim() === s && d.trayecto === selectedTrayecto)),
    [selectedTrayecto, data, allSecciones]);

  const stats = useMemo(() => ({
    total: data.length,
    secciones: new Set(data.map(d => d.sheet.trim())).size,
    docentes: Object.keys(byDocente).length,
    materias: new Set(data.map(d => parseClase(d.clase).materia)).size,
  }), [data, byDocente]);

  const getDocName = (raw) => docenteNames[raw] || raw;
  const handleNavigate = (result) => {
    if (result.docente) { setDocenteNav(result.docente); setView("docentes"); } else { setView("horarios"); }
  };

  const nav = [
    { id: "horarios", emoji: "📅", label: "Horarios" },
    { id: "secciones", emoji: "🏫", label: "Secciones" },
    { id: "docentes", emoji: "👥", label: "Docentes" },
    { id: "materias", emoji: "📖", label: "Materias" },
    { id: "asistencias", emoji: "🖨️", label: "Asistencias" },
    { id: "conflictos", emoji: "⚠️", label: "Conflictos", badge: conflicts.length },
    { id: "estadisticas", emoji: "📊", label: "Estadísticas" },
  ];

  if (loading) return <div style={{ padding: 20 }}>Cargando horarios...</div>;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", background: "#F3F4F6", overflow: "hidden" }}>
      <aside style={{ width: 220, background: "#111827", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>PNF Informática</div>
          <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>Cabimas · 2-2026</div>
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#1F2937", borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 11, color: "#9CA3AF" }}>Clases</span><span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{stats.total}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 11, color: "#9CA3AF" }}>Secciones</span><span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{stats.secciones}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, color: "#9CA3AF" }}>Docentes</span><span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{stats.docentes}</span></div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "8px 10px", overflowY: "auto" }}>
          {nav.map(item => (
            <button key={item.id} onClick={() => setView(item.id)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", border: "none", borderRadius: 8,
              background: view === item.id ? "#2563EB" : "transparent", color: view === item.id ? "#fff" : "#9CA3AF",
              cursor: "pointer", fontSize: 13, textAlign: "left", marginBottom: 2, fontWeight: view === item.id ? 600 : 400, transition: "all 0.15s",
            }}><span style={{ fontSize: 15 }}>{item.emoji}</span><span style={{ flex: 1 }}>{item.label}</span>{item.badge > 0 && (<span style={{ background: "#EF4444", color: "#fff", borderRadius: 10, fontSize: 10, padding: "2px 6px", fontWeight: 700 }}>{item.badge}</span>)}</button>
          ))}
        </nav>
        <div style={{ padding: "12px 14px", borderTop: "1px solid #1F2937" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Leyenda</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>{allTrayectos.map(t => (<div key={t} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: TRAYECTO_COLORS[t], flexShrink: 0 }} /><span style={{ fontSize: 10, color: "#9CA3AF" }}>T.{t}</span></div>))}</div>
        </div>
        <div style={{ padding: "12px 14px", borderTop: "1px solid #1F2937" }}>
          <label htmlFor="upload-excel" style={{ display: "block", cursor: "pointer", background: "#2563EB", color: "#fff", textAlign: "center", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>📂 Cargar Excel</label>
          <input id="upload-excel" type="file" accept=".xlsx, .xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }} disabled={uploading} />
          {uploading && <div style={{ fontSize: 10, marginTop: 6, color: "#9CA3AF" }}>Subiendo...</div>}
          {error && <div style={{ fontSize: 10, marginTop: 6, color: "#EF4444" }}>{error}</div>}
        </div>
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <GlobalSearch onNavigate={handleNavigate} docenteNames={docenteNames} data={data} />
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#9CA3AF" }}>{stats.total} registros · {stats.materias} materias</div>
        </header>
        <main style={{ flex: 1, overflow: "auto" }}>
          {view === "horarios" && <HorariosView filtered={filtered} gridData={gridData} selectedTrayecto={selectedTrayecto} setSelectedTrayecto={setSelectedTrayecto} selectedSeccion={selectedSeccion} setSelectedSeccion={setSelectedSeccion} selectedTurno={selectedTurno} setSelectedTurno={setSelectedTurno} activeDay={activeDay} setActiveDay={setActiveDay} seccionesByTrayecto={seccionesByTrayecto} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} allTrayectos={allTrayectos} allTurnos={allTurnos} />}
          {view === "secciones" && <SeccionesView data={data} getDocName={getDocName} />}
          {view === "docentes" && <DocentesView byDocente={byDocente} conflicts={conflicts} initialSel={docenteNav} onConsumeNav={() => setDocenteNav(null)} docenteNames={docenteNames} setDocenteNames={setDocenteNames} getDocName={getDocName} data={data} />}
          {view === "materias" && <MateriasView data={data} getDocName={getDocName} />}
          {view === "asistencias" && <AsistenciasView data={data} getDocName={getDocName} />}
          {view === "conflictos" && <ConflictosView conflicts={conflicts} onGoDocente={(d) => { setDocenteNav(d); setView("docentes"); }} getDocName={getDocName} />}
          {view === "estadisticas" && <EstadisticasView stats={stats} byDocente={byDocente} data={data} />}
        </main>
      </div>
    </div>
  );
}
