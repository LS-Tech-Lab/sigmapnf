import { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabase";
import LoginScreen from "./components/LoginScreen";

// ========== Constantes globales ==========
const DAYS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];
const ALL_TRAYECTOS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"];
const DEFAULT_PROGRAMAS = ["PNF Informática", "PNF Contaduría Pública", "PNF Agroalimentación", "PNF Educación Especial"];

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

// ========== SISTEMA HORARIO UNIFICADO ==========
// Bloques fijos de 45 minutos — ÚNICA fuente de verdad
const BLOQUES_DIURNO = [
  { inicio: "7:30AM",  fin: "8:15AM",  label: "7:30 – 8:15 AM"  },
  { inicio: "8:15AM",  fin: "9:00AM",  label: "8:15 – 9:00 AM"  },
  { inicio: "9:00AM",  fin: "9:45AM",  label: "9:00 – 9:45 AM"  },
  { inicio: "9:45AM",  fin: "10:30AM", label: "9:45 – 10:30 AM" },
  { inicio: "10:30AM", fin: "11:15AM", label: "10:30 – 11:15 AM"},
  { inicio: "11:15AM", fin: "12:00PM", label: "11:15 AM – 12:00 PM"},
];
const BLOQUES_VESPERTINO = [
  { inicio: "1:00PM",  fin: "1:45PM",  label: "1:00 – 1:45 PM"  },
  { inicio: "1:45PM",  fin: "2:30PM",  label: "1:45 – 2:30 PM"  },
  { inicio: "2:30PM",  fin: "3:15PM",  label: "2:30 – 3:15 PM"  },
  { inicio: "3:15PM",  fin: "4:00PM",  label: "3:15 – 4:00 PM"  },
  { inicio: "4:00PM",  fin: "4:45PM",  label: "4:00 – 4:45 PM"  },
  { inicio: "4:45PM",  fin: "5:30PM",  label: "4:45 – 5:30 PM"  },
];

// Convierte "7:30AM", "1:00PM", etc. a minutos desde medianoche
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

// Detecta el turno de una sección por su penúltimo dígito.
// Ej: "4512121" → penúltimo = '2' → VESPERTINO
//     "4512111" → penúltimo = '1' → DIURNO
function getTurnoByCodigo(sheetName) {
  if (!sheetName) return null;
  const digits = sheetName.replace(/\D/g, ""); // sólo dígitos
  if (digits.length < 2) return null;
  const penultimo = digits[digits.length - 2];
  if (penultimo === "1") return "DIURNO";
  if (penultimo === "2") return "VESPERTINO";
  return null;
}

// Normaliza el campo turno desde el Excel (matutino → DIURNO, vespetino → VESPERTINO, etc.)
function normalizeTurno(t) {
  if (!t) return null;
  const u = t.toUpperCase().trim();
  if (u === "MATUTINO" || u === "DIURNO") return "DIURNO";
  if (u === "VESPETINO" || u === "VESPERTINO") return "VESPERTINO";
  return null;
}

// Detecta turno a partir del texto de hora (fallback cuando no hay código ni campo turno)
function getTurnoFromHora(horaStr) {
  const raw = horaStr ? horaStr.replace(/\s/g, "").split(/[-–]/)[0] : "";
  const min = timeToMin(raw);
  if (min >= timeToMin("7:00AM") && min <= timeToMin("12:00PM")) return "DIURNO";
  if (min >= timeToMin("1:00PM") && min <= timeToMin("5:30PM")) return "VESPERTINO";
  return null;
}

// FUNCIÓN PRINCIPAL: obtiene el turno de un registro usando las 3 fuentes en orden de prioridad:
// 1. Código de sección (penúltimo dígito)  2. Campo turno  3. Hora de inicio
function getTurnoDeRegistro(d) {
  return getTurnoByCodigo(d.sheet) || normalizeTurno(d.turno) || getTurnoFromHora(d.hora) || "DIURNO";
}

// Obtiene los bloques correctos según el turno
function getBloquesForTurno(turno) {
  return turno === "VESPERTINO" ? BLOQUES_VESPERTINO : BLOQUES_DIURNO;
}

// Dado un string de hora del Excel (ej: "7:30AM - 9:45AM" o "7:30AM"),
// devuelve el índice del bloque de inicio más cercano en los bloques dados
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

// Cuenta cuántos bloques de 45 min abarca una clase dado su string de hora
function countBlocks(horaStr) {
  const parts = horaStr ? horaStr.replace(/\s/g, "").split(/[-–]/) : [];
  if (parts.length < 2) return 1;
  const inicioMin = timeToMin(parts[0]);
  const finMin = timeToMin(parts[1]);
  if (!finMin || finMin <= inicioMin) return 1;
  return Math.max(1, Math.round((finMin - inicioMin) / 45));
}


// FUNCIÓN PRINCIPAL para mostrar hora: dado un registro, devuelve string legible del rango
function getHoraDisplayDeRegistro(d) {
  if (!d || !d.hora) return "—";
  const turno = getTurnoDeRegistro(d);
  const bloques = getBloquesForTurno(turno);
  const sb = findStartBlock(bloques, d.hora);
  const span = countBlocks(d.hora);
  const endIdx = Math.min(sb + span - 1, bloques.length - 1);
  if (!bloques[sb] || !bloques[endIdx]) return d.hora;
  return `${bloques[sb].inicio.replace("AM"," AM").replace("PM"," PM")} – ${bloques[endIdx].fin.replace("AM"," AM").replace("PM"," PM")}`;
}

// Orden numérico de un registro para ordenar por hora
function getHoraMin(d) {
  const turno = getTurnoDeRegistro(d);
  const bloques = getBloquesForTurno(turno);
  const sb = findStartBlock(bloques, d.hora);
  return timeToMin(bloques[sb].inicio);
}

function parseClase(clase) {
  const parts = clase.trim().split(/\s+(?:Profes?\.?|Prof\.?)\s+/i);
  const materia = parts[0].trim();
  const docente = parts[1] ? parts[1].trim() : "";
  return { materia, docente };
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

// Normaliza un nombre de programa a Title Case canónico para deduplicar variantes
// "PNF EN INFORMATICA" → "PNF Informática", etc.
const PROGRAMA_ALIASES = {
  "informatica": "PNF Informática",
  "informática": "PNF Informática",
  "contaduria": "PNF Contaduría Pública",
  "contaduría": "PNF Contaduría Pública",
  "agroalimentacion": "PNF Agroalimentación",
  "agroalimentación": "PNF Agroalimentación",
  "educacion especial": "PNF Educación Especial",
  "educación especial": "PNF Educación Especial",
};

function normalizarPrograma(raw) {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase()
    .replace(/pnf\s+(en\s+)?/i, "")  // quita "PNF " o "PNF EN "
    .trim();
  for (const [key, canonical] of Object.entries(PROGRAMA_ALIASES)) {
    if (lower.includes(key)) return canonical;
  }
  // Fallback: Title Case
  return raw.trim().replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}


function Avatar({ name, size = 36 }) {
  const safeName = name || "Docente";
  const initials = typeof safeName === "string"
    ? safeName.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?"
    : "??";
  const hue = typeof safeName === "string"
    ? [...safeName].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
    : 0;
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

function GlobalSearch({ onNavigate, docenteNames, materiaNames, data }) {
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
      const materiaDisplay = materiaNames[materia] || materia;
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

function TurnoGrid({ bloques, turnoLabel, filtered, days, expandedCell, setExpandedCell, getDocName, getMateriaName }) {
  const cellMap = useMemo(() => {
    const map = {};
    days.forEach(day => {
      map[day] = {};
      const occupied = {};
      bloques.forEach((bloque, bi) => {
        if (occupied[bi]) { map[day][bi] = "skip"; return; }
        const entries = filtered.filter(d => {
          if (d.dia !== day) return false;
          const turno = getTurnoDeRegistro(d);
          if (turno !== turnoLabel) return false;
          const sb = findStartBlock(bloques, d.hora);
          return sb === bi;
        });
        if (entries.length === 0) { map[day][bi] = null; return; }
        let span = 1;
        entries.forEach(e => { const s = countBlocks(e.hora); if (s > span) span = s; });
        span = Math.min(span, bloques.length - bi);
        map[day][bi] = { entries, span };
        for (let k = bi + 1; k < bi + span; k++) occupied[k] = true;
      });
    });
    return map;
  }, [bloques, days, filtered, turnoLabel]);

  // Altura base por bloque en px (45 min → 48px compacto)
  const ROW_H = 48;

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      {/* Header del turno */}
      <div style={{
        padding: "7px 14px",
        background: turnoLabel === "DIURNO" ? "#EFF6FF" : "#FDF2F8",
        borderBottom: "1px solid #E5E7EB",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 13 }}>{turnoLabel === "DIURNO" ? "☀️" : "🌙"}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: turnoLabel === "DIURNO" ? "#1D4ED8" : "#BE185D" }}>
          {turnoLabel === "DIURNO" ? "Turno Diurno" : "Turno Vespertino"}
        </span>
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>
          {turnoLabel === "DIURNO" ? "7:30 AM – 12:00 PM" : "1:00 PM – 5:30 PM"}
        </span>
      </div>

      <div className="turno-grid-wrapper" style={{ overflowX: "auto" }}>
        <table className="turno-grid-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 520 }}>
          <colgroup>
            <col style={{ width: 90 }} />
            {days.map(d => <col key={d} />)}
          </colgroup>
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              <th style={{ ...S.th, padding: "6px 10px", fontSize: 10, width: 90 }}>Hora</th>
              {days.map(d => (
                <th key={d} style={{ ...S.th, padding: "6px 10px", fontSize: 11, borderLeft: "1px solid #E5E7EB", textAlign: "center" }}>
                  {d.charAt(0) + d.slice(1).toLowerCase()}
                </th>
              ))}
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
              // Label compacto: solo hora de inicio
              const horaInicio = bloque.inicio.replace("AM", " AM").replace("PM", " PM");
              const horaFin = bloque.fin.replace("AM", " AM").replace("PM", " PM");
              return (
                <tr key={bi} style={{ height: ROW_H }}>
                  {/* Columna de hora — muy compacta */}
                  <td style={{
                    padding: "3px 8px", fontSize: 10, fontWeight: 600, color: "#9CA3AF",
                    background: rowBg, verticalAlign: "middle", whiteSpace: "nowrap",
                    borderTop: "1px solid #F0F0F0", lineHeight: 1.3,
                  }}>
                    <div style={{ color: "#6B7280", fontWeight: 700 }}>{horaInicio}</div>
                    <div style={{ color: "#D1D5DB", fontSize: 9 }}>{horaFin}</div>
                  </td>

                  {cells.map((cell, ci) => {
                    const day = days[ci];
                    if (cell.skip) return null;
                    const cellKey = `${turnoLabel}__${bi}__${day}`;
                    const isExp = expandedCell === cellKey;

                    if (cell.empty) {
                      return (
                        <td key={day} style={{
                          padding: "3px 4px", borderTop: "1px solid #F0F0F0",
                          borderLeft: "1px solid #F0F0F0", background: rowBg,
                        }} />
                      );
                    }

                    const { entries, span } = cell.data;
                    return (
                      <td key={day} rowSpan={span} style={{
                        padding: "3px 4px", borderTop: "1px solid #F0F0F0",
                        borderLeft: "1px solid #F0F0F0", verticalAlign: "top",
                        height: span * ROW_H,
                      }}>
                        {entries.map((e, i) => {
                          const { materia: rawMateria, docente: rawDoc } = parseClase(e.clase);
                          const materia = getMateriaName(rawMateria);
                          const docente = getDocName(rawDoc);
                          const bg = TRAYECTO_BG[e.trayecto] || "#f0f0f0";
                          const col = TRAYECTO_COLORS[e.trayecto] || "#555";
                          const horaDisplay = getHoraDisplayDeRegistro(e);
                          return (
                            <div
                              key={i}
                              onClick={() => setExpandedCell(isExp ? null : cellKey)}
                              style={{
                                background: bg,
                                borderLeft: `3px solid ${col}`,
                                borderRadius: 5,
                                padding: isExp ? "5px 7px" : "3px 6px",
                                marginBottom: i < entries.length - 1 ? 2 : 0,
                                cursor: "pointer",
                                transition: "box-shadow 0.12s",
                                boxShadow: isExp ? `0 0 0 1.5px ${col}55` : "none",
                                height: !isExp && span > 0 ? `calc(${span * ROW_H - 8}px / ${entries.length})` : "auto",
                                minHeight: 28,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                overflow: "hidden",
                              }}
                            >
                              {/* Materia */}
                              <div style={{ fontSize: 13, fontWeight: 700, color: col, lineHeight: 1.2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                                {materia}
                              </div>
                              {/* Docente — nombre completo */}
                              {docente && (
                                <div style={{ fontSize: 12, color: col, opacity: 0.75, lineHeight: 1.1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                                  {docente}
                                </div>
                              )}
                              {/* Panel expandido */}
                              {isExp && (
                                <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${col}25`, fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
                                  <div style={{ color: col, opacity: 0.9 }}>📂 {e.sheet.trim()} · T.{e.trayecto}</div>
                                  <div style={{ color: col, opacity: 0.9 }}>⏰ {horaDisplay}</div>
                                  <div style={{ color: col, opacity: 0.9 }}>🏫 {e.aula || "Sin aula"}</div>
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

function HorariosView({ filtered, selectedTrayecto, setSelectedTrayecto, selectedSeccion, setSelectedSeccion, activeDay, setActiveDay, seccionesByTrayecto, expandedCell, setExpandedCell, getDocName, getMateriaName, allTrayectos }) {
  const days = activeDay === "all" ? DAYS : [activeDay];

  const filteredDiurno = filtered.filter(d => getTurnoDeRegistro(d) === "DIURNO");
  const filteredVesp   = filtered.filter(d => getTurnoDeRegistro(d) === "VESPERTINO");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="horarios-filters" style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #E5E7EB", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#111827", marginRight: 4 }}>📅 Horarios</h1>
        <select value={selectedTrayecto} onChange={e => { setSelectedTrayecto(e.target.value); setSelectedSeccion("all"); }} style={S.select}>
          <option value="all">Todos los trayectos</option>
          {allTrayectos.map(t => <option key={t} value={t}>Trayecto {t}</option>)}
        </select>
        <select value={selectedSeccion} onChange={e => setSelectedSeccion(e.target.value)} style={S.select}>
          <option value="all">Todas las secciones</option>
          {seccionesByTrayecto.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 13, color: "#9CA3AF", marginLeft: "auto" }}>{filtered.length} clases</span>
      </div>
      <div className="day-buttons" style={{ padding: "10px 20px", background: "#fff", borderBottom: "1px solid #F3F4F6", display: "flex", gap: 6 }}>
        {["all", ...DAYS].map(d => (<button key={d} onClick={() => setActiveDay(d)} style={S.btn(activeDay === d)}>{d === "all" ? "Semana completa" : d.charAt(0) + d.slice(1).toLowerCase()}</button>))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {filteredDiurno.length > 0 && (
          <TurnoGrid bloques={BLOQUES_DIURNO} turnoLabel="DIURNO" filtered={filteredDiurno} days={days} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} />
        )}
        {filteredVesp.length > 0 && (
          <TurnoGrid bloques={BLOQUES_VESPERTINO} turnoLabel="VESPERTINO" filtered={filteredVesp} days={days} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} />
        )}
        {filtered.length === 0 && (
          <div style={{ ...S.card, padding: "60px 20px", textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>
            No hay clases para los filtros seleccionados.
          </div>
        )}
      </div>
    </div>
  );
}

function SeccionesView({ data, getDocName, getMateriaName }) {
  const allSecciones = useMemo(() => [...new Set(data.map(d => d.sheet.trim()))].sort(), [data]);
  const [selSheet, setSelSheet] = useState(null);
  const [filterTray, setFilterTray] = useState("all");

  // Sincronizar selección cuando allSecciones cambia (carga inicial o cambio de programa)
  useEffect(() => {
    if (allSecciones.length > 0 && (!selSheet || !allSecciones.includes(selSheet))) {
      setSelSheet(allSecciones[0]);
    }
  }, [allSecciones]);

  const filteredSecciones = useMemo(() =>
    filterTray === "all" ? allSecciones : allSecciones.filter(s => data.find(d => d.sheet.trim() === s)?.trayecto === filterTray),
    [filterTray, allSecciones, data]);

  const entries = useMemo(() => data.filter(d => d.sheet.trim() === selSheet), [data, selSheet]);
  const info = entries[0];

  const byDay = useMemo(() => DAYS.reduce((acc, day) => {
    acc[day] = entries.filter(e => e.dia === day).sort((a, b) => getHoraMin(a) - getHoraMin(b));
    return acc;
  }, {}), [entries]);

  return (
    <div className="secciones-layout" style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div className="secciones-left-panel" style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)" }}>{DAYS.map(day => (<div key={day} style={{ padding: "10px 10px", borderRight: "1px solid #F3F4F6", minHeight: 120, verticalAlign: "top" }}>{(byDay[day] || []).map((e, i) => { const { materia: rawMateria, docente: rawDoc } = parseClase(e.clase); const materia = getMateriaName(rawMateria); const docente = getDocName(rawDoc); const col = TRAYECTO_COLORS[e.trayecto] || "#555"; const bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5"; return (<div key={i} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 5, padding: "5px 8px", marginBottom: 5 }}><div style={{ fontSize: 11, fontWeight: 600, color: col, lineHeight: 1.3 }}>{materia.length > 22 ? materia.slice(0, 20) + "…" : materia}</div><div style={{ fontSize: 10, color: col, opacity: 0.7, marginTop: 2 }}>{getHoraDisplayDeRegistro(e)}</div>{docente && <div style={{ fontSize: 10, color: col, opacity: 0.65, marginTop: 1 }}>{docente.split(" ")[0]}</div>}</div>); })}{byDay[day].length === 0 && (<div style={{ fontSize: 11, color: "#D1D5DB", textAlign: "center", marginTop: 20 }}>—</div>)}</div>))}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ========== DOCENTESVIEW CORREGIDA (sin errores de anidamiento) ==========
function DocentesView({ byDocente, conflicts, initialSel, onConsumeNav, docenteNames, setDocenteNames, getDocName, onSaveDocenteName }) {
  const sorted = Object.keys(byDocente).sort();
  const [sel, setSel] = useState(initialSel || null);
  const [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  
  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel, onConsumeNav]);
  useEffect(() => { if (sel) setEditValue(getDocName(sel)); }, [sel, getDocName]);

  useEffect(() => {
    if (sel && !byDocente[sel]) {
      const newSel = Object.keys(byDocente).find(k => {
        const name = getDocName(k);
        return name && editValue && name.toLowerCase() === editValue.trim().toLowerCase();
      });
      setSel(newSel || null);
    }
  }, [byDocente, sel, editValue, getDocName]);

  const hasConflict = (name) => conflicts.some(c => c.docente === name);
  const selEntries = byDocente[sel] || [];
  const selConflicts = sel ? conflicts.filter(c => c.docente === sel) : [];

  const filteredSorted = search ? sorted.filter(d => getDocName(d).toLowerCase().includes(search.toLowerCase())) : sorted;

  const docGrid = useMemo(() => {
    const map = {};
    selEntries.forEach(e => {
      const turno = getTurnoDeRegistro(e);
      const bloques = getBloquesForTurno(turno);
      const sb = findStartBlock(bloques, e.hora);
      const key = `${turno}__${sb}__${e.dia}`;
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return map;
  }, [selEntries]);

  // Bloques únicos usados por este docente (para la vista semanal)
  const usedBloques = useMemo(() => {
    const seen = new Set();
    const result = [];
    // Diurno primero, luego vespertino
    ["DIURNO", "VESPERTINO"].forEach(turno => {
      const bloques = getBloquesForTurno(turno);
      bloques.forEach((b, bi) => {
        const hasEntry = selEntries.some(e => {
          const t = getTurnoDeRegistro(e);
          return t === turno && findStartBlock(bloques, e.hora) === bi;
        });
        const key = `${turno}__${bi}`;
        if (hasEntry && !seen.has(key)) { seen.add(key); result.push({ turno, bi, bloque: b }); }
      });
    });
    return result;
  }, [selEntries]);
  
  const saveEdit = async () => { 
    const trimmed = editValue.trim(); 
    if (trimmed && sel) {
      setSaving(true);
      const res = await onSaveDocenteName(sel, trimmed);
      setSaving(false);
      if (res.success) {
        setEditingName(false);
        if (res.targetRaw) {
          setSel(res.targetRaw);
        }
      }
    } else {
      setEditingName(false);
    }
  };

  return (
    <div className="docentes-layout" style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      {/* Panel izquierdo: lista de docentes */}
      <div className="docentes-left-panel" style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar docente…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filteredSorted.length} docentes</div>
          {filteredSorted.map(d => (
            <div key={d} onClick={() => { setSel(d); setEditingName(false); }} style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, background: sel === d ? "#EFF6FF" : "transparent", color: sel === d ? "#1D4ED8" : "#374151", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: sel === d ? 600 : 400 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{hasConflict(d) && <span title="Tiene conflictos" style={{ fontSize: 14 }}>⚠️</span>}{getDocName(d)}</span>
              <span style={{ fontSize: 11, background: "#F3F4F6", borderRadius: 10, padding: "1px 7px", color: "#6B7280", fontWeight: 600 }}>{byDocente[d].length}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Panel derecho: detalles del docente seleccionado */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!sel ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9CA3AF", fontSize: 14 }}>Selecciona un docente para ver su horario</div>
        ) : (
          <div>
            {/* Tarjeta de información del docente */}
            <div style={{ ...S.card, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={getDocName(sel)} size={48} />
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus style={{ ...S.input, fontSize: 15, fontWeight: 600, flex: 1 }} />
                    <button onClick={saveEdit} disabled={saving} style={{ padding: "5px 12px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                      {saving ? "Guardando..." : "Guardar"}
                    </button>
                    <button onClick={() => setEditingName(false)} style={{ padding: "5px 10px", background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Cancelar</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>{getDocName(sel)}</div>
                    <button onClick={() => { setEditValue(getDocName(sel)); setEditingName(true); }} title="Editar nombre" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4 }}>✏️ Editar</button>
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>
                  {selEntries.length} clases asignadas
                  {selConflicts.length > 0 && (<span style={{ marginLeft: 10, ...S.badge("#FEF2F2", "#DC2626") }}>⚠️ {selConflicts.length} conflicto{selConflicts.length > 1 ? "s" : ""}</span>)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[...new Set(selEntries.map(e => e.trayecto))].map(t => (<span key={t} style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>T.{t}</span>))}
              </div>
            </div>

            {/* Conflictos (si los hay) */}
            {selConflicts.map((c, i) => (
              <div key={i} style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 16px", marginBottom: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#991B1B" }}>Conflicto: {c.dia.charAt(0) + c.dia.slice(1).toLowerCase()} · {c.entries[0] ? getHoraDisplayDeRegistro(c.entries[0]) : c.hora}</div>
                  <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 4 }}>{c.entries.map(e => parseClase(e.clase).materia).join(" · ")}</div>
                </div>
              </div>
            ))}

            {/* Vista semanal (tabla) */}
            {usedBloques.length > 0 && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E7EB", fontSize: 13, fontWeight: 600, color: "#374151" }}>Vista semanal</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ ...S.th, width: 160 }}>Bloque</th>
                        {DAYS.map(d => <th key={d} style={{ ...S.th, borderLeft: "1px solid #E5E7EB" }}>{d.slice(0, 3)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {usedBloques.map(({ turno, bi, bloque }, ri) => (
                        <tr key={`${turno}-${bi}`}>
                          <td style={{ ...S.td, fontSize: 11, color: "#9CA3AF", fontWeight: 600, background: ri % 2 === 0 ? "#fff" : "#FAFAFA", whiteSpace: "nowrap" }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: turno === "DIURNO" ? "#2563EB" : "#BE185D", marginRight: 4 }}>{turno === "DIURNO" ? "☀️" : "🌙"}</span>
                            {bloque.label}
                          </td>
                          {DAYS.map(day => {
                            const es = docGrid[`${turno}__${bi}__${day}`] || [];
                            return (
                              <td key={day} style={{ padding: "4px 6px", borderTop: "1px solid #F3F4F6", borderLeft: "1px solid #F3F4F6", background: ri % 2 === 0 ? "#fff" : "#FAFAFA", verticalAlign: "top" }}>
                                {es.map((e, i) => {
                                  const { materia } = parseClase(e.clase);
                                  const col = TRAYECTO_COLORS[e.trayecto] || "#555";
                                  const bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5";
                                  return (
                                    <div key={i} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 5, padding: "4px 7px" }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: col }}>{materia.length > 18 ? materia.slice(0, 16) + "…" : materia}</div>
                                      <div style={{ fontSize: 10, color: col, opacity: 0.7 }}>{e.sheet.trim()}</div>
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
            )}

            {/* Tabla detallada de asignaciones */}
            <div style={S.card}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Día", "Hora", "Materia", "Trayecto", "Sección"].map(h => (<th key={h} style={S.th}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {[...selEntries].sort((a, b) => DAYS.indexOf(a.dia) - DAYS.indexOf(b.dia) || getHoraMin(a) - getHoraMin(b)).map((e, i) => {
                    const { materia } = parseClase(e.clase);
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <td style={S.td}>{e.dia.charAt(0) + e.dia.slice(1).toLowerCase()}</td>
                        <td style={{ ...S.td, color: "#9CA3AF", whiteSpace: "nowrap", fontSize: 11 }}>{getHoraDisplayDeRegistro(e)}</td>
                        <td style={{ ...S.td, fontWeight: 500 }}>{materia}</td>
                        <td style={S.td}><span style={S.badge(TRAYECTO_BG[e.trayecto] || "#f3f4f6", TRAYECTO_COLORS[e.trayecto] || "#555")}>{e.trayecto}</span></td>
                        <td style={{ ...S.td, color: "#6B7280" }}>{e.sheet.trim()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MateriasView({ byMateria, initialSel, onConsumeNav, materiaNames, setMateriaNames, getMateriaName, onSaveMateriaName, data }) {
  const sorted = Object.keys(byMateria).sort();
  const [sel, setSel] = useState(initialSel || null);
  const [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  
  useEffect(() => { if (initialSel) { setSel(initialSel); onConsumeNav(); } }, [initialSel, onConsumeNav]);
  
  // Memorizar getMateriaName para evitar dependencias inestables
  const stableGetMateriaName = useCallback((raw) => getMateriaName(raw), [materiaNames]);
  
  useEffect(() => { 
    if (sel) {
      setEditValue(stableGetMateriaName(sel));
      // Verificar si la materia aún existe en byMateria
      if (!byMateria[sel]) {
        setSel(null);
      }
    }
  }, [sel, byMateria, stableGetMateriaName]);

  const selEntries = sel && byMateria[sel] ? byMateria[sel] : [];
  const filteredSorted = search ? sorted.filter(m => stableGetMateriaName(m).toLowerCase().includes(search.toLowerCase())) : sorted;

  const saveEdit = async () => { 
    const trimmed = editValue.trim(); 
    if (trimmed && sel) {
      setSaving(true);
      const res = await onSaveMateriaName(sel, trimmed);
      setSaving(false);
      if (res.success) {
        setEditingName(false);
        if (res.targetRaw) {
          setSel(res.targetRaw);
        }
      }
    } else {
      setEditingName(false);
    }
  };

  const asignaciones = useMemo(() => {
    return selEntries.slice().sort((a, b) => {
      const idxA = DAYS.indexOf(a.dia);
      const idxB = DAYS.indexOf(b.dia);
      return (idxA !== -1 ? idxA : 9) - (idxB !== -1 ? idxB : 9) || getHoraMin(a) - getHoraMin(b);
    });
  }, [selEntries]);

  return (
    <div className="materias-layout" style={{ padding: 20, display: "flex", gap: 16, height: "calc(100vh - 61px)", overflow: "hidden" }}>
      <div className="materias-left-panel" style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar materia…" style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
        <div style={{ ...S.card, flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>{filteredSorted.length} materias</div>
          {filteredSorted.map(m => (
            <div key={m} onClick={() => { setSel(m); setEditingName(false); }} style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, background: sel === m ? "#EFF6FF" : "transparent", color: sel === m ? "#1D4ED8" : "#374151", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: sel === m ? 600 : 400 }}>
              <span>{stableGetMateriaName(m)}</span>
              <span style={{ fontSize: 11, background: "#F3F4F6", borderRadius: 10, padding: "1px 7px", color: "#6B7280", fontWeight: 600 }}>{byMateria[m].length}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!sel ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9CA3AF", fontSize: 14 }}>Selecciona una materia para ver detalles</div>
        ) : (
          <>
            <div style={{ ...S.card, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={stableGetMateriaName(sel)} size={48} />
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingName(false); }} autoFocus style={{ ...S.input, fontSize: 15, fontWeight: 600, flex: 1 }} />
                    <button onClick={saveEdit} disabled={saving} style={{ padding: "5px 12px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                      {saving ? "Guardando..." : "Guardar"}
                    </button>
                    <button onClick={() => setEditingName(false)} style={{ padding: "5px 10px", background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Cancelar</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>{stableGetMateriaName(sel)}</div>
                    <button onClick={() => { setEditValue(stableGetMateriaName(sel)); setEditingName(true); }} title="Editar nombre" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4 }}>✏️ Editar</button>
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>
                  {selEntries.length} clases asignadas
                  {selEntries.length > 0 && (
                    <span style={{ marginLeft: 10, ...S.badge("#EFF6FF", "#2563EB") }}>
                      {new Set(selEntries.map(e => e.trayecto)).size} trayecto(s)
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div style={S.card}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E7EB", fontSize: 13, fontWeight: 600, color: "#374151" }}>📋 Asignaciones</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={S.th}>Día</th>
                    <th style={S.th}>Hora</th>
                    <th style={S.th}>Turno</th>
                    <th style={S.th}>Sección</th>
                    <th style={S.th}>Trayecto</th>
                    <th style={S.th}>Docente</th>
                  </tr>
                </thead>
                <tbody>
                  {asignaciones.map((e, i) => {
                    const turnoReal = getTurnoDeRegistro(e);
                    const { docente: rawDoc } = parseClase(e.clase);
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <td style={S.td}>{e.dia.charAt(0) + e.dia.slice(1).toLowerCase()}</td>
                        <td style={{ ...S.td, color: "#9CA3AF", whiteSpace: "nowrap", fontSize: 11 }}>{getHoraDisplayDeRegistro(e)}</td>
                        <td style={S.td}><span style={S.badge(turnoReal === "DIURNO" ? "#EFF6FF" : "#FDF2F8", turnoReal === "DIURNO" ? "#2563EB" : "#DB2777")}>{turnoReal === "DIURNO" ? "☀️ Diurno" : "🌙 Vespertino"}</span></td>
                        <td style={S.td}>{e.sheet ? e.sheet.trim() : ""}</td>
                        <td style={S.td}><span style={S.badge(TRAYECTO_BG[e.trayecto] || "#f3f4f6", TRAYECTO_COLORS[e.trayecto] || "#555")}>{e.trayecto}</span></td>
                        <td style={S.td}>{rawDoc ? getDocName(rawDoc) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function AsistenciasView({ data, getDocName, getMateriaName }) {
  const [turno, setTurno] = useState("DIURNO");
  const [selectedDay, setSelectedDay] = useState(DAYS[0]);

  const docentesDelDia = useMemo(() => {
    const map = {};
    data.filter(d => getTurnoDeRegistro(d) === turno && d.dia === selectedDay).forEach(d => {
      // turno ya se determina con getTurnoDeRegistro — la hora mostrada es la real del bloque
      const { docente, materia } = parseClase(d.clase);
      if (!docente) return;
      if (!map[docente]) map[docente] = { clases: [] };
      map[docente].clases.push({
        materia: getMateriaName(materia),
        hora: getHoraDisplayDeRegistro(d),
        horaMin: getHoraMin(d),
        seccion: d.sheet.trim(),
        trayecto: d.trayecto,
        aula: d.aula
      });
    });
    Object.values(map).forEach(v => { v.clases.sort((a, b) => a.horaMin - b.horaMin); });
    return Object.entries(map).sort((a, b) => getDocName(a[0]).localeCompare(getDocName(b[0])));
  }, [data, turno, selectedDay, getDocName, getMateriaName]);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) {
      alert("⚠️ El navegador bloqueó la ventana emergente. Permite popups para esta página e intenta de nuevo.");
      return;
    }
    const htmlContent = `
      <html>
        <head>
          <title>Asistencia Docentes - ${turno} - ${selectedDay}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; font-size: 11px; color: #000; }
            .page { padding: 20px; }
            h1 { font-size: 15px; margin-bottom: 4px; }
            .subtitle { font-size: 11px; color: #555; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th { background: #f0f0f0; border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
            td { border: 1px solid #ccc; padding: 6px 8px; font-size: 11px; vertical-align: top; }
            .docente-name { font-weight: bold; font-size: 12px; }
            .firma-box { width: 120px; height: 40px; border: 1px solid #999; }
          </style>
        </head>
        <body>
          <div class="page">
            <h1>Control de Asistencia Docentes</h1>
            <div class="subtitle">PNF en Informática · Cabimas - Sede Los Laureles · ${selectedDay.charAt(0) + selectedDay.slice(1).toLowerCase()} · Turno: ${turno === "DIURNO" ? "Diurno (7:30AM – 12:00PM)" : "Vespertino (1:00PM – 5:30PM)"} · 2-2026</div>
            <table>
              <thead>
                <tr>
                  <th style="width:30px">N°</th>
                  <th style="width:180px">Docente</th>
                  <th>Materia(s) / Sección(es)</th>
                  <th style="width:140px">Horario</th>
                  <th style="width:80px">Entrada</th>
                  <th style="width:80px">Salida</th>
                  <th style="width:120px">Firma</th>
                </tr>
              </thead>
              <tbody>
                ${docentesDelDia.map(([rawDoc, info], idx) => {
                  const displayName = getDocName(rawDoc);
                  return `
                    <tr>
                      <td style="text-align:center">${idx + 1}</td>
                      <td class="docente-name">${displayName}</td>
                      <td>${info.clases.map(c => `${c.materia} — ${c.seccion}`).join("<br>")}</td>
                      <td>${info.clases.map(c => c.hora).join("<br>")}</td>
                      <td><div class="firma-box"></div></td>
                      <td><div class="firma-box"></div></td>
                      <td><div class="firma-box"></div></td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
            <div style="margin-top:30px; display:flex; justify-content:space-between;">
              <div style="text-align:center; width:200px;"><div style="border-top:1px solid #000; margin-top:40px; padding-top:4px; font-size:10px;">Coordinador(a) Académico</div></div>
              <div style="text-align:center; width:200px;"><div style="border-top:1px solid #000; margin-top:40px; padding-top:4px; font-size:10px;">Secretaría</div></div>
            </div>
          </div>
        </body>
      </html>
    `;
    win.document.write(htmlContent);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}><h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>🖨️ Asistencias Diarias por Turno</h1></div>
      <div className="asistencias-filters" style={{ ...S.card, padding: "14px 20px", marginBottom: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase" }}>Turno</div><div style={{ display: "flex", gap: 6 }}>{["DIURNO", "VESPERTINO"].map(t => (<button key={t} onClick={() => setTurno(t)} style={{ ...S.btn(turno === t), borderRadius: 8 }}>{t === "DIURNO" ? "☀️ Diurno" : "🌙 Vespertino"}</button>))}</div></div>
        <div><div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase" }}>Día</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{DAYS.map(d => (<button key={d} onClick={() => setSelectedDay(d)} style={S.btn(selectedDay === d)}>{d.charAt(0) + d.slice(1).toLowerCase()}</button>))}</div></div>
        <div style={{ marginLeft: "auto" }}><button onClick={handlePrint} style={{ padding: "8px 18px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>🖨️ Imprimir / PDF</button></div>
      </div>
      <div style={S.card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}><div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Control de Asistencia Docentes</div><div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>PNF en Informática · Cabimas - Sede Los Laureles · {selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: {turno === "DIURNO" ? "Diurno (7:30AM – 12:00PM)" : "Vespertino (1:00PM – 5:30PM)"} · 2-2026</div></div>
        {docentesDelDia.length === 0 ? (<div style={{ padding: "40px 20px", textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>No hay docentes registrados para {turno.toLowerCase()} el {selectedDay.toLowerCase()}.</div>) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 36 }}>N°</th>
                <th style={{ ...S.th, width: 200 }}>Docente</th>
                <th style={S.th}>Materia(s) / Sección(es)</th>
                <th style={{ ...S.th, width: 150 }}>Horario</th>
                <th style={{ ...S.th, width: 80 }}>Entrada</th>
                <th style={{ ...S.th, width: 80 }}>Salida</th>
                <th style={{ ...S.th, width: 120 }}>Firma</th>
              </tr>
            </thead>
            <tbody>
              {docentesDelDia.map(([rawDoc, info], idx) => {
                const displayName = getDocName(rawDoc);
                return (
                  <tr key={rawDoc} style={{ background: idx % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                    <td style={{ ...S.td, textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>{idx + 1}</td>
                    <td style={S.td}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={displayName} size={28} /><span style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>{displayName}</span></div></td>
                    <td style={{ ...S.td, fontSize: 12 }}>
                      {info.clases.map((c, i) => (
                        <div key={i} style={{ marginBottom: i < info.clases.length - 1 ? 4 : 0 }}>
                          <span style={{ fontWeight: 500 }}>{c.materia}</span>
                          <span style={{ color: "#9CA3AF", marginLeft: 6 }}>— {c.seccion}</span>
                          {c.trayecto && (<span style={{ ...S.badge(TRAYECTO_BG[c.trayecto] || "#f3f4f6", TRAYECTO_COLORS[c.trayecto] || "#555"), marginLeft: 6 }}>T.{c.trayecto}</span>)}
                        </div>
                      ))}
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: "#6B7280", whiteSpace: "nowrap" }}>{info.clases.map((c, i) => (<div key={i} style={{ marginBottom: i < info.clases.length - 1 ? 4 : 0 }}>{c.hora}</div>))}</td>
                    <td style={{ ...S.td, border: "1px solid #E5E7EB" }}></td>
                    <td style={{ ...S.td, border: "1px solid #E5E7EB" }}></td>
                    <td style={{ ...S.td, border: "1px solid #E5E7EB", height: 44 }}></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
      {conflicts.length === 0 ? (
        <div style={{ ...S.card, padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#111827" }}>Sin conflictos</div>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 6 }}>No se detectaron solapamientos horarios.</div>
        </div>
      ) : (
        <>
          <div style={{ ...S.card, padding: "14px 18px", marginBottom: 20, background: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 20 }}>💡</span>
            <div style={{ fontSize: 13, color: "#92400E" }}><strong>Nota:</strong> Un conflicto ocurre cuando el mismo docente aparece asignado a dos grupos distintos en el mismo día y horario.</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {conflicts.map((c, i) => (
              <div key={i} style={{ ...S.card, borderLeft: "4px solid #EF4444", padding: "14px 18px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <button onClick={() => onGoDocente(c.docente)} style={{ fontSize: 14, fontWeight: 700, color: "#DC2626", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>{getDocName(c.docente)}</button>
                      <span style={{ fontSize: 13, color: "#6B7280" }}>— {c.dia.charAt(0) + c.dia.slice(1).toLowerCase()} · {c.entries[0] ? getHoraDisplayDeRegistro(c.entries[0]) : c.hora}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {c.entries.map((e, j) => {
                        const { materia } = parseClase(e.clase);
                        const col = TRAYECTO_COLORS[e.trayecto] || "#555";
                        const bg = TRAYECTO_BG[e.trayecto] || "#f5f5f5";
                        return (
                          <div key={j} style={{ background: bg, borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "6px 12px", fontSize: 12 }}>
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
        </>
      )}
    </div>
  );
}

function EstadisticasView({ stats, byDocente, byMateria, data, getDocName, getMateriaName }) {
  const trayectoCount = {};
  data.forEach(d => { trayectoCount[d.trayecto] = (trayectoCount[d.trayecto] || 0) + 1; });
  const dayCount = {};
  DAYS.forEach(d => { dayCount[d] = data.filter(r => r.dia === d).length; });
  const maxDay = Math.max(...Object.values(dayCount), 1);
  const top8Docentes = Object.entries(byDocente).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const maxLoadDocente = Math.max(...top8Docentes.map(([, e]) => e.length), 1);
  const topMaterias = Object.entries(byMateria).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  const maxMat = topMaterias[0]?.[1] || 1;
  const turnoCount = {};
  data.forEach(d => { turnoCount[d.turno] = (turnoCount[d.turno] || 0) + 1; });
  const totalClases = data.length;
  const seccionesCount = new Set(data.map(d => d.sheet.trim())).size;

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 700 }}>📊 Estadísticas</h1>
      <div className="stats-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard label="Total de clases" value={totalClases} icon="📅" color="#2563EB" />
        <StatCard label="Secciones" value={seccionesCount} icon="🏫" color="#059669" />
        <StatCard label="Docentes" value={stats.docentes} icon="👥" color="#7C3AED" />
        <StatCard label="Materias únicas" value={stats.materias} icon="📖" color="#D97706" />
      </div>
      <div className="stats-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Clases por trayecto</div>
          {Object.entries(trayectoCount).sort().map(([t, c]) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>{t}</span>
              <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}>
                <div style={{ width: `${(c / totalClases) * 100}%`, height: "100%", background: TRAYECTO_COLORS[t] || "#888", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 12, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{c}</span>
            </div>
          ))}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Distribución por día</div>
          {DAYS.map(d => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, width: 80, color: "#6B7280", fontWeight: 500 }}>{d.charAt(0) + d.slice(1).toLowerCase()}</span>
              <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}>
                <div style={{ width: `${(dayCount[d] / maxDay) * 100}%`, height: "100%", background: "#059669", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 12, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{dayCount[d]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="stats-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Docentes con mayor carga</div>
          {top8Docentes.map(([doc, entries], idx) => (
            <div key={doc} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#D1D5DB", width: 16 }}>{idx + 1}</span>
              <span style={{ fontSize: 12, flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getDocName(doc)}</span>
              <div style={{ width: 100, background: "#F3F4F6", borderRadius: 4, height: 10, overflow: "hidden" }}>
                <div style={{ width: `${(entries.length / maxLoadDocente) * 100}%`, height: "100%", background: "#7C3AED", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 12, width: 24, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{entries.length}</span>
            </div>
          ))}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Materias más frecuentes</div>
          {topMaterias.map(([mat, entries], idx) => {
            const cnt = entries.length;
            return (
              <div key={mat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#D1D5DB", width: 16 }}>{idx + 1}</span>
                <span style={{ fontSize: 12, flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={getMateriaName(mat)}>{getMateriaName(mat).length > 28 ? getMateriaName(mat).slice(0, 26) + "…" : getMateriaName(mat)}</span>
                <div style={{ width: 100, background: "#F3F4F6", borderRadius: 4, height: 10, overflow: "hidden" }}>
                  <div style={{ width: `${(cnt / maxMat) * 100}%`, height: "100%", background: "#D97706", borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 12, width: 24, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{cnt}</span>
              </div>
            );
          })}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Distribución por turno</div>
          {Object.entries(turnoCount).sort().map(([t, cnt]) => {
            const pct = totalClases > 0 ? Math.round((cnt / totalClases) * 100) : 0;
            const colors = { DIURNO: "#2563EB", VESPERTINO: "#DB2777" };
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 12, width: 90, color: "#6B7280", fontWeight: 500 }}>{t.charAt(0) + t.slice(1).toLowerCase()}</span>
                <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 14, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: colors[t] || "#888", borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, width: 60, textAlign: "right" }}>{cnt} ({pct}%)</span>
              </div>
            );
          })}
        </div>
        <div style={{ ...S.card, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Secciones por trayecto</div>
          {ALL_TRAYECTOS.map(t => {
            const cnt = [...new Set(data.filter(d => d.trayecto === t).map(d => d.sheet.trim()))].length;
            const pct = seccionesCount > 0 ? (cnt / seccionesCount) * 100 : 0;
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={S.badge(TRAYECTO_BG[t] || "#f3f4f6", TRAYECTO_COLORS[t] || "#555")}>{t}</span>
                <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 4, height: 12, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: TRAYECTO_COLORS[t] || "#888", borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 12, width: 32, textAlign: "right", color: "#6B7280", fontWeight: 600 }}>{cnt}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ========== Componente principal App ==========
// ========== Constante de navegación (fuera del componente para evitar recreación) ==========
const NAV_ITEMS = [
  { id: "horarios",     emoji: "📅", label: "Horarios" },
  { id: "secciones",   emoji: "🏫", label: "Secciones" },
  { id: "docentes",    emoji: "👥", label: "Docentes",    hasBadge: true },
  { id: "materias",    emoji: "📖", label: "Materias" },
  { id: "asistencias", emoji: "🖨️", label: "Asistencias" },
  { id: "conflictos",  emoji: "⚠️", label: "Conflictos",  hasBadge: true },
  { id: "estadisticas",emoji: "📊", label: "Estadísticas" },
];

// ========== RESPONSIVE STYLES ==========
const responsiveCSS = `
  @media (max-width: 768px) {
    .hamburger-btn { display: block !important; }
    .sidebar-aside { transform: translateX(-100%); position: fixed !important; z-index: 300; height: 100vh; transition: transform 0.25s ease; }
    .sidebar-aside.open { transform: translateX(0); }
    .sidebar-overlay { display: block !important; }
    .main-content { margin-left: 0 !important; }
    .horarios-filters { flex-wrap: wrap; gap: 6px !important; }
    .horarios-filters select { font-size: 12px !important; padding: 5px 8px !important; }
    .day-buttons { overflow-x: auto; flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
    .day-buttons button { flex-shrink: 0; }
    .stats-grid-4 { grid-template-columns: repeat(2,1fr) !important; }
    .stats-grid-2 { grid-template-columns: 1fr !important; }
    .docentes-layout { flex-direction: column !important; height: auto !important; overflow: visible !important; }
    .docentes-left-panel { width: 100% !important; max-height: 220px; }
    .materias-layout { flex-direction: column !important; height: auto !important; overflow: visible !important; }
    .materias-left-panel { width: 100% !important; max-height: 220px; }
    .secciones-layout { flex-direction: column !important; height: auto !important; overflow: visible !important; }
    .secciones-left-panel { width: 100% !important; max-height: 200px; }
    .asistencias-filters { flex-direction: column !important; gap: 10px !important; }
    .global-search { width: 160px !important; }
    .header-bar { padding: 8px 12px !important; }
    .turno-grid-table { min-width: 500px; }
    .turno-grid-wrapper { overflow-x: auto; }
    .semana-grid { grid-template-columns: repeat(3,1fr) !important; }
  }
  @media (max-width: 480px) {
    .stats-grid-4 { grid-template-columns: 1fr 1fr !important; }
    .semana-grid { grid-template-columns: repeat(2,1fr) !important; }
    .header-stats { display: none; }
  }
`;

function ResponsiveStyles() {
  return <style>{responsiveCSS}</style>;
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = cargando, null = sin sesión
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

  // ========== AUTH ==========
  useEffect(() => {
    // Obtener sesión actual
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    // Escuchar cambios de sesión
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const fetchProgramas = async () => {
    const { data: programas, error } = await supabase
      .from("horarios")
      .select("programa")
      .not("programa", "is", null);
    if (!error && programas) {
      // Normalizar cada programa y deduplicar por nombre canónico
      const canonicalSet = new Map(); // canonical → true
      programas.forEach(p => {
        if (p.programa && p.programa.trim() !== "") {
          const canon = normalizarPrograma(p.programa);
          if (canon) canonicalSet.set(canon, true);
        }
      });
      const unique = [...canonicalSet.keys()].sort();
      // Incluir DEFAULT_PROGRAMAS que no estén ya
      const defaults = DEFAULT_PROGRAMAS.filter(p => !unique.some(u => u.toLowerCase() === p.toLowerCase()));
      setProgramasDisponibles(["todos", ...unique, ...defaults]);
    }
  };

  const fetchHorarios = async () => {
    setLoading(true);
    let query = supabase.from("horarios").select("*");
    if (selectedPrograma !== "todos") {
      query = query.eq("programa", selectedPrograma);
    }
    const { data: horarios, error } = await query.order("id", { ascending: true });
    if (error) {
      console.error(error);
      setError(error.message);
    } else {
      setData(horarios || []);
    }
    setLoading(false);
  };

  const fetchDocenteNames = async () => {
    const { data: docentes, error } = await supabase.from("docentes").select("*");
    if (!error && docentes) {
      const namesMap = {};
      docentes.forEach(d => { namesMap[d.nombre_raw] = d.nombre_display; });
      setDocenteNames(namesMap);
    }
  };

  const fetchMateriaNames = async () => {
    const { data: materias, error } = await supabase.from("materias").select("*");
    if (!error && materias) {
      const namesMap = {};
      materias.forEach(m => { namesMap[m.nombre_raw] = m.nombre_display; });
      setMateriaNames(namesMap);
    }
  };

  useEffect(() => {
    fetchProgramas();
    fetchDocenteNames();
    fetchMateriaNames();
  }, []);

  useEffect(() => {
    fetchHorarios();
  }, [selectedPrograma]);

  // ========== UNIFICACIÓN CORREGIDA ==========
  const unifyName = async (tableName, rawName, newDisplayName) => {
    // Buscar otro registro con el mismo nombre_display (insensible a mayúsculas y espacios)
    const { data: existing, error: searchError } = await supabase
      .from(tableName)
      .select("nombre_raw, nombre_display")
      .ilike("nombre_display", newDisplayName.trim())
      .neq("nombre_raw", rawName)
      .limit(1);
    if (searchError) throw searchError;

    if (existing && existing.length > 0) {
      const targetRaw = existing[0].nombre_raw;
      const canonicalDisplay = existing[0].nombre_display;

      // Actualizar todas las filas de horarios que usen rawName → cambiar a targetRaw
      const { data: horarios, error: fetchError } = await supabase
        .from("horarios")
        .select("id, clase");
      if (fetchError) throw fetchError;

      for (const row of horarios) {
        if (!row.clase || !row.clase.includes(rawName)) continue;
        const nuevaClase = row.clase.split(rawName).join(targetRaw);
        if (nuevaClase !== row.clase) {
          const { error: updateError } = await supabase
            .from("horarios")
            .update({ clase: nuevaClase })
            .eq("id", row.id);
          if (updateError) throw updateError;
        }
      }
      // Eliminar el registro antiguo de la tabla de nombres
      await supabase.from(tableName).delete().eq("nombre_raw", rawName);
      return { targetRaw, canonicalDisplay };
    }
    return null;
  };

  const saveDocenteName = async (rawName, displayName) => {
    try {
      const unified = await unifyName("docentes", rawName, displayName);
      if (unified) {
        alert(`✅ El docente "${displayName}" ya existía. Se han unificado los registros bajo "${unified.canonicalDisplay}".`);
        await fetchDocenteNames();
        await fetchHorarios();
        return { success: true, targetRaw: unified.targetRaw };
      }
      const { error } = await supabase
        .from("docentes")
        .upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      if (error) throw error;
      setDocenteNames(prev => ({ ...prev, [rawName]: displayName }));
      return { success: true };
    } catch (err) {
      console.error(err);
      alert("❌ Error al guardar: " + err.message);
      return { success: false };
    }
  };

  const saveMateriaName = async (rawName, displayName) => {
    try {
      const unified = await unifyName("materias", rawName, displayName);
      if (unified) {
        alert(`✅ La materia "${displayName}" ya existía. Se han unificado los registros bajo "${unified.canonicalDisplay}".`);
        await fetchMateriaNames();
        await fetchHorarios();
        return { success: true, targetRaw: unified.targetRaw };
      }
      const { error } = await supabase
        .from("materias")
        .upsert({ nombre_raw: rawName, nombre_display: displayName }, { onConflict: "nombre_raw" });
      if (error) throw error;
      setMateriaNames(prev => ({ ...prev, [rawName]: displayName }));
      return { success: true };
    } catch (err) {
      console.error(err);
      alert("❌ Error al guardar: " + err.message);
      return { success: false };
    }
  };

  // ========== ELIMINACIÓN CORREGIDA ==========
  const clearAllData = async () => {
    if (!window.confirm(`⚠️ ¿Estás seguro? Esto eliminará TODOS los horarios${selectedPrograma !== "todos" ? ` del programa "${selectedPrograma}"` : " de TODOS los programas"}. Esta acción no se puede deshacer.`)) {
      return;
    }
    setLoading(true);
    let query = supabase.from("horarios").delete();
    if (selectedPrograma !== "todos") {
      query = query.eq("programa", selectedPrograma);
    } else {
      query = query.neq("id", 0);
    }
    const { error } = await query;
    if (error) {
      console.error(error);
      setError("Error al borrar los datos: " + error.message);
      alert("❌ Error al borrar: " + error.message + "\n\nVerifica las políticas de seguridad en Supabase (RLS).");
    } else {
      alert(`✅ Registros eliminados correctamente.`);
      await fetchHorarios();
      await fetchProgramas();
    }
    setLoading(false);
  };

  // ========== CARGA DE EXCEL MEJORADA (CON LOGS Y DETECCIÓN DE HORA) ==========
  const handleFileUpload = async (file) => {
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const binaryStr = e.target.result;
      const workbook = XLSX.read(binaryStr, { type: "binary" });
      const allRows = [];
      console.log(`📄 Leyendo archivo con ${workbook.SheetNames.length} hojas...`);
      
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        let headerRowIdx = -1;
        let horaColIdx = -1;
        let diaCols = { LUNES: -1, MARTES: -1, MIÉRCOLES: -1, JUEVES: -1, VIERNES: -1 };
        
        // Buscar fila que contenga "HORA" (en cualquier columna)
        for (let i = 0; i < json.length; i++) {
          const row = json[i];
          if (!row) continue;
          // Buscar "HORA" en cualquier columna de la fila
          const horaIdx = row.findIndex(cell => cell?.toString().trim().toUpperCase() === "HORA");
          if (horaIdx !== -1) {
            headerRowIdx = i;
            horaColIdx = horaIdx; // La hora está en la columna donde se encontró "HORA"
            for (let j = 0; j < row.length; j++) {
              const cell = row[j]?.toString().toUpperCase().trim();
              if (cell === "LUNES") diaCols.LUNES = j;
              else if (cell === "MARTES") diaCols.MARTES = j;
              else if (cell === "MIÉRCOLES") diaCols.MIÉRCOLES = j;
              else if (cell === "JUEVES") diaCols.JUEVES = j;
              else if (cell === "VIERNES") diaCols.VIERNES = j;
            }
            break;
          }
        }
        if (headerRowIdx === -1) {
          console.warn(`⚠️ Hoja "${sheetName}" no tiene fila "HORA". Se omite.`);
          continue;
        }
        
        // Extraer metadatos (programa, trayecto, sección, turno, sede, aula)
        let programa = "", trayecto = "", seccion = "", turno = "", sede = "", aula = "";
        for (let i = 0; i < headerRowIdx; i++) {
          const row = json[i];
          if (!row) continue;
          // Buscar la celda clave en cualquier columna
          for (let j = 0; j < row.length; j++) {
            const cellVal = row[j]?.toString().trim();
            if (!cellVal) continue;
            if (cellVal === "PROGRAMA" && !programa) programa = row[j+1]?.toString().trim() || "";
            else if (cellVal === "TRAYECTO" && !trayecto) trayecto = row[j+1]?.toString().trim() || "";
            else if (cellVal === "Sede:" && !sede) sede = row[j+1]?.toString().trim() || "";
            else if (cellVal === "AULA" && j === row.findIndex(c => c?.toString().trim() === "AULA") && !aula) {
              aula = row[j+1]?.toString().trim() || "";
            }
            // Sección y Turno: buscar el valor en la celda a la derecha o en el mismo par
            else if (cellVal === "Sección" && !seccion) {
              // El valor puede estar una o dos celdas a la derecha
              seccion = row[j+1]?.toString().trim() || row[j+2]?.toString().trim() || "";
            }
            else if (cellVal === "Turno" && !turno) {
              turno = row[j+1]?.toString().trim() || row[j+2]?.toString().trim() || "";
            }
          }
        }
        
        // Forzar programa según selección
        if (selectedPrograma !== "todos") {
          programa = selectedPrograma;
        } else if (!programa) {
          programa = "Sin programa";
        } else {
          programa = normalizarPrograma(programa) || programa;
        }
        // Determinar turno: prioridad código de sección → campo turno del Excel
        // Se almacena el valor normalizado; getTurnoDeRegistro lo resolverá al mostrar
        const turnoNorm = getTurnoByCodigo(sheetName) || normalizeTurno(turno) || null;
        turno = turnoNorm || turno; // guardar normalizado si se pudo, sino el raw
        
        let filasProcesadas = 0;
        // Recorrer filas desde después del encabezado
        for (let i = headerRowIdx + 1; i < json.length; i++) {
          const row = json[i];
          const hora = row[horaColIdx]?.toString().trim();
          if (!hora || hora === "") continue;
          
          for (const [dia, colIdx] of Object.entries(diaCols)) {
            if (colIdx === -1) continue;
            const clase = row[colIdx]?.toString().trim();
            if (clase && clase !== "") {
              allRows.push({ sheet: sheetName, programa, trayecto, seccion, turno, sede, aula: aula || null, dia, hora, clase });
              filasProcesadas++;
            }
          }
        }
        console.log(`✅ Hoja "${sheetName}": extraídas ${filasProcesadas} clases.`);
      }
      
      if (allRows.length === 0) {
        setError("No se encontraron datos válidos en el archivo.");
        setUploading(false);
        return;
      }
      
      console.log(`📊 Total de filas extraídas: ${allRows.length}`);
      
      // Verificar duplicados contra base de datos actual
      const { data: existingData } = await supabase
        .from("horarios")
        .select("sheet, dia, hora, clase, programa");
      const existingKeys = new Set();
      existingData?.forEach(record => {
        existingKeys.add(`${record.sheet}|${record.dia}|${record.hora}|${record.clase}|${record.programa}`);
      });
      const newRows = allRows.filter(row => !existingKeys.has(`${row.sheet}|${row.dia}|${row.hora}|${row.clase}|${row.programa}`));
      const duplicateCount = allRows.length - newRows.length;
      console.log(`🆕 Nuevos registros: ${newRows.length}, duplicados omitidos: ${duplicateCount}`);
      
      if (newRows.length === 0) {
        alert(`⚠️ No se cargaron nuevos registros. ${duplicateCount} duplicados.`);
        setUploading(false);
        return;
      }
      
      const { error: insertError } = await supabase.from("horarios").insert(newRows);
      if (insertError) {
        console.error(insertError);
        setError("Error al guardar: " + insertError.message);
        alert("❌ Error al guardar: " + insertError.message);
      } else {
        let message = `✅ Se cargaron ${newRows.length} clases.`;
        if (duplicateCount > 0) message += `\n⚠️ Se omitieron ${duplicateCount} duplicados.`;
        alert(message);
        await fetchHorarios();
        await fetchProgramas();
        
        // Extraer docentes y materias únicos
        const uniqueDocentes = new Set();
        const uniqueMaterias = new Set();
        newRows.forEach(row => {
          const { docente, materia } = parseClase(row.clase);
          if (docente) uniqueDocentes.add(docente);
          if (materia) uniqueMaterias.add(materia);
        });
        for (const docente of uniqueDocentes) {
          await supabase.from("docentes").upsert({ nombre_raw: docente, nombre_display: docente }, { onConflict: "nombre_raw" });
        }
        for (const materia of uniqueMaterias) {
          await supabase.from("materias").upsert({ nombre_raw: materia, nombre_display: materia }, { onConflict: "nombre_raw" });
        }
        await fetchDocenteNames();
        await fetchMateriaNames();
      }
      setUploading(false);
    };
    reader.onerror = () => { setError("Error al leer el archivo."); setUploading(false); };
    reader.readAsBinaryString(file);
  };

  // ========== FILTROS Y CÁLCULOS ==========
  const filtered = useMemo(() => {
    return data.filter(d => {
      if (selectedTrayecto !== "all" && d.trayecto !== selectedTrayecto) return false;
      if (selectedSeccion !== "all" && d.sheet.trim() !== selectedSeccion) return false;
      if (activeDay !== "all" && d.dia !== activeDay) return false;
      return true;
    });
  }, [data, selectedTrayecto, selectedSeccion, activeDay]);

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

  const byMateria = useMemo(() => {
    const map = {};
    data.forEach(d => {
      const { materia } = parseClase(d.clase);
      if (!materia) return;
      if (!map[materia]) map[materia] = [];
      map[materia].push(d);
    });
    return map;
  }, [data]);

  const conflicts = useMemo(() => {
    const issues = [];
    Object.entries(byDocente).forEach(([doc, entries]) => {
      DAYS.forEach(day => {
        // Normalizar hora para comparación (elimina espacios extra)
        const horasUnicas = [...new Set(entries.map(e => e.hora?.trim()))].filter(Boolean);
        horasUnicas.forEach(hora => {
          const matches = entries.filter(e => e.dia === day && e.hora?.trim() === hora);
          if (matches.length > 1) issues.push({ docente: doc, dia: day, hora, entries: matches });
        });
      });
    });
    return issues;
  }, [byDocente]);


  const allTrayectos = useMemo(() => [...new Set(data.map(d => d.trayecto))].sort(), [data]);
  const allSecciones = useMemo(() => [...new Set(data.map(d => d.sheet.trim()))].sort(), [data]);
  const seccionesByTrayecto = useMemo(() =>
    allSecciones.filter(s => selectedTrayecto === "all" || data.some(d => d.sheet.trim() === s && d.trayecto === selectedTrayecto)),
    [selectedTrayecto, data, allSecciones]);

  const stats = useMemo(() => ({
    total: data.length,
    secciones: new Set(data.map(d => d.sheet.trim())).size,
    docentes: Object.keys(byDocente).length,
    materias: Object.keys(byMateria).length,
  }), [data, byDocente, byMateria]);

  const getDocName = (raw) => docenteNames[raw] || raw;
  const getMateriaName = (raw) => materiaNames[raw] || raw;
  const handleNavigate = (result) => {
    if (result.docente) { setDocenteNav(result.rawDocente || result.docente); setView("docentes"); }
    else if (result.materia) { setMateriaNav(result.rawMateria); setView("materias"); }
    else { setView("horarios"); }
  };

  const nav = NAV_ITEMS.map(item => ({
    ...item,
    badge: item.hasBadge ? conflicts.length : 0,
  }));

  // ========== GUARDS ==========
  // Mientras se verifica la sesión
  if (user === undefined) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", color: "#94A3B8", fontFamily: "system-ui, sans-serif", fontSize: 14 }}>
        Verificando sesión…
      </div>
    );
  }

  // Sin sesión → pantalla de login
  if (!user) return <LoginScreen />;

  if (loading && data.length === 0) return <div style={{ padding: 20, textAlign: "center" }}>Cargando horarios...</div>;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", background: "#F3F4F6", overflow: "hidden" }}>
      <ResponsiveStyles />
      {/* Overlay para cerrar sidebar en móvil */}
      <div
        className="sidebar-overlay"
        onClick={() => setSidebarOpen(false)}
        style={{ display: "none", position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 299 }}
      />
      <aside className={`sidebar-aside${sidebarOpen ? " open" : ""}`} style={{ width: 220, background: "#111827", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>PNF</div>
          <select 
            value={selectedPrograma} 
            onChange={e => setSelectedPrograma(e.target.value)}
            style={{ ...S.select, width: "100%", background: "#1F2937", color: "#fff", borderColor: "#374151", marginBottom: 12 }}
          >
            {programasDisponibles.map(p => (
              <option key={p} value={p}>
                {p === "todos" ? "📋 Todos los programas" : p}
              </option>
            ))}
          </select>
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#1F2937", borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 11, color: "#9CA3AF" }}>Clases</span><span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{stats.total}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 11, color: "#9CA3AF" }}>Secciones</span><span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{stats.secciones}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, color: "#9CA3AF" }}>Docentes</span><span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{stats.docentes}</span></div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "8px 10px", overflowY: "auto" }}>
          {nav.map(item => (
            <button key={item.id} onClick={() => { setView(item.id); setSidebarOpen(false); }} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", border: "none", borderRadius: 8,
              background: view === item.id ? "#2563EB" : "transparent", color: view === item.id ? "#fff" : "#9CA3AF",
              cursor: "pointer", fontSize: 13, textAlign: "left", marginBottom: 2, fontWeight: view === item.id ? 600 : 400,
            }}>
              <span style={{ fontSize: 15 }}>{item.emoji}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge > 0 && (<span style={{ background: "#EF4444", color: "#fff", borderRadius: 10, fontSize: 10, padding: "2px 6px", fontWeight: 700 }}>{item.badge}</span>)}
            </button>
          ))}
        </nav>
        <div style={{ padding: "12px 14px", borderTop: "1px solid #1F2937" }}>
          <label htmlFor="upload-excel" style={{ display: "block", cursor: "pointer", background: "#2563EB", color: "#fff", textAlign: "center", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            📂 Cargar Excel
          </label>
          <input id="upload-excel" type="file" accept=".xlsx, .xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }} disabled={uploading} />
          <button 
            onClick={clearAllData} 
            disabled={loading || data.length === 0}
            style={{ 
              display: "block", width: "100%", cursor: data.length === 0 ? "not-allowed" : "pointer", background: "#DC2626", color: "#fff",
              textAlign: "center", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", opacity: data.length === 0 ? 0.5 : 1
            }}
          >
            🗑️ Borrar {selectedPrograma === "todos" ? "todos los datos" : `datos de ${selectedPrograma}`}
          </button>
          {uploading && <div style={{ fontSize: 10, marginTop: 6, color: "#9CA3AF" }}>Subiendo...</div>}
          {error && <div style={{ fontSize: 10, marginTop: 6, color: "#EF4444" }}>{error}</div>}
          {data.length > 0 && !uploading && !loading && (
            <div style={{ fontSize: 10, marginTop: 6, color: "#6B7280", textAlign: "center" }}>{data.length} registros cargados</div>
          )}
        </div>
        {/* Usuario admin + Logout */}
        <div style={{ padding: "10px 14px", borderTop: "1px solid #1F2937", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#2563EB,#7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
            {user.email?.[0]?.toUpperCase() ?? "A"}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 11, color: "#D1D5DB", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
            <div style={{ fontSize: 10, color: "#4B5563" }}>Administrador</div>
          </div>
          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            style={{ background: "none", border: "1px solid #374151", borderRadius: 6, cursor: "pointer", color: "#6B7280", fontSize: 13, padding: "3px 6px", flexShrink: 0, lineHeight: 1 }}
          >
            ⏏
          </button>
        </div>
      </aside>
      <div className="main-content" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header className="header-bar" style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {/* Botón hamburguesa para móvil */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{ display: "none", background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 18, color: "#374151", lineHeight: 1, flexShrink: 0 }}
            className="hamburger-btn"
            aria-label="Abrir menú"
          >☰</button>
          <GlobalSearch onNavigate={handleNavigate} docenteNames={docenteNames} materiaNames={materiaNames} data={data} />
          <div className="header-stats" style={{ marginLeft: "auto", fontSize: 12, color: "#9CA3AF" }}>{stats.total} registros · {stats.materias} materias</div>
        </header>
        <main style={{ flex: 1, overflow: "auto" }}>
          {view === "horarios" && <HorariosView filtered={filtered} selectedTrayecto={selectedTrayecto} setSelectedTrayecto={setSelectedTrayecto} selectedSeccion={selectedSeccion} setSelectedSeccion={setSelectedSeccion} activeDay={activeDay} setActiveDay={setActiveDay} seccionesByTrayecto={seccionesByTrayecto} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={getDocName} getMateriaName={getMateriaName} allTrayectos={allTrayectos} />}
          {view === "secciones" && <SeccionesView data={data} getDocName={getDocName} getMateriaName={getMateriaName} />}
          {view === "docentes" && <DocentesView byDocente={byDocente} conflicts={conflicts} initialSel={docenteNav} onConsumeNav={() => setDocenteNav(null)} docenteNames={docenteNames} setDocenteNames={setDocenteNames} getDocName={getDocName} onSaveDocenteName={saveDocenteName} />}
          {view === "materias" && <MateriasView byMateria={byMateria} initialSel={materiaNav} onConsumeNav={() => setMateriaNav(null)} materiaNames={materiaNames} setMateriaNames={setMateriaNames} getMateriaName={getMateriaName} onSaveMateriaName={saveMateriaName} data={data} />}
          {view === "asistencias" && <AsistenciasView data={data} getDocName={getDocName} getMateriaName={getMateriaName} />}
          {view === "conflictos" && <ConflictosView conflicts={conflicts} onGoDocente={(d) => { setDocenteNav(d); setView("docentes"); }} getDocName={getDocName} />}
          {view === "estadisticas" && <EstadisticasView stats={stats} byDocente={byDocente} byMateria={byMateria} data={data} getDocName={getDocName} getMateriaName={getMateriaName} />}
        </main>
      </div>
    </div>
  );
}
