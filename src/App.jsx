import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabase";
import LoginScreen from "./components/LoginScreen";

// ========== Constantes globales ==========
const DAYS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];
const ALL_TRAYECTOS = [
  "INICIAL",
  "1-1", "1-2", "1-3",
  "2-1", "2-2", "2-3",
  "3-1", "3-2", "3-3",
  "4-1", "4-2", "4-3"
];
const DEFAULT_PROGRAMAS = ["PNF Informática", "PNF Contaduría Pública", "PNF Agroalimentación", "PNF Educación Especial"];

const TRAYECTO_COLORS = {
  "INICIAL": "#8B5CF6",
  "1-1": "#2563EB", "1-2": "#1D4ED8", "1-3": "#1E40AF",
  "2-1": "#DC2626", "2-2": "#B91C1C", "2-3": "#991B1B",
  "3-1": "#D97706", "3-2": "#B45309", "3-3": "#92400E",
  "4-1": "#059669", "4-2": "#047857", "4-3": "#065F46",
};
const TRAYECTO_BG = {
  "INICIAL": "#F5F3FF",
  "1-1": "#EFF6FF", "1-2": "#DBEAFE", "1-3": "#BFDBFE",
  "2-1": "#FEF2F2", "2-2": "#FEE2E2", "2-3": "#FECACA",
  "3-1": "#FFFBEB", "3-2": "#FEF3C7", "3-3": "#FDE68A",
  "4-1": "#ECFDF5", "4-2": "#D1FAE5", "4-3": "#A7F3D0",
};

const BLOQUES_DIURNO = [
  { inicio: "7:30AM", fin: "8:15AM", label: "7:30 – 8:15 AM" },
  { inicio: "8:15AM", fin: "9:00AM", label: "8:15 – 9:00 AM" },
  { inicio: "9:00AM", fin: "9:45AM", label: "9:00 – 9:45 AM" },
  { inicio: "9:45AM", fin: "10:30AM", label: "9:45 – 10:30 AM" },
  { inicio: "10:30AM", fin: "11:15AM", label: "10:30 – 11:15 AM" },
  { inicio: "11:15AM", fin: "12:00PM", label: "11:15 AM – 12:00 PM" },
];
const BLOQUES_VESPERTINO = [
  { inicio: "1:00PM", fin: "1:45PM", label: "1:00 – 1:45 PM" },
  { inicio: "1:45PM", fin: "2:30PM", label: "1:45 – 2:30 PM" },
  { inicio: "2:30PM", fin: "3:15PM", label: "2:30 – 3:15 PM" },
  { inicio: "3:15PM", fin: "4:00PM", label: "3:15 – 4:00 PM" },
  { inicio: "4:00PM", fin: "4:45PM", label: "4:00 – 4:45 PM" },
  { inicio: "4:45PM", fin: "5:30PM", label: "4:45 – 5:30 PM" },
];

// ========== UTILIDADES ==========
function timeToMin(s) {
  if (!s) return 0;
  const m = s.replace(/\s/g, "").match(/^(\d+):(\d+)(AM|PM)$/i);
  if (!m) return 0;
  let hh = parseInt(m[1]), mi = parseInt(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && hh !== 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  return hh * 60 + mi;
}

function getTurnoByCodigo(sheetName) {
  if (!sheetName) return null;
  const digits = sheetName.replace(/\D/g, "");
  if (digits.length < 2) return null;
  const penultimo = digits[digits.length - 2];
  if (penultimo === "1") return "DIURNO";
  if (penultimo === "2") return "VESPERTINO";
  return null;
}

function normalizeTurno(t) {
  if (!t) return null;
  const u = t.toUpperCase().trim();
  if (u === "MATUTINO" || u === "DIURNO") return "DIURNO";
  if (u === "VESPETINO" || u === "VESPERTINO") return "VESPERTINO";
  return null;
}

function getTurnoFromHora(horaStr) {
  const raw = horaStr ? horaStr.replace(/\s/g, "").split(/[-–]/)[0] : "";
  const min = timeToMin(raw);
  if (min >= timeToMin("7:00AM") && min <= timeToMin("12:00PM")) return "DIURNO";
  if (min >= timeToMin("1:00PM") && min <= timeToMin("5:30PM")) return "VESPERTINO";
  return null;
}

function getTurnoDeRegistro(d) {
  return getTurnoByCodigo(d.sheet) || normalizeTurno(d.turno) || getTurnoFromHora(d.hora) || "DIURNO";
}

function getBloquesForTurno(turno) {
  return turno === "VESPERTINO" ? BLOQUES_VESPERTINO : BLOQUES_DIURNO;
}

function findStartBlock(bloques, horaStr) {
  const raw = horaStr ? horaStr.replace(/\s/g, "").split(/[-–]/)[0] : "";
  const min = timeToMin(raw);
  let best = 0, bestDiff = Infinity;
  bloques.forEach((b, i) => {
    const diff = Math.abs(timeToMin(b.inicio) - min);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}

function countBlocks(horaStr) {
  if (!horaStr) return 1;
  const parts = horaStr.trim().split(/[-–]/);
  if (parts.length < 2) return 1;
  const inicioMin = timeToMin(parts[0].trim());
  const finMin = timeToMin(parts[1].trim());
  if (!finMin || finMin <= inicioMin) return 1;
  return Math.max(1, Math.ceil((finMin - inicioMin) / 45));
}

function getHoraDisplayDeRegistro(d) {
  if (!d || !d.hora) return "—";
  const horaStr = d.hora.trim();
  const parts = horaStr.split(/[-–]/);
  if (parts.length >= 2) {
    const inicio = parts[0].trim().replace(/(\d)(AM|PM)/gi, '$1 $2');
    const fin = parts[1].trim().replace(/(\d)(AM|PM)/gi, '$1 $2');
    return `${inicio} – ${fin}`;
  }
  return horaStr.replace(/(\d)(AM|PM)/gi, '$1 $2');
}

function getHoraMin(d) {
  if (!d || !d.hora) return 0;
  return timeToMin(d.hora.trim().split(/[-–]/)[0].trim());
}

function parseClase(clase) {
  const parts = clase.trim().split(/\s+(?:Profes?\.?|Prof\.?)\s+/i);
  return { materia: parts[0].trim(), docente: parts[1] ? parts[1].trim() : "" };
}

function normalizarPrograma(raw) {
  if (!raw) return null;
  const PROGRAMA_ALIASES = {
    "informatica": "PNF Informática", "informática": "PNF Informática",
    "contaduria": "PNF Contaduría Pública", "contaduría": "PNF Contaduría Pública",
    "agroalimentacion": "PNF Agroalimentación", "agroalimentación": "PNF Agroalimentación",
    "educacion especial": "PNF Educación Especial", "educación especial": "PNF Educación Especial",
  };
  const lower = raw.trim().toLowerCase().replace(/pnf\s+(en\s+)?/i, "").trim();
  for (const [key, canonical] of Object.entries(PROGRAMA_ALIASES)) {
    if (lower.includes(key)) return canonical;
  }
  return raw.trim().replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ========== ESTILOS ==========
const S = {
  card: { background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", overflow: "hidden" },
  th: { padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#374151", textAlign: "left", borderBottom: "2px solid #E5E7EB", background: "#F9FAFB", textTransform: "uppercase", letterSpacing: "0.05em" },
  td: { padding: "10px 14px", fontSize: 13, borderTop: "1px solid #F3F4F6", color: "#374151" },
  badge: (bg, col) => ({ background: bg, color: col, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }),
  btn: (active) => ({
    padding: "7px 16px", borderRadius: 20, border: "1px solid",
    borderColor: active ? "#2563EB" : "#E5E7EB", background: active ? "#EFF6FF" : "#fff",
    color: active ? "#1D4ED8" : "#374151", cursor: "pointer", fontSize: 13,
    fontWeight: active ? 600 : 500, transition: "all 0.15s",
  }),
  select: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff", color: "#111827", cursor: "pointer", fontWeight: 500 },
  input: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff", color: "#111827", outline: "none", fontWeight: 500 },
};

// ========== COMPONENTES SIMPLES ==========
function Avatar({ name, size = 36 }) {
  const safeName = name || "Docente";
  const initials = typeof safeName === "string" ? safeName.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?" : "??";
  const hue = typeof safeName === "string" ? [...safeName].reduce((a, c) => a + c.charCodeAt(0), 0) % 360 : 0;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, background: `hsl(${hue},55%,90%)`, color: `hsl(${hue},55%,35%)`, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

function StatCard({ label, value, icon, color = "#2563EB" }) {
  return (
    <div style={{ ...S.card, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{icon}</div>
      <div><div style={{ fontSize: 24, fontWeight: 700, color: "#111827", lineHeight: 1.1 }}>{value}</div><div style={{ fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: 500 }}>{label}</div></div>
    </div>
  );
}

function Toast({ message, type = "success", onClose }) {
  const timerRef = useRef(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onClose(), 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [message, onClose]);
  const bgColors = { success: "#059669", error: "#DC2626", warning: "#D97706", info: "#2563EB" };
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, background: bgColors[type] || bgColors.success, color: "#fff", padding: "14px 20px", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", fontSize: 14, fontWeight: 500, maxWidth: 420, display: "flex", alignItems: "flex-start", gap: 12, animation: "slideIn 0.3s ease", cursor: "pointer", lineHeight: 1.4 }} onClick={onClose}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icons[type] || icons.success}</span>
      <span style={{ flex: 1, wordBreak: "break-word" }}>{message}</span>
      <button onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); onClose(); }} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", cursor: "pointer", fontSize: 16, padding: "2px 6px", borderRadius: 4, opacity: 0.9, fontWeight: 700, flexShrink: 0 }}>×</button>
    </div>
  );
}

// ========== BÚSQUEDA GLOBAL ==========
function GlobalSearch({ onNavigate, docenteNames, materiaNames, data }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), ref = useRef();
  const results = useMemo(() => {
    if (q.length < 2) return [];
    const lo = q.toLowerCase(), seen = new Set(), out = [];
    data.forEach(d => {
      const { materia, docente: rawDocente } = parseClase(d.clase);
      const docente = docenteNames[rawDocente] || rawDocente, materiaDisplay = materiaNames[materia] || materia;
      const key = `${materia}__${rawDocente}`;
      if (!seen.has(key) && (materiaDisplay.toLowerCase().includes(lo) || docente.toLowerCase().includes(lo))) {
        seen.add(key);
        out.push({ type: rawDocente ? "clase" : "materia", materia: materiaDisplay, docente, trayecto: d.trayecto, sheet: d.sheet.trim(), rawMateria: materia, rawDocente });
      }
    });
    return out.slice(0, 8);
  }, [q, docenteNames, materiaNames, data]);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return (
    <div ref={ref} className="global-search" style={{ position: "relative", width: 280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 12px" }}>
        <span style={{ fontSize: 16, color: "#9CA3AF" }}>🔍</span>
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Buscar materia, docente…" style={{ border: "none", background: "transparent", outline: "none", fontSize: 14, color: "#111827", width: "100%", fontWeight: 500 }} />
        {q && <button onClick={() => setQ("")} style={{ border: "none", background: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16 }}>×</button>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", zIndex: 200, overflow: "hidden" }}>
          {results.map((r, i) => (
            <div key={i} onClick={() => { onNavigate(r); setOpen(false); setQ(""); }} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderTop: i > 0 ? "1px solid #F3F4F6" : "none", fontSize: 14 }}>
              <span style={S.badge(TRAYECTO_BG[r.trayecto] || "#f3f4f6", TRAYECTO_COLORS[r.trayecto] || "#555")}>{r.trayecto}</span>
              <div><div style={{ fontWeight: 600, color: "#111827" }}>{r.materia}</div>{r.docente && <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>{r.docente}</div>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== GRILLA DE TURNOS ==========
function TurnoGrid({ bloques, turnoLabel, filtered, days, expandedCell, setExpandedCell, getDocName, getMateriaName }) {
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
          <colgroup><col style={{ width: 110 }} />{days.map(d => <col key={d} />)}</colgroup>
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              <th style={{ ...S.th, padding: "10px 12px", fontSize: 12, width: 110 }}>Hora</th>
              {days.map(d => <th key={d} style={{ ...S.th, padding: "10px 10px", fontSize: 13, borderLeft: "1px solid #E5E7EB", textAlign: "center" }}>{d.charAt(0) + d.slice(1).toLowerCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {bloques.map((bloque, bi) => {
              const cells = days.map(day => { const cell = cellMap[day]?.[bi]; if (cell === "skip") return { skip: true }; if (!cell) return { empty: true }; return { data: cell }; });
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
                            <div key={i} onClick={() => setExpandedCell(isExp ? null : cellKey)} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6, padding: isExp ? "6px 8px" : "5px 8px", marginBottom: i < entries.length - 1 ? 3 : 0, cursor: "pointer", transition: "all 0.15s", boxShadow: isExp ? `0 0 0 2px ${col}55, 0 2px 8px rgba(0,0,0,0.08)` : "0 1px 2px rgba(0,0,0,0.04)", height: !isExp && span > 0 ? `calc(${span * ROW_H - 10}px / ${entries.length})` : "auto", minHeight: 38, display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden" }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: col, lineHeight: 1.3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{materia}</div>
                              {docente && <div style={{ fontSize: 12, fontWeight: 600, color: col, opacity: 0.85, lineHeight: 1.2, marginTop: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{docente}</div>}
                              {isExp && <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${col}30`, fontSize: 12, display: "flex", flexDirection: "column", gap: 3, fontWeight: 500 }}><div>📂 {e.sheet.trim()} · T.{e.trayecto}</div><div>⏰ {getHoraDisplayDeRegistro(e)}</div><div>🏫 {e.aula || "Sin aula"}</div></div>}
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

// ========== VISTAS PRINCIPALES ==========
function HorariosView({ filtered, selectedTrayecto, setSelectedTrayecto, selectedSeccion, setSelectedSeccion, activeDay, setActiveDay, seccionesByTrayecto, expandedCell, setExpandedCell, getDocName, getMateriaName, allTrayectos }) {
  const days = activeDay === "all" ? DAYS : [activeDay];
  const fd = filtered.filter(d => getTurnoDeRegistro(d) === "DIURNO"), fv = filtered.filter(d => getTurnoDeRegistro(d) === "VESPERTINO");
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

function SeccionesView({ data, getDocName, getMateriaName }) {
  const allSecciones = useMemo(() => [...new Set(data.map(d => d.sheet.trim()))].sort(), [data]);
  const [selSheet, setSelSheet] = useState(null), [filterTray, setFilterTray] = useState("all");
  useEffect(() => { if (allSecciones.length && (!selSheet || !allSecciones.includes(selSheet))) setSelSheet(allSecciones[0]); }, [allSecciones, selSheet]);
  const filteredSecciones = useMemo(() => filterTray === "all" ? allSecciones : allSecciones.filter(s => data.find(d => d.sheet.trim() === s)?.trayecto === filterTray), [filterTray, allSecciones, data]);
  const entries = useMemo(() => data.filter(d => d.sheet.trim() === selSheet), [data, selSheet]);
  const info = entries[0];
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
            const tray = data.find(d => d.sheet.trim() === s)?.trayecto;
            return <div key={s} onClick={() => setSelSheet(s)} style={{ padding: "10px 14px", cursor: "pointer", fontSize: 14, fontWeight: selSheet === s ? 600 : 400, background: selSheet === s ? "#EFF6FF" : "transparent", color: selSheet === s ? "#1D4ED8" : "#374151", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: TRAYECTO_COLORS[tray] || "#ccc", flexShrink: 0 }} />{s}</div>;
          })}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {info && (
          <>
            <div style={{ ...S.card, padding: "18px 22px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div><div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{selSheet}</div><div style={{ fontSize: 14, color: "#6B7280", marginTop: 2, fontWeight: 500 }}>{info.programa}</div></div>
                <span style={S.badge(TRAYECTO_BG[info.trayecto] || "#f3f4f6", TRAYECTO_COLORS[info.trayecto] || "#555")}>Trayecto {info.trayecto}</span>
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                {[["Turno", info.turno], ["Sección", info.seccion], ["Sede", info.sede], info.aula && ["Aula", info.aula], ["Total clases", entries.length]].filter(Boolean).map(([l, v]) => <div key={l}><div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div><div style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginTop: 3 }}>{v}</div></div>)}
              </div>
            </div>
            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderBottom: "2px solid #E5E7EB" }}>{DAYS.map(day => <div key={day} style={{ padding: "12px 14px", borderRight: "1px solid #E5E7EB", fontWeight: 700, fontSize: 12, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", background: "#F9FAFB" }}>{day.slice(0, 3)}</div>)}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)" }}>
                {DAYS.map(day => (
                  <div key={day} style={{ padding: "10px 10px", borderRight: "1px solid #F3F4F6", minHeight: 130 }}>
                    {(byDay[day] || []).map((e, i) => {
                      const { materia: rm, docente: rd } = parseClase(e.clase);
                      const materia = getMateriaName(rm), docente = getDocName(rd);
                      const col = TRAYECTO_COLORS[e.trayecto] || "#555", bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5";
                      return <div key={i} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "6px 10px", marginBottom: 6 }}><div style={{ fontSize: 12, fontWeight: 700, color: col, lineHeight: 1.3 }}>{materia.length > 24 ? materia.slice(0, 22) + "…" : materia}</div><div style={{ fontSize: 11, color: col, opacity: 0.75, marginTop: 2, fontWeight: 500 }}>{getHoraDisplayDeRegistro(e)}</div>{docente && <div style={{ fontSize: 11, color: col, opacity: 0.7, marginTop: 2, fontWeight: 500 }}>{docente.split(" ")[0]}</div>}</div>;
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

function DocentesView({ byDocente, conflicts, initialSel, onConsumeNav, getDocName, onSaveDocenteName }) {
  const sorted = Object.keys(byDocente).sort();
  const [sel, setSel] = useState(initialSel || null), [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false), [editValue, setEditValue] = useState(""), [saving, setSaving] = useState(false);
  
  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel, onConsumeNav]);
  useEffect(() => { if (sel) setEditValue(getDocName(sel)); }, [sel, getDocName]);

  const hasConflict = (name) => conflicts.some(c => c.docente === name);
  const selEntries = byDocente[sel] || [], selConflicts = sel ? conflicts.filter(c => c.docente === sel) : [];
  const filteredSorted = search ? sorted.filter(d => getDocName(d).toLowerCase().includes(search.toLowerCase())) : sorted;

  const docenteStats = useMemo(() => {
    if (!selEntries.length) return null;
    const dias = new Set(selEntries.map(e => e.dia)), trayectos = new Set(selEntries.map(e => e.trayecto));
    const secciones = new Set(selEntries.map(e => e.sheet?.trim()).filter(Boolean)), materias = new Set(selEntries.map(e => parseClase(e.clase).materia));
    const horasPorDia = {}; DAYS.forEach(d => { horasPorDia[d] = selEntries.filter(e => e.dia === d).length; });
    return { totalClases: selEntries.length, totalDias: dias.size, totalTrayectos: trayectos.size, totalSecciones: secciones.size, totalMaterias: materias.size, horasPorDia };
  }, [selEntries]);

  const saveEdit = async () => { 
    const t = editValue.trim(); 
    if (t && sel) { setSaving(true); const res = await onSaveDocenteName(sel, t); setSaving(false); if (res.success) { setEditingName(false); if (res.targetRaw) setSel(res.targetRaw); } }
    else setEditingName(false);
  };

  return (
    <div className="docentes-layout" style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div className="docentes-left-panel" style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar docente…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filteredSorted.length} docentes</div>
          {filteredSorted.map(d => (
            <div key={d} onClick={() => { setSel(d); setEditingName(false); }} style={{ padding: "10px 14px", cursor: "pointer", fontSize: 14, fontWeight: sel === d ? 600 : 400, background: sel === d ? "#EFF6FF" : "transparent", color: sel === d ? "#1D4ED8" : "#374151", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{hasConflict(d) && <span title="Conflictos" style={{ fontSize: 14 }}>⚠️</span>}{getDocName(d)}</span>
              <span style={{ fontSize: 12, background: "#F3F4F6", borderRadius: 10, padding: "2px 8px", color: "#6B7280", fontWeight: 600 }}>{byDocente[d].length}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!sel ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9CA3AF", fontSize: 15, fontWeight: 500 }}>Selecciona un docente para ver su horario</div> : (
          <div>
            <div style={{ ...S.card, padding: "18px 22px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={getDocName(sel)} size={52} />
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus style={{ ...S.input, fontSize: 16, fontWeight: 600, flex: 1 }} />
                    <button onClick={saveEdit} disabled={saving} style={{ padding: "6px 14px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : "Guardar"}</button>
                    <button onClick={() => setEditingName(false)} style={{ padding: "6px 12px", background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "#111827" }}>{getDocName(sel)}</div>
                    <button onClick={() => { setEditValue(getDocName(sel)); setEditingName(true); }} title="Editar" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: "#6B7280", fontWeight: 500 }}>✏️ Editar</button>
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4, fontWeight: 500 }}>{selEntries.length} clases asignadas{selConflicts.length > 0 && <span style={{ marginLeft: 10, ...S.badge("#FEF2F2", "#DC2626") }}>⚠️ {selConflicts.length} conflicto{selConflicts.length > 1 ? "s" : ""}</span>}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{[...new Set(selEntries.map(e => e.trayecto))].sort().map(t => <span key={t} style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>T.{t}</span>)}</div>
            </div>
            {selConflicts.map((c, i) => (
              <div key={i} style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 16px", marginBottom: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <div><div style={{ fontSize: 13, fontWeight: 600, color: "#991B1B" }}>Conflicto: {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {getHoraDisplayDeRegistro(c.entries[0])}</div><div style={{ fontSize: 12, color: "#B91C1C", marginTop: 4, fontWeight: 500 }}>{c.entries.map(e => parseClase(e.clase).materia).join(" · ")}</div></div>
              </div>
            ))}
            {docenteStats && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
                  <StatCard label="Clases" value={docenteStats.totalClases} icon="📅" color="#2563EB" />
                  <StatCard label="Materias" value={docenteStats.totalMaterias} icon="📖" color="#D97706" />
                  <StatCard label="Secciones" value={docenteStats.totalSecciones} icon="🏫" color="#059669" />
                  <StatCard label="Trayectos" value={docenteStats.totalTrayectos} icon="📊" color="#7C3AED" />
                </div>
                <div style={{ ...S.card, padding: "14px 18px", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 10 }}>📅 Distribución por día</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DAYS.map(day => {
                      const count = docenteStats.horasPorDia[day] || 0, maxCount = Math.max(...Object.values(docenteStats.horasPorDia), 1), isMax = count === maxCount && count > 0;
                      return (
                        <div key={day} style={{ flex: 1, minWidth: 80, textAlign: "center", padding: "10px 6px", borderRadius: 8, background: count > 0 ? (isMax ? "#EFF6FF" : "#F9FAFB") : "#F3F4F6", border: `1px solid ${count > 0 ? (isMax ? "#2563EB" : "#E5E7EB") : "#E5E7EB"}` }}>
                          <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>{day.slice(0, 3)}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: count > 0 ? (isMax ? "#1D4ED8" : "#374151") : "#D1D5DB" }}>{count}</div>
                          {count > 0 && <div style={{ fontSize: 9, color: "#9CA3AF", marginTop: 2 }}>clases</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <div style={S.card}>
              <div style={{ padding: "14px 18px", borderBottom: "2px solid #E5E7EB", fontSize: 14, fontWeight: 700, color: "#374151" }}>📋 Asignaciones</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={{ ...S.th, width: 100 }}>Día</th><th style={{ ...S.th, width: 180 }}>Hora</th><th style={S.th}>Materia</th><th style={{ ...S.th, width: 90 }}>Trayecto</th><th style={{ ...S.th, width: 130 }}>Sección</th></tr></thead>
                  <tbody>
                    {[...selEntries].sort((a, b) => DAYS.indexOf(a.dia) - DAYS.indexOf(b.dia) || getHoraMin(a) - getHoraMin(b)).map((e, i) => {
                      const { materia } = parseClase(e.clase), prevEntry = i > 0 ? [...selEntries].sort((a, b) => DAYS.indexOf(a.dia) - DAYS.indexOf(b.dia) || getHoraMin(a) - getHoraMin(b))[i-1] : null;
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFB" }}>
                          <td style={{ ...S.td, fontWeight: 600, color: "#111827", borderTop: prevEntry && prevEntry.dia !== e.dia ? "2px solid #E5E7EB" : "1px solid #F3F4F6" }}>{e.dia.charAt(0)+e.dia.slice(1).toLowerCase()}</td>
                          <td style={{ ...S.td, color: "#6B7280", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500 }}>{getHoraDisplayDeRegistro(e)}</td>
                          <td style={{ ...S.td, fontWeight: 600, fontSize: 13 }}>{materia}</td>
                          <td style={S.td}><span style={S.badge(TRAYECTO_BG[e.trayecto] || "#f3f4f6", TRAYECTO_COLORS[e.trayecto] || "#555")}>{e.trayecto}</span></td>
                          <td style={{ ...S.td, color: "#6B7280", fontWeight: 500, fontSize: 12 }}>{e.sheet?.trim() || ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MateriasView({ byMateria, initialSel, onConsumeNav, getMateriaName, onSaveMateriaName, data, getDocName }) {
  const sorted = Object.keys(byMateria).sort();
  const [sel, setSel] = useState(initialSel || null), [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false), [editValue, setEditValue] = useState(""), [saving, setSaving] = useState(false);
  
  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel, onConsumeNav]);
  useEffect(() => { if (sel) { setEditValue(getMateriaName(sel)); setEditingName(false); } }, [sel, getMateriaName]);

  const selEntries = sel && byMateria[sel] ? byMateria[sel] : [];
  const filteredSorted = search ? sorted.filter(m => getMateriaName(m).toLowerCase().includes(search.toLowerCase())) : sorted;

  const saveEdit = async () => { 
    const t = editValue.trim(); 
    if (t && sel) { setSaving(true); const res = await onSaveMateriaName(sel, t); setSaving(false); if (res.success) { setEditingName(false); if (res.targetRaw) setSel(res.targetRaw); } }
    else setEditingName(false);
  };

  const asignaciones = useMemo(() => {
    if (!selEntries.length) return [];
    return selEntries.slice().sort((a, b) => { const ia = DAYS.indexOf(a.dia), ib = DAYS.indexOf(b.dia); return (ia !== -1 ? ia : 9) - (ib !== -1 ? ib : 9) || getHoraMin(a) - getHoraMin(b); });
  }, [selEntries]);

  return (
    <div className="materias-layout" style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div className="materias-left-panel" style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar materia…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filteredSorted.length} materias</div>
          {filteredSorted.map(m => <div key={m} onClick={() => { setSel(m); setEditingName(false); }} style={{ padding: "10px 14px", cursor: "pointer", fontSize: 14, fontWeight: sel === m ? 600 : 400, background: sel === m ? "#EFF6FF" : "transparent", color: sel === m ? "#1D4ED8" : "#374151", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>{getMateriaName(m)}</span><span style={{ fontSize: 12, background: "#F3F4F6", borderRadius: 10, padding: "2px 8px", color: "#6B7280", fontWeight: 600 }}>{byMateria[m].length}</span></div>)}
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
                <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4, fontWeight: 500 }}>{selEntries.length} clases asignadas{selEntries.length > 0 && <span style={{ marginLeft: 10, ...S.badge("#EFF6FF", "#2563EB") }}>{new Set(selEntries.map(e => e.trayecto)).size} trayecto(s)</span>}</div>
              </div>
            </div>
            <div style={S.card}>
              <div style={{ padding: "14px 18px", borderBottom: "2px solid #E5E7EB", fontSize: 14, fontWeight: 700, color: "#374151" }}>📋 Asignaciones</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Día", "Hora", "Turno", "Sección", "Trayecto", "Docente"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>{asignaciones.map((e, i) => { const tr = getTurnoDeRegistro(e); const { docente: rd } = parseClase(e.clase); return <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFB" }}><td style={{ ...S.td, fontWeight: 500 }}>{e.dia.charAt(0)+e.dia.slice(1).toLowerCase()}</td><td style={{ ...S.td, color: "#6B7280", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500 }}>{getHoraDisplayDeRegistro(e)}</td><td style={S.td}><span style={S.badge(tr === "DIURNO" ? "#EFF6FF" : "#FDF2F8", tr === "DIURNO" ? "#2563EB" : "#DB2777")}>{tr === "DIURNO" ? "☀️ Diurno" : "🌙 Vespertino"}</span></td><td style={{ ...S.td, fontWeight: 500, color: "#6B7280" }}>{e.sheet?.trim() || ""}</td><td style={S.td}><span style={S.badge(TRAYECTO_BG[e.trayecto] || "#f3f4f6", TRAYECTO_COLORS[e.trayecto] || "#555")}>{e.trayecto}</span></td><td style={{ ...S.td, fontWeight: 500 }}>{rd && getDocName ? getDocName(rd) : (rd || "—")}</td></tr>; })}</tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AsistenciasView({ data, getDocName, getMateriaName }) {
  const [turno, setTurno] = useState("DIURNO"), [selectedDay, setSelectedDay] = useState(DAYS[0]);
  const docentesDelDia = useMemo(() => {
    const map = {};
    data.filter(d => getTurnoDeRegistro(d) === turno && d.dia === selectedDay).forEach(d => {
      const { docente, materia } = parseClase(d.clase);
      if (!docente) return;
      if (!map[docente]) map[docente] = { clases: [] };
      map[docente].clases.push({ materia: getMateriaName(materia), hora: getHoraDisplayDeRegistro(d), horaMin: getHoraMin(d), seccion: d.sheet.trim(), trayecto: d.trayecto, aula: d.aula });
    });
    Object.values(map).forEach(v => { v.clases.sort((a, b) => a.horaMin - b.horaMin); });
    return Object.entries(map).sort((a, b) => getDocName(a[0]).localeCompare(getDocName(b[0])));
  }, [data, turno, selectedDay, getDocName, getMateriaName]);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) { alert("⚠️ El navegador bloqueó la ventana emergente."); return; }
    const html = `<!DOCTYPE html><html><head><title>Asistencia</title><style>*{margin:0;padding:0}body{font-family:Arial;font-size:12px}.page{padding:20px}h1{font-size:16px}.subtitle{font-size:12px;color:#555;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;border:1px solid #ccc;padding:8px;font-size:11px;font-weight:bold}td{border:1px solid #ccc;padding:8px;font-size:12px}.docente-name{font-weight:bold}.firma-box{width:120px;height:45px;border:1px solid #999}</style></head><body><div class="page"><h1>Control de Asistencia Docentes</h1><div class="subtitle">${selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: ${turno==="DIURNO"?"Diurno":"Vespertino"} · 2-2026</div><table><thead><tr><th>N°</th><th>Docente</th><th>Materia(s) / Sección(es)</th><th>Horario</th><th>Entrada</th><th>Salida</th><th>Firma</th></tr></thead><tbody>${docentesDelDia.map(([rd, info], idx) => `<tr><td>${idx+1}</td><td class="docente-name">${getDocName(rd)}</td><td>${info.clases.map(c => `${c.materia} — ${c.seccion}`).join("<br>")}</td><td>${info.clases.map(c => c.hora).join("<br>")}</td><td><div class="firma-box"></div></td><td><div class="firma-box"></div></td><td><div class="firma-box"></div></td></tr>`).join("")}</tbody></table></div></body></html>`;
    win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 400);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>🖨️ Asistencias Diarias por Turno</h1>
      <div style={{ ...S.card, padding: "14px 20px", marginBottom: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase" }}>Turno</div><div style={{ display: "flex", gap: 6 }}>{["DIURNO", "VESPERTINO"].map(t => <button key={t} onClick={() => setTurno(t)} style={{ ...S.btn(turno === t), borderRadius: 8 }}>{t === "DIURNO" ? "☀️ Diurno" : "🌙 Vespertino"}</button>)}</div></div>
        <div><div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase" }}>Día</div><div style={{ display: "flex", gap: 6 }}>{DAYS.map(d => <button key={d} onClick={() => setSelectedDay(d)} style={S.btn(selectedDay === d)}>{d.charAt(0)+d.slice(1).toLowerCase()}</button>)}</div></div>
        <div style={{ marginLeft: "auto" }}><button onClick={handlePrint} style={{ padding: "9px 18px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>🖨️ Imprimir / PDF</button></div>
      </div>
      <div style={S.card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}><div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Control de Asistencia Docentes</div><div style={{ fontSize: 13, color: "#6B7280", marginTop: 2, fontWeight: 500 }}>PNF en Informática · {selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: {turno === "DIURNO" ? "Diurno (7:30AM – 12:00PM)" : "Vespertino (1:00PM – 5:30PM)"} · 2-2026</div></div>
        {!docentesDelDia.length ? <div style={{ padding: "40px 20px", textAlign: "center", color: "#9CA3AF", fontSize: 15, fontWeight: 500 }}>No hay docentes registrados.</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={{ ...S.th, width: 40, textAlign: "center" }}>N°</th><th style={{ ...S.th, width: 200 }}>Docente</th><th style={S.th}>Materia(s) / Sección(es)</th><th style={{ ...S.th, width: 160 }}>Horario</th><th style={{ ...S.th, width: 90 }}>Entrada</th><th style={{ ...S.th, width: 90 }}>Salida</th><th style={{ ...S.th, width: 130 }}>Firma</th></tr></thead>
            <tbody>{docentesDelDia.map(([rd, info], idx) => <tr key={rd} style={{ background: idx % 2 === 0 ? "#fff" : "#FAFAFB" }}><td style={{ ...S.td, textAlign: "center", color: "#9CA3AF", fontWeight: 600, fontSize: 13 }}>{idx+1}</td><td style={S.td}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={getDocName(rd)} size={30} /><span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{getDocName(rd)}</span></div></td><td style={{ ...S.td, fontSize: 13 }}>{info.clases.map((c, i) => <div key={i} style={{ marginBottom: i < info.clases.length - 1 ? 5 : 0 }}><span style={{ fontWeight: 600 }}>{c.materia}</span><span style={{ color: "#6B7280", marginLeft: 6, fontWeight: 500 }}>— {c.seccion}</span>{c.trayecto && <span style={{ ...S.badge(TRAYECTO_BG[c.trayecto] || "#f3f4f6", TRAYECTO_COLORS[c.trayecto] || "#555"), marginLeft: 8 }}>T.{c.trayecto}</span>}</div>)}</td><td style={{ ...S.td, fontSize: 12, color: "#6B7280", whiteSpace: "nowrap", fontWeight: 500 }}>{info.clases.map((c, i) => <div key={i} style={{ marginBottom: i < info.clases.length - 1 ? 5 : 0 }}>{c.hora}</div>)}</td><td style={{ ...S.td, border: "1px solid #E5E7EB" }}></td><td style={{ ...S.td, border: "1px solid #E5E7EB" }}></td><td style={{ ...S.td, border: "1px solid #E5E7EB", height: 48 }}></td></tr>)}</tbody>
          </table>
        )}
        {docentesDelDia.length > 0 && <div style={{ padding: "16px 20px", borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 500 }}><div>Total docentes: <strong style={{ color: "#111827" }}>{docentesDelDia.length}</strong></div><div>Total clases: <strong style={{ color: "#111827" }}>{docentesDelDia.reduce((a, [, v]) => a + v.clases.length, 0)}</strong></div></div>}
      </div>
    </div>
  );
}

function ConflictosView({ conflicts, onGoDocente, getDocName }) {
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}><h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>⚠️ Conflictos detectados</h1><span style={S.badge(conflicts.length > 0 ? "#FEF2F2" : "#F0FDF4", conflicts.length > 0 ? "#DC2626" : "#16A34A")}>{conflicts.length}</span></div>
      {!conflicts.length ? <div style={{ ...S.card, padding: "60px 20px", textAlign: "center" }}><div style={{ fontSize: 48 }}>✅</div><div style={{ fontSize: 18, fontWeight: 600, color: "#111827" }}>Sin conflictos</div><div style={{ fontSize: 14, color: "#6B7280", marginTop: 6, fontWeight: 500 }}>No se detectaron solapamientos horarios.</div></div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {conflicts.map((c, i) => (
            <div key={i} style={{ ...S.card, borderLeft: "4px solid #EF4444", padding: "14px 18px" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <button onClick={() => onGoDocente(c.docente)} style={{ fontSize: 15, fontWeight: 700, color: "#DC2626", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>{getDocName(c.docente)}</button>
                    <span style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>— {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {getHoraDisplayDeRegistro(c.entries[0])}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{c.entries.map((e, j) => { const { materia } = parseClase(e.clase); const col = TRAYECTO_COLORS[e.trayecto] || "#555", bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5"; return <div key={j} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 500 }}><div style={{ fontWeight: 600, color: col }}>{materia}</div><div style={{ color: col, opacity: 0.7, fontSize: 11 }}>{e.sheet.trim()} · T.{e.trayecto}</div></div>; })}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EstadisticasView({ stats, byDocente, byMateria, data, getDocName, getMateriaName }) {
  const trayectoCount = {}, dayCount = {}, turnoCount = {};
  data.forEach(d => { trayectoCount[d.trayecto] = (trayectoCount[d.trayecto] || 0) + 1; turnoCount[d.turno] = (turnoCount[d.turno] || 0) + 1; });
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
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Clases por trayecto</div>{Object.entries(trayectoCount).sort().map(([t, c]) => <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>{t}</span><div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}><div style={{ width: `${(c/totalClases)*100}%`, height: "100%", background: TRAYECTO_COLORS[t] || "#888", borderRadius: 4 }} /></div><span style={{ fontSize: 13, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{c}</span></div>)}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Distribución por día</div>{DAYS.map(d => <div key={d} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={{ fontSize: 13, width: 80, color: "#6B7280", fontWeight: 500 }}>{d.charAt(0)+d.slice(1).toLowerCase()}</span><div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}><div style={{ width: `${(dayCount[d]/maxDay)*100}%`, height: "100%", background: "#059669", borderRadius: 4 }} /></div><span style={{ fontSize: 13, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{dayCount[d]}</span></div>)}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Docentes con mayor carga</div>{top8Docentes.map(([doc, entries], idx) => <div key={doc} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#D1D5DB", width: 16 }}>{idx+1}</span><span style={{ fontSize: 13, flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{getDocName(doc)}</span><div style={{ width: 100, background: "#F3F4F6", borderRadius: 4, height: 10, overflow: "hidden" }}><div style={{ width: `${(entries.length/maxLoadDocente)*100}%`, height: "100%", background: "#7C3AED", borderRadius: 4 }} /></div><span style={{ fontSize: 13, width: 24, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{entries.length}</span></div>)}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Materias más frecuentes</div>{topMaterias.map(([mat, entries], idx) => { const cnt = entries.length; return <div key={mat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#D1D5DB", width: 16 }}>{idx+1}</span><span style={{ fontSize: 13, flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={getMateriaName(mat)}>{getMateriaName(mat).length > 28 ? getMateriaName(mat).slice(0,26)+"…" : getMateriaName(mat)}</span><div style={{ width: 100, background: "#F3F4F6", borderRadius: 4, height: 10, overflow: "hidden" }}><div style={{ width: `${(cnt/maxMat)*100}%`, height: "100%", background: "#D97706", borderRadius: 4 }} /></div><span style={{ fontSize: 13, width: 24, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{cnt}</span></div>; })}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Distribución por turno</div>{Object.entries(turnoCount).sort().map(([t, cnt]) => { const pct = totalClases > 0 ? Math.round((cnt/totalClases)*100) : 0; const colors = { DIURNO: "#2563EB", VESPERTINO: "#DB2777" }; return <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}><span style={{ fontSize: 13, width: 90, color: "#6B7280", fontWeight: 500 }}>{t.charAt(0)+t.slice(1).toLowerCase()}</span><div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 14, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: colors[t] || "#888", borderRadius: 4 }} /></div><span style={{ fontSize: 13, color: "#6B7280", fontWeight: 600, width: 60, textAlign: "right" }}>{cnt} ({pct}%)</span></div>; })}</div>
        <div style={{ ...S.card, padding: "16px 20px" }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Secciones por trayecto</div>{ALL_TRAYECTOS.map(t => { const cnt = [...new Set(data.filter(d => d.trayecto === t).map(d => d.sheet.trim()))].length; const pct = seccionesCount > 0 ? (cnt/seccionesCount)*100 : 0; return <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>{t}</span><div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: TRAYECTO_COLORS[t] || "#888", borderRadius: 4 }} /></div><span style={{ fontSize: 13, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{cnt}</span></div>; })}</div>
      </div>
    </div>
  );
}

// ========== NAVEGACIÓN Y ESTILOS ==========
const NAV_ITEMS = [
  { id: "horarios", emoji: "📅", label: "Horarios" },
  { id: "secciones", emoji: "🏫", label: "Secciones" },
  { id: "docentes", emoji: "👥", label: "Docentes", hasBadge: true },
  { id: "materias", emoji: "📖", label: "Materias" },
  { id: "asistencias", emoji: "🖨️", label: "Asistencias" },
  { id: "conflictos", emoji: "⚠️", label: "Conflictos", hasBadge: true },
  { id: "estadisticas", emoji: "📊", label: "Estadísticas" },
];

const responsiveCSS = `
  @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
  @media(max-width:768px){.hamburger-btn{display:block!important}.sidebar-aside{transform:translateX(-100%);position:fixed!important;z-index:300;height:100vh;transition:transform .25s}.sidebar-aside.open{transform:translateX(0)}.sidebar-overlay{display:block!important}.main-content{margin-left:0!important}.stats-grid-4{grid-template-columns:repeat(2,1fr)!important}.stats-grid-2{grid-template-columns:1fr!important}.docentes-layout,.materias-layout,.secciones-layout{flex-direction:column!important;height:auto!important}.docentes-left-panel,.materias-left-panel,.secciones-left-panel{width:100%!important;max-height:220px}.global-search{width:160px!important}}
  @media(max-width:480px){.stats-grid-4{grid-template-columns:1fr 1fr!important}.header-stats{display:none}}
`;

function ResponsiveStyles() { return <style>{responsiveCSS}</style>; }

// ========== COMPONENTE PRINCIPAL APP ==========
export default function App() {
  const [user, setUser] = useState(undefined);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState("horarios");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedPrograma, setSelectedPrograma] = useState("todos");
  const [programasDisponibles, setProgramasDisponibles] = useState(["todos", ...DEFAULT_PROGRAMAS]);
  const [selectedTrayecto, setSelectedTrayecto] = useState("all");
  const [selectedSeccion, setSelectedSeccion] = useState("all");
  const [activeDay, setActiveDay] = useState("all");
  const [expandedCell, setExpandedCell] = useState(null);
  const [docenteNav, setDocenteNav] = useState(null);
  const [materiaNav, setMateriaNav] = useState(null);
  const [docenteNames, setDocenteNames] = useState({});
  const [materiaNames, setMateriaNames] = useState({});
  const [toast, setToast] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const fetchProgramas = async () => {
    const { data: programas } = await supabase.from("horarios").select("programa").not("programa", "is", null);
    if (programas) {
      const canonicalSet = new Map();
      programas.forEach(p => { if (p.programa?.trim()) { const canon = normalizarPrograma(p.programa); if (canon) canonicalSet.set(canon, true); } });
      const unique = [...canonicalSet.keys()].sort();
      const defaults = DEFAULT_PROGRAMAS.filter(p => !unique.some(u => u.toLowerCase() === p.toLowerCase()));
      setProgramasDisponibles(["todos", ...unique, ...defaults]);
    }
  };

  const fetchHorarios = async () => {
    setLoading(true);
    let query = supabase.from("horarios").select("*");
    if (selectedPrograma !== "todos") query = query.eq("programa", selectedPrograma);
    const { data: horarios, error } = await query.order("id", { ascending: true });
    if (error) { console.error(error); setError(error.message); }
    else setData(horarios || []);
    setLoading(false);
  };

  const fetchDocenteNames = async () => {
    const { data: docentes } = await supabase.from("docentes").select("*");
    if (docentes) { const m = {}; docentes.forEach(d => { m[d.nombre_raw] = d.nombre_display; }); setDocenteNames(m); }
  };

  const fetchMateriaNames = async () => {
    const { data: materias } = await supabase.from("materias").select("*");
    if (materias) { const m = {}; materias.forEach(d => { m[d.nombre_raw] = d.nombre_display; }); setMateriaNames(m); }
  };

  useEffect(() => { fetchProgramas(); fetchDocenteNames(); fetchMateriaNames(); }, []);
  useEffect(() => { fetchHorarios(); }, [selectedPrograma]);

  const showToast = useCallback((message, type = "success") => { setToast(null); setTimeout(() => setToast({ message, type }), 50); }, []);

  const unifyName = async (tableName, rawName, newDisplayName) => {
    const { data: existing } = await supabase.from(tableName).select("nombre_raw, nombre_display").ilike("nombre_display", newDisplayName.trim()).neq("nombre_raw", rawName).limit(1);
    if (existing?.length > 0) {
      const { nombre_raw: targetRaw, nombre_display: canonicalDisplay } = existing[0];
      const { data: horarios } = await supabase.from("horarios").select("id, clase");
      if (horarios) for (const row of horarios) { if (!row.clase?.includes(rawName)) continue; const nc = row.clase.split(rawName).join(targetRaw); if (nc !== row.clase) await supabase.from("horarios").update({ clase: nc }).eq("id", row.id); }
      await supabase.from(tableName).delete().eq("nombre_raw", rawName);
      return { targetRaw, canonicalDisplay };
    }
    return null;
  };

  const saveDocenteName = async (rawName, displayName) => {
    try {
      const unified = await unifyName("docentes", rawName, displayName);
      if (unified) { showToast("✅ Docente unificado.", "success"); await fetchDocenteNames(); await fetchHorarios(); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("docentes").upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      setDocenteNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("✅ Docente actualizado.", "success"); return { success: true };
    } catch (err) { showToast("❌ Error: " + err.message, "error"); return { success: false }; }
  };

  const saveMateriaName = async (rawName, displayName) => {
    try {
      const unified = await unifyName("materias", rawName, displayName);
      if (unified) { showToast("✅ Materia unificada.", "success"); await fetchMateriaNames(); await fetchHorarios(); return { success: true, targetRaw: unified.targetRaw }; }
      await supabase.from("materias").upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      setMateriaNames(prev => ({ ...prev, [rawName]: displayName }));
      showToast("✅ Materia actualizada.", "success"); return { success: true };
    } catch (err) { showToast("❌ Error: " + err.message, "error"); return { success: false }; }
  };

  const clearAllData = async () => {
    if (!window.confirm("⚠️ ¿Eliminar TODOS los horarios?")) return;
    setLoading(true);
    let query = supabase.from("horarios").delete();
    if (selectedPrograma !== "todos") query = query.eq("programa", selectedPrograma); else query = query.neq("id", 0);
    const { error } = await query;
    if (error) showToast("❌ Error al borrar.", "error"); else { showToast("✅ Datos eliminados.", "success"); await fetchHorarios(); await fetchProgramas(); }
    setLoading(false);
  };

  const handleFileUpload = async (file) => {
    setUploading(true); setError(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const workbook = XLSX.read(e.target.result, { type: "binary" });
      const allRows = [];
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        let headerRowIdx = -1, horaColIdx = -1;
        let diaCols = { LUNES: -1, MARTES: -1, MIÉRCOLES: -1, JUEVES: -1, VIERNES: -1 };
        for (let i = 0; i < json.length; i++) { const row = json[i]; if (!row) continue; const horaIdx = row.findIndex(cell => cell?.toString().trim().toUpperCase() === "HORA"); if (horaIdx !== -1) { headerRowIdx = i; horaColIdx = horaIdx; for (let j = 0; j < row.length; j++) { const cell = row[j]?.toString().toUpperCase().trim(); if (cell === "LUNES") diaCols.LUNES = j; else if (cell === "MARTES") diaCols.MARTES = j; else if (cell === "MIÉRCOLES") diaCols.MIÉRCOLES = j; else if (cell === "JUEVES") diaCols.JUEVES = j; else if (cell === "VIERNES") diaCols.VIERNES = j; } break; } }
        if (headerRowIdx === -1) continue;
        const merges = worksheet['!merges'] || [];
        const mergeMap = {};
        merges.forEach(merge => { for (let r = merge.s.r; r <= merge.e.r; r++) for (let c = merge.s.c; c <= merge.e.c; c++) mergeMap[`${r}-${c}`] = { sr: merge.s.r, er: merge.e.r, sc: merge.s.c, ec: merge.e.c }; });
        let programa = "", trayecto = "", seccion = "", turno = "", sede = "", aula = "";
        for (let i = 0; i < headerRowIdx; i++) { const row = json[i]; if (!row) continue; for (let j = 0; j < row.length; j++) { const cv = row[j]?.toString().trim(); if (!cv) continue; if (cv === "PROGRAMA" && !programa) programa = row[j+1]?.toString().trim() || ""; else if (cv === "TRAYECTO" && !trayecto) trayecto = row[j+1]?.toString().trim() || ""; else if (cv === "Sede:" && !sede) sede = row[j+1]?.toString().trim() || ""; else if (cv === "AULA" && !aula) aula = row[j+1]?.toString().trim() || ""; else if (cv === "Sección" && !seccion) seccion = row[j+1]?.toString().trim() || row[j+2]?.toString().trim() || ""; else if (cv === "Turno" && !turno) turno = row[j+1]?.toString().trim() || row[j+2]?.toString().trim() || ""; } }
        programa = selectedPrograma !== "todos" ? selectedPrograma : (programa ? normalizarPrograma(programa) || programa : "Sin programa");
        turno = getTurnoByCodigo(sheetName) || normalizeTurno(turno) || turno;
        const processedMerges = new Set();
        for (let i = headerRowIdx + 1; i < json.length; i++) { const row = json[i]; if (!row) continue; for (const [dia, colIdx] of Object.entries(diaCols)) { if (colIdx === -1) continue; const clase = row[colIdx]?.toString().trim(); if (!clase) continue; const merge = mergeMap[`${i}-${colIdx}`]; if (merge && processedMerges.has(`${merge.sr}-${merge.sc}`)) continue; let horaCompleta = ""; if (merge) { processedMerges.add(`${merge.sr}-${merge.sc}`); const fr = json[merge.sr], lr = json[merge.er]; const hi = fr[horaColIdx]?.toString().trim().split(/[-–]/)[0]?.trim(); const hf = lr[horaColIdx]?.toString().trim().split(/[-–]/)[1]?.trim() || lr[horaColIdx]?.toString().trim().split(/[-–]/)[0]?.trim(); horaCompleta = hf ? `${hi} - ${hf}` : hi; } else horaCompleta = row[horaColIdx]?.toString().trim() || ""; if (!horaCompleta) continue; allRows.push({ sheet: sheetName, programa, trayecto, seccion, turno, sede, aula: aula || null, dia, hora: horaCompleta, clase }); } }
      }
      if (!allRows.length) { setError("No se encontraron datos válidos."); setUploading(false); return; }
      const { data: existingData } = await supabase.from("horarios").select("sheet, dia, hora, clase, programa");
      const existingKeys = new Set(existingData?.map(r => `${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`) || []);
      const newRows = allRows.filter(r => !existingKeys.has(`${r.sheet}|${r.dia}|${r.hora}|${r.clase}|${r.programa}`));
      if (!newRows.length) { showToast("⚠️ Sin registros nuevos.", "warning"); setUploading(false); return; }
      const { error: insertError } = await supabase.from("horarios").insert(newRows);
      if (insertError) showToast("❌ Error al guardar.", "error");
      else { showToast(`✅ ${newRows.length} clases cargadas.`, "success"); await fetchHorarios(); await fetchProgramas(); const docs = new Set(), mats = new Set(); newRows.forEach(r => { const { docente, materia } = parseClase(r.clase); if (docente) docs.add(docente); if (materia) mats.add(materia); }); for (const d of docs) await supabase.from("docentes").upsert({ nombre_raw: d, nombre_display: d }, { onConflict: "nombre_raw" }); for (const m of mats) await supabase.from("materias").upsert({ nombre_raw: m, nombre_display: m }, { onConflict: "nombre_raw" }); await fetchDocenteNames(); await fetchMateriaNames(); }
      setUploading(false);
    };
    reader.onerror = () => { setError("Error al leer el archivo."); setUploading(false); };
    reader.readAsBinaryString(file);
  };

  const filtered = useMemo(() => data.filter(d => (selectedTrayecto === "all" || d.trayecto === selectedTrayecto) && (selectedSeccion === "all" || d.sheet.trim() === selectedSeccion) && (activeDay === "all" || d.dia === activeDay)), [data, selectedTrayecto, selectedSeccion, activeDay]);
  const byDocente = useMemo(() => { const m = {}; data.forEach(d => { const { docente } = parseClase(d.clase); if (docente) { if (!m[docente]) m[docente] = []; m[docente].push(d); } }); return m; }, [data]);
  const byMateria = useMemo(() => { const m = {}; data.forEach(d => { const { materia } = parseClase(d.clase); if (materia) { if (!m[materia]) m[materia] = []; m[materia].push(d); } }); return m; }, [data]);
  const conflicts = useMemo(() => { const issues = []; Object.entries(byDocente).forEach(([doc, entries]) => { DAYS.forEach(day => { [...new Set(entries.map(e => e.hora?.trim()))].filter(Boolean).forEach(hora => { const matches = entries.filter(e => e.dia === day && e.hora?.trim() === hora); if (matches.length > 1) issues.push({ docente: doc, dia: day, hora, entries: matches }); }); }); }); return issues; }, [byDocente]);
  const allTrayectos = useMemo(() => [...new Set(data.map(d => d.trayecto))].sort((a, b) => ALL_TRAYECTOS.indexOf(a) - ALL_TRAYECTOS.indexOf(b)), [data]);
  const seccionesByTrayecto = useMemo(() => [...new Set(data.map(d => d.sheet.trim()))].sort().filter(s => selectedTrayecto === "all" || data.some(d => d.sheet.trim() === s && d.trayecto === selectedTrayecto)), [selectedTrayecto, data]);
  const stats = useMemo(() => ({ total: data.length, secciones: new Set(data.map(d => d.sheet.trim())).size, docentes: Object.keys(byDocente).length, materias: Object.keys(byMateria).length }), [data, byDocente, byMateria]);
  const getDocName = useCallback((raw) => docenteNames[raw] || raw, [docenteNames]);
  const getMateriaName = useCallback((raw) => materiaNames[raw] || raw, [materiaNames]);
  const handleNavigate = (r) => { if (r.docente) { setDocenteNav(r.rawDocente || r.docente); setView("docentes"); } else if (r.materia) { setMateriaNav(r.rawMateria); setView("materias"); } else setView("horarios"); };
  const nav = NAV_ITEMS.map(item => ({ ...item, badge: item.hasBadge ? conflicts.length : 0 }));

  if (user === undefined) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", color: "#94A3B8", fontFamily: "system-ui, sans-serif", fontSize: 15 }}>Verificando sesión…</div>;
  if (!user) return <LoginScreen />;
  if (loading && !data.length) return <div style={{ padding: 20, textAlign: "center", fontSize: 15, fontWeight: 500 }}>Cargando horarios...</div>;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", background: "#F3F4F6", overflow: "hidden" }}>
      <ResponsiveStyles />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} style={{ display: "none", position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 299 }} />
      <aside className={`sidebar-aside${sidebarOpen ? " open" : ""}`} style={{ width: 220, background: "#111827", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>PNF</div>
          <select value={selectedPrograma} onChange={e => setSelectedPrograma(e.target.value)} style={{ ...S.select, width: "100%", background: "#1F2937", color: "#fff", borderColor: "#374151", marginBottom: 12 }}>
            {programasDisponibles.map(p => <option key={p} value={p}>{p === "todos" ? "📋 Todos los programas" : p}</option>)}
          </select>
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#1F2937", borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 12, color: "#9CA3AF" }}>Clases</span><span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{stats.total}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 12, color: "#9CA3AF" }}>Secciones</span><span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{stats.secciones}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#9CA3AF" }}>Docentes</span><span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{stats.docentes}</span></div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "8px 10px", overflowY: "auto" }}>
          {nav.map(item => (
            <button key={item.id} onClick={() => { setView(item.id); setSidebarOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", border: "none", borderRadius: 8, background: view === item.id ? "#2563EB" : "transparent", color: view === item.id ? "#fff" : "#9CA3AF", cursor: "pointer", fontSize: 14, textAlign: "left", marginBottom: 2, fontWeight: view === item.id ? 600 : 400 }}>
              <span style={{ fontSize: 15 }}>{item.emoji}</span><span style={{ flex: 1 }}>{item.label}</span>
              {item.badge > 0 && <span style={{ background: "#EF4444", color: "#fff", borderRadius: 10, fontSize: 11, padding: "2px 7px", fontWeight: 700 }}>{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div style={{ padding: "12px 14px", borderTop: "1px solid #1F2937" }}>
          <label htmlFor="upload-excel" style={{ display: "block", cursor: "pointer", background: "#2563EB", color: "#fff", textAlign: "center", padding: "7px 12px", borderRadius: 6, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📂 Cargar Excel</label>
          <input id="upload-excel" type="file" accept=".xlsx, .xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }} disabled={uploading} />
          <button onClick={clearAllData} disabled={loading || !data.length} style={{ display: "block", width: "100%", cursor: data.length ? "pointer" : "not-allowed", background: "#DC2626", color: "#fff", textAlign: "center", padding: "7px 12px", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "none", opacity: data.length ? 1 : 0.5 }}>🗑️ Borrar datos</button>
          {uploading && <div style={{ fontSize: 11, marginTop: 6, color: "#9CA3AF" }}>Subiendo...</div>}
          {error && <div style={{ fontSize: 11, marginTop: 6, color: "#EF4444" }}>{error}</div>}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid #1F2937", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#2563EB,#7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{user.email?.[0]?.toUpperCase() ?? "A"}</div>
          <div style={{ flex: 1, overflow: "hidden" }}><div style={{ fontSize: 12, color: "#D1D5DB", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div></div>
          <button onClick={handleLogout} title="Cerrar sesión" style={{ background: "none", border: "1px solid #374151", borderRadius: 6, cursor: "pointer", color: "#6B7280", fontSize: 14, padding: "3px 7px", flexShrink: 0 }}>⏏</button>
        </div>
      </aside>
      <div className="main-content" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header className="header-bar" style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen(o => !o)} className="hamburger-btn" style={{ display: "none", background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 18, color: "#374151", flexShrink: 0 }}>☰</button>
          <GlobalSearch onNavigate={handleNavigate} docenteNames={docenteNames} materiaNames={materiaNames} data={data} />
          <div className="header-stats" style={{ marginLeft: "auto", fontSize: 13, color: "#6B7280", fontWeight: 500 }}>{stats.total} registros · {stats.materias} materias</div>
        </header>
        <main style={{ flex: 1, overflow: "auto" }}>
          {view === "horarios" && <HorariosView filtered={filtered} selectedTrayecto={selectedTrayecto} setSelectedTrayecto={setSelectedTrayecto} selectedSeccion={selectedSeccion} setSelectedSeccion={setSelectedSeccion} activeDay={activeDay} setActiveDay={setActiveDay} seccionesByTrayecto={seccionesByTrayecto} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} allTrayectos={allTrayectos} />}
          {view === "secciones" && <SeccionesView data={data} getDocName={getDocName} getMateriaName={getMateriaName} />}
          {view === "docentes" && <DocentesView byDocente={byDocente} conflicts={conflicts} initialSel={docenteNav} onConsumeNav={() => setDocenteNav(null)} getDocName={getDocName} onSaveDocenteName={saveDocenteName} />}
          {view === "materias" && <MateriasView byMateria={byMateria} initialSel={materiaNav} onConsumeNav={() => setMateriaNav(null)} getMateriaName={getMateriaName} onSaveMateriaName={saveMateriaName} data={data} getDocName={getDocName} />}
          {view === "asistencias" && <AsistenciasView data={data} getDocName={getDocName} getMateriaName={getMateriaName} />}
          {view === "conflictos" && <ConflictosView conflicts={conflicts} onGoDocente={(d) => { setDocenteNav(d); setView("docentes"); }} getDocName={getDocName} />}
          {view === "estadisticas" && <EstadisticasView stats={stats} byDocente={byDocente} byMateria={byMateria} data={data} getDocName={getDocName} getMateriaName={getMateriaName} />}
        </main>
      </div>
    </div>
  );
}
