import { useState, useMemo, useRef, useEffect, createContext, useContext } from "react";

const RAW_DATA = [/* ... todos tus 194 registros ... */];
// (Mantén exactamente la misma RAW_DATA que ya tenías)

const DAYS = ["LUNES","MARTES","MIÉRCOLES","JUEVES","VIERNES"];
const TRAYECTO_COLORS = {
  "1-1":"#2563EB","1-2":"#059669",
  "2-1":"#DC2626","2-2":"#DB2777",
  "3-1":"#D97706","3-2":"#65A30D",
  "4-1":"#7C3AED","4-2":"#4338CA",
};
const TRAYECTO_BG = {
  "1-1":"#EFF6FF","1-2":"#ECFDF5",
  "2-1":"#FEF2F2","2-2":"#FDF2F8",
  "3-1":"#FFFBEB","3-2":"#F7FEE7",
  "4-1":"#F5F3FF","4-2":"#EEF2FF",
};

function parseClase(clase) {
  const parts = clase.trim().split(/\s+(?:Profes?\.?|Prof\.?)\s+/i);
  const materia = parts[0].trim();
  const docente = parts[1] ? parts[1].trim() : "";
  return { materia, docente };
}

const ALL_TRAYECTOS = [...new Set(RAW_DATA.map(d => d.trayecto))].sort();
const ALL_SECCIONES = [...new Set(RAW_DATA.map(d => d.sheet.trim()))].sort();
const ALL_TURNOS = [...new Set(RAW_DATA.map(d => d.turno))].sort();

function getUniqueHoras() {
  const h = [...new Set(RAW_DATA.map(d => d.hora))];
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
const ALL_HORAS = getUniqueHoras();

// ---------- Contexto para sobrescritura de nombres ----------
const OverridesContext = createContext();

function useOverrides() {
  return useContext(OverridesContext);
}

function OverridesProvider({ children }) {
  const [docenteMap, setDocenteMap] = useState(() => {
    const saved = localStorage.getItem("docenteOverrides");
    return saved ? JSON.parse(saved) : {};
  });
  const [materiaMap, setMateriaMap] = useState(() => {
    const saved = localStorage.getItem("materiaOverrides");
    return saved ? JSON.parse(saved) : {};
  });

  const updateDocente = (original, newName) => {
    if (!newName.trim()) return;
    setDocenteMap(prev => {
      const updated = { ...prev, [original]: newName.trim() };
      localStorage.setItem("docenteOverrides", JSON.stringify(updated));
      return updated;
    });
  };

  const updateMateria = (original, newName) => {
    if (!newName.trim()) return;
    setMateriaMap(prev => {
      const updated = { ...prev, [original]: newName.trim() };
      localStorage.setItem("materiaOverrides", JSON.stringify(updated));
      return updated;
    });
  };

  const getDisplayDocente = (original) => docenteMap[original] || original;
  const getDisplayMateria = (original) => materiaMap[original] || original;

  return (
    <OverridesContext.Provider value={{ getDisplayDocente, getDisplayMateria, updateDocente, updateMateria, docenteMap, materiaMap }}>
      {children}
    </OverridesContext.Provider>
  );
}

// ---------- Componentes auxiliares (sin cambios, solo se añade uso del contexto) ----------
function Avatar({ name, size = 36 }) {
  const initials = name.split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase();
  const hue = [...name].reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", display:"flex", alignItems:"center",
                  justifyContent:"center", fontSize:size*0.38, fontWeight:700,
                  background:`hsl(${hue},55%,90%)`, color:`hsl(${hue},55%,35%)`, flexShrink:0 }}>
      {initials}
    </div>
  );
}

function StatCard({ label, value, icon, color="#2563EB" }) {
  return (
    <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"20px", display:"flex", alignItems:"center", gap:16 }}>
      <div style={{ width:48, height:48, borderRadius:12, background:`${color}18`,
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize:28, fontWeight:700, color:"#111827", lineHeight:1 }}>{value}</div>
        <div style={{ fontSize:12, color:"#9CA3AF", marginTop:4, fontWeight:500 }}>{label}</div>
      </div>
    </div>
  );
}

// ---------- Búsqueda global (con nombres editados) ----------
function GlobalSearch({ onNavigate }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const { getDisplayDocente, getDisplayMateria } = useOverrides();

  const results = useMemo(() => {
    if (q.length < 2) return [];
    const lo = q.toLowerCase();
    const seen = new Set();
    const out = [];
    RAW_DATA.forEach(d => {
      const { materia, docente } = parseClase(d.clase);
      const displayMateria = getDisplayMateria(materia);
      const displayDocente = getDisplayDocente(docente);
      const key = `${displayMateria}__${displayDocente}`;
      if (!seen.has(key) && (displayMateria.toLowerCase().includes(lo) || (displayDocente && displayDocente.toLowerCase().includes(lo)))) {
        seen.add(key);
        out.push({ type: docente ? "clase" : "materia", materia: displayMateria, docente: displayDocente, originalMateria: materia, originalDocente: docente, trayecto: d.trayecto, sheet: d.sheet.trim() });
      }
    });
    return out.slice(0, 8);
  }, [q, getDisplayMateria, getDisplayDocente]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position:"relative", width:280 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, background:"#F9FAFB",
                    border:"1px solid #E5E7EB", borderRadius:8, padding:"6px 12px" }}>
        <span style={{ fontSize:16, color:"#9CA3AF" }}>🔍</span>
        <input value={q} onChange={e=>{setQ(e.target.value);setOpen(true);}}
          onFocus={()=>setOpen(true)}
          placeholder="Buscar materia, docente…"
          style={{ border:"none", background:"transparent", outline:"none", fontSize:13, color:"#111827", width:"100%" }} />
        {q && <button onClick={()=>setQ("")} style={{ border:"none",background:"none",cursor:"pointer",color:"#9CA3AF",fontSize:16,padding:0 }}>×</button>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, background:"#fff",
                      borderRadius:10, border:"1px solid #E5E7EB", boxShadow:"0 8px 24px rgba(0,0,0,0.1)",
                      zIndex:200, overflow:"hidden" }}>
          {results.map((r,i) => (
            <div key={i} onClick={()=>{ onNavigate(r); setOpen(false); setQ(""); }}
              style={{ padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:10,
                       borderTop: i>0 ? "1px solid #F3F4F6" : "none" }}
              onMouseEnter={e=>e.currentTarget.style.background="#F9FAFB"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{ background:TRAYECTO_BG[r.trayecto]||"#f3f4f6", color:TRAYECTO_COLORS[r.trayecto]||"#555", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>
                {r.trayecto}
              </span>
              <div>
                <div style={{ fontSize:13, fontWeight:500, color:"#111827" }}>{r.materia}</div>
                {r.docente && <div style={{ fontSize:11, color:"#9CA3AF" }}>{r.docente}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- App principal ----------
export default function App() {
  const [view, setView] = useState("horarios");
  const [selectedTrayecto, setSelectedTrayecto] = useState("all");
  const [selectedSeccion, setSelectedSeccion] = useState("all");
  const [selectedTurno, setSelectedTurno] = useState("all");
  const [activeDay, setActiveDay] = useState("all");
  const [expandedCell, setExpandedCell] = useState(null);
  const [docenteNav, setDocenteNav] = useState(null);
  const [materiaNav, setMateriaNav] = useState(null);
  const { getDisplayDocente, getDisplayMateria, docenteMap, materiaMap } = useOverrides();

  const filtered = useMemo(() => RAW_DATA.filter(d => {
    if (selectedTrayecto !== "all" && d.trayecto !== selectedTrayecto) return false;
    if (selectedSeccion !== "all" && d.sheet.trim() !== selectedSeccion) return false;
    if (selectedTurno !== "all" && d.turno !== selectedTurno) return false;
    if (activeDay !== "all" && d.dia !== activeDay) return false;
    return true;
  }), [selectedTrayecto, selectedSeccion, selectedTurno, activeDay]);

  const seccionesByTrayecto = useMemo(() =>
    ALL_SECCIONES.filter(s => selectedTrayecto === "all" || RAW_DATA.some(d => d.sheet.trim() === s && d.trayecto === selectedTrayecto)),
    [selectedTrayecto]);

  const byDocente = useMemo(() => {
    const map = {};
    RAW_DATA.forEach(d => {
      const { docente } = parseClase(d.clase);
      if (!docente) return;
      const displayName = getDisplayDocente(docente);
      if (!map[displayName]) map[displayName] = [];
      map[displayName].push(d);
    });
    return map;
  }, [getDisplayDocente]);

  const byMateria = useMemo(() => {
    const map = {};
    RAW_DATA.forEach(d => {
      const { materia } = parseClase(d.clase);
      const displayName = getDisplayMateria(materia);
      if (!map[displayName]) map[displayName] = [];
      map[displayName].push(d);
    });
    return map;
  }, [getDisplayMateria]);

  const conflicts = useMemo(() => {
    const issues = [];
    // Agrupar por docente original para conflictos (usando el nombre original)
    const byOriginalDocente = {};
    RAW_DATA.forEach(d => {
      const { docente } = parseClase(d.clase);
      if (!docente) return;
      if (!byOriginalDocente[docente]) byOriginalDocente[docente] = [];
      byOriginalDocente[docente].push(d);
    });
    Object.entries(byOriginalDocente).forEach(([doc, entries]) => {
      DAYS.forEach(day => {
        ALL_HORAS.forEach(hora => {
          const matches = entries.filter(e => e.dia === day && e.hora === hora);
          if (matches.length > 1) issues.push({ docente: doc, dia: day, hora, entries: matches });
        });
      });
    });
    return issues;
  }, []);

  const gridData = useMemo(() => {
    const map = {};
    filtered.forEach(d => {
      const key = `${d.hora}__${d.dia}`;
      if (!map[key]) map[key] = [];
      map[key].push(d);
    });
    return map;
  }, [filtered]);

  const stats = useMemo(() => ({
    total: RAW_DATA.length,
    secciones: new Set(RAW_DATA.map(d => d.sheet.trim())).size,
    docentes: Object.keys(byDocente).length,
    materias: Object.keys(byMateria).length,
  }), [byDocente, byMateria]);

  const handleNavigate = (result) => {
    if (result.docente) {
      setDocenteNav(result.originalDocente);
      setView("docentes");
    } else if (result.materia) {
      setMateriaNav(result.originalMateria);
      setView("materias");
    } else {
      setView("horarios");
    }
  };

  const nav = [
    { id:"horarios",     emoji:"📅", label:"Horarios" },
    { id:"secciones",    emoji:"🏫", label:"Secciones" },
    { id:"docentes",     emoji:"👥", label:"Docentes", badge: conflicts.length },
    { id:"materias",     emoji:"📚", label:"Materias" },
    { id:"conflictos",   emoji:"⚠️", label:"Conflictos", badge: conflicts.length },
    { id:"estadisticas", emoji:"📊", label:"Estadísticas" },
  ];

  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"system-ui,-apple-system,sans-serif",
                  background:"#F3F4F6", overflow:"hidden" }}>
      <aside style={{ width:220, background:"#111827", display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"20px 16px 16px" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#6B7280", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4 }}>
            PNF Informática
          </div>
          <div style={{ fontSize:13, color:"#fff", fontWeight:600 }}>Cabimas · 2-2026</div>
          <div style={{ marginTop:12, padding:"10px 12px", background:"#1F2937", borderRadius:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ fontSize:11, color:"#9CA3AF" }}>Clases</span>
              <span style={{ fontSize:11, fontWeight:700, color:"#fff" }}>{stats.total}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ fontSize:11, color:"#9CA3AF" }}>Secciones</span>
              <span style={{ fontSize:11, fontWeight:700, color:"#fff" }}>{stats.secciones}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:11, color:"#9CA3AF" }}>Docentes</span>
              <span style={{ fontSize:11, fontWeight:700, color:"#fff" }}>{stats.docentes}</span>
            </div>
          </div>
        </div>
        <nav style={{ flex:1, padding:"8px 10px" }}>
          {nav.map(item => (
            <button key={item.id} onClick={()=>setView(item.id)} style={{
              display:"flex", alignItems:"center", gap:10, width:"100%",
              padding:"9px 12px", border:"none", borderRadius:8,
              background: view===item.id ? "#2563EB" : "transparent",
              color: view===item.id ? "#fff" : "#9CA3AF",
              cursor:"pointer", fontSize:13, textAlign:"left", marginBottom:2,
              fontWeight: view===item.id ? 600 : 400, transition:"all 0.15s",
            }}>
              <span style={{ fontSize:15 }}>{item.emoji}</span>
              <span style={{ flex:1 }}>{item.label}</span>
              {item.badge > 0 && (
                <span style={{ background:"#EF4444", color:"#fff", borderRadius:10, fontSize:10, padding:"2px 6px", fontWeight:700 }}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div style={{ padding:"12px 14px 20px", borderTop:"1px solid #1F2937" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#6B7280", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>
            Leyenda
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
            {ALL_TRAYECTOS.map(t => (
              <div key={t} style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ width:8, height:8, borderRadius:2, background:TRAYECTO_COLORS[t], flexShrink:0 }} />
                <span style={{ fontSize:10, color:"#9CA3AF" }}>T.{t}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <header style={{ background:"#fff", borderBottom:"1px solid #E5E7EB", padding:"12px 20px",
                         display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <GlobalSearch onNavigate={handleNavigate} />
          <div style={{ marginLeft:"auto", fontSize:12, color:"#9CA3AF" }}>
            {stats.total} registros · {stats.materias} materias
          </div>
        </header>
        <main style={{ flex:1, overflow:"auto" }}>
          {view === "horarios" && (
            <HorariosView
              filtered={filtered} gridData={gridData}
              selectedTrayecto={selectedTrayecto} setSelectedTrayecto={setSelectedTrayecto}
              selectedSeccion={selectedSeccion} setSelectedSeccion={setSelectedSeccion}
              selectedTurno={selectedTurno} setSelectedTurno={setSelectedTurno}
              activeDay={activeDay} setActiveDay={setActiveDay}
              seccionesByTrayecto={seccionesByTrayecto}
              expandedCell={expandedCell} setExpandedCell={setExpandedCell}
            />
          )}
          {view === "secciones" && <SeccionesView />}
          {view === "docentes" && <DocentesView byDocente={byDocente} conflicts={conflicts} initialSel={docenteNav} onConsumeNav={()=>setDocenteNav(null)} />}
          {view === "materias" && <MateriasView byMateria={byMateria} initialSel={materiaNav} onConsumeNav={()=>setMateriaNav(null)} />}
          {view === "conflictos" && <ConflictosView conflicts={conflicts} onGoDocente={(d)=>{setDocenteNav(d);setView("docentes");}} />}
          {view === "estadisticas" && <EstadisticasView stats={stats} byDocente={byDocente} byMateria={byMateria} />}
        </main>
      </div>
    </div>
  );
}

// ---------- HorariosView (con nombres editados) ----------
function HorariosView({ filtered, gridData, selectedTrayecto, setSelectedTrayecto, selectedSeccion, setSelectedSeccion, selectedTurno, setSelectedTurno, activeDay, setActiveDay, seccionesByTrayecto, expandedCell, setExpandedCell }) {
  const days = activeDay === "all" ? DAYS : [activeDay];
  const { getDisplayDocente, getDisplayMateria } = useOverrides();

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"14px 20px", background:"#fff", borderBottom:"1px solid #E5E7EB", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        <h1 style={{ margin:0, fontSize:17, fontWeight:700, color:"#111827", marginRight:4 }}>📅 Horarios</h1>
        <select value={selectedTrayecto} onChange={e=>{setSelectedTrayecto(e.target.value);setSelectedSeccion("all");}} style={{ fontSize:13, padding:"6px 10px", borderRadius:8, border:"1px solid #D1D5DB", background:"#fff", cursor:"pointer" }}>
          <option value="all">Todos los trayectos</option>
          {ALL_TRAYECTOS.map(t=><option key={t} value={t}>Trayecto {t}</option>)}
        </select>
        <select value={selectedSeccion} onChange={e=>setSelectedSeccion(e.target.value)} style={{ fontSize:13, padding:"6px 10px", borderRadius:8, border:"1px solid #D1D5DB", background:"#fff", cursor:"pointer" }}>
          <option value="all">Todas las secciones</option>
          {seccionesByTrayecto.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={selectedTurno} onChange={e=>setSelectedTurno(e.target.value)} style={{ fontSize:13, padding:"6px 10px", borderRadius:8, border:"1px solid #D1D5DB", background:"#fff", cursor:"pointer" }}>
          <option value="all">Todos los turnos</option>
          {ALL_TURNOS.map(t=><option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize:13, color:"#9CA3AF", marginLeft:"auto" }}>{filtered.length} clases</span>
      </div>

      <div style={{ padding:"10px 20px", background:"#fff", borderBottom:"1px solid #F3F4F6", display:"flex", gap:6 }}>
        {["all",...DAYS].map(d=>(
          <button key={d} onClick={()=>setActiveDay(d)} style={{ padding:"6px 14px", borderRadius:20, border:"1px solid", borderColor: activeDay===d ? "#2563EB" : "#E5E7EB", background: activeDay===d ? "#EFF6FF" : "#fff", color: activeDay===d ? "#1D4ED8" : "#6B7280", cursor:"pointer", fontSize:13, fontWeight: activeDay===d ? 600 : 400 }}>
            {d==="all" ? "Semana completa" : d.charAt(0)+d.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflow:"auto", padding:"16px 20px" }}>
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
            <thead>
              <tr>
                <th style={{ padding:"9px 14px", fontSize:11, fontWeight:600, color:"#6B7280", textAlign:"left", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB", width:130 }}>Hora</th>
                {days.map(d=>(
                  <th key={d} style={{ padding:"9px 14px", fontSize:11, fontWeight:600, color:"#6B7280", textAlign:"left", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB", borderLeft:"1px solid #E5E7EB" }}>
                    {d.charAt(0)+d.slice(1).toLowerCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_HORAS.map((hora, ri) => (
                <tr key={hora}>
                  <td style={{ padding:"10px 14px", fontSize:11, fontWeight:600, color:"#9CA3AF", whiteSpace:"nowrap", borderTop:"1px solid #F3F4F6", background: ri%2===0 ? "#fff" : "#FAFAFA" }}>{hora}</td>
                  {days.map(day => {
                    const entries = gridData[`${hora}__${day}`] || [];
                    const cellKey = `${hora}__${day}`;
                    const isExp = expandedCell === cellKey;
                    return (
                      <td key={day} style={{ padding:"4px 6px", borderTop:"1px solid #F3F4F6", borderLeft:"1px solid #F3F4F6", verticalAlign:"top", background: ri%2===0 ? "#fff" : "#FAFAFA" }}>
                        {entries.map((e, i) => {
                          const { materia, docente } = parseClase(e.clase);
                          const displayMateria = getDisplayMateria(materia);
                          const displayDocente = getDisplayDocente(docente);
                          const bg = TRAYECTO_BG[e.trayecto] || "#f0f0f0";
                          const col = TRAYECTO_COLORS[e.trayecto] || "#555";
                          return (
                            <div key={i} onClick={()=>setExpandedCell(isExp ? null : cellKey)}
                              style={{ background:bg, borderLeft:`3px solid ${col}`, borderRadius:6, padding:"5px 8px", marginBottom: i<entries.length-1 ? 3 : 0, cursor:"pointer", transition:"box-shadow 0.15s", boxShadow: isExp ? `0 0 0 1.5px ${col}40` : "none" }}>
                              <div style={{ fontSize:12, fontWeight:600, color:col, lineHeight:1.3 }}>
                                {displayMateria.length>28 ? displayMateria.slice(0,26)+"…" : displayMateria}
                              </div>
                              {displayDocente && <div style={{ fontSize:11, color:col, opacity:0.7, marginTop:1 }}>{displayDocente}</div>}
                              {isExp && (
                                <div style={{ marginTop:6, paddingTop:6, borderTop:`1px solid ${col}25`, fontSize:11 }}>
                                  <div style={{ color:col, opacity:0.85 }}>📂 {e.sheet.trim()}</div>
                                  <div style={{ color:col, opacity:0.85 }}>🏫 {e.aula || "Sin aula"}</div>
                                  <div style={{ color:col, opacity:0.85 }}>⏰ {e.turno}</div>
                                </div>
                              )}
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

// ---------- SeccionesView (con nombres editados) ----------
function SeccionesView() {
  const [selSheet, setSelSheet] = useState(ALL_SECCIONES[0]);
  const [filterTray, setFilterTray] = useState("all");
  const entries = RAW_DATA.filter(d => d.sheet.trim() === selSheet);
  const info = entries[0];
  const { getDisplayDocente, getDisplayMateria } = useOverrides();

  const filteredSecciones = filterTray === "all"
    ? ALL_SECCIONES
    : ALL_SECCIONES.filter(s => RAW_DATA.find(d=>d.sheet.trim()===s)?.trayecto === filterTray);

  const byDay = DAYS.reduce((acc,day) => {
    acc[day] = entries.filter(e => e.dia === day).sort((a,b) => {
      const toM = s => { const m=s.match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m)return 0; let h=+m[1],mi=+m[2]; if(m[3].toUpperCase()==="PM"&&h!==12)h+=12; if(m[3].toUpperCase()==="AM"&&h===12)h=0; return h*60+mi; };
      return toM(a.hora) - toM(b.hora);
    });
    return acc;
  }, {});

  return (
    <div style={{ padding:20, display:"flex", gap:16, height:"calc(100vh - 61px)", overflow:"hidden" }}>
      <div style={{ width:220, flexShrink:0, display:"flex", flexDirection:"column", gap:10 }}>
        <select value={filterTray} onChange={e=>setFilterTray(e.target.value)} style={{ fontSize:13, padding:"6px 10px", borderRadius:8, border:"1px solid #D1D5DB", background:"#fff", cursor:"pointer", width:"100%" }}>
          <option value="all">Todos los trayectos</option>
          {ALL_TRAYECTOS.map(t=><option key={t} value={t}>Trayecto {t}</option>)}
        </select>
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", flex:1, overflowY:"auto" }}>
          <div style={{ padding:"8px 12px", fontSize:11, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.06em", textTransform:"uppercase", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB" }}>
            {filteredSecciones.length} secciones
          </div>
          {filteredSecciones.map(s => {
            const tray = RAW_DATA.find(d=>d.sheet.trim()===s)?.trayecto;
            return (
              <div key={s} onClick={()=>setSelSheet(s)} style={{
                padding:"9px 14px", cursor:"pointer", fontSize:13,
                background: selSheet===s ? "#EFF6FF" : "transparent",
                color: selSheet===s ? "#1D4ED8" : "#374151",
                borderBottom:"1px solid #F3F4F6",
                display:"flex", alignItems:"center", gap:8,
                fontWeight: selSheet===s ? 600 : 400,
              }}>
                <span style={{ width:8, height:8, borderRadius:2, background:TRAYECTO_COLORS[tray]||"#ccc", flexShrink:0 }} />
                {s}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        {info && (
          <>
            <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"16px 20px", marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:700, color:"#111827" }}>{selSheet}</div>
                  <div style={{ fontSize:13, color:"#6B7280", marginTop:2 }}>{info.programa}</div>
                </div>
                <span style={{ background:TRAYECTO_BG[info.trayecto]||"#f3f4f6", color:TRAYECTO_COLORS[info.trayecto]||"#555", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>
                  Trayecto {info.trayecto}
                </span>
              </div>
              <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
                {[
                  ["Turno", info.turno],
                  ["Sección", info.seccion],
                  ["Sede", info.sede],
                  info.aula && ["Aula", info.aula],
                  ["Total clases", entries.length],
                ].filter(Boolean).map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize:11, color:"#9CA3AF", fontWeight:500 }}>{label}</div>
                    <div style={{ fontSize:13, fontWeight:600, color:"#111827", marginTop:2 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", overflow:"hidden" }}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", borderBottom:"1px solid #E5E7EB" }}>
                {DAYS.map(day=>(
                  <div key={day} style={{ padding:"10px 12px", borderRight:"1px solid #E5E7EB", fontWeight:600, fontSize:11, color:"#6B7280", textTransform:"uppercase", letterSpacing:"0.05em", background:"#F9FAFB" }}>
                    {day.slice(0,3)}
                  </div>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)" }}>
                {DAYS.map(day=>(
                  <div key={day} style={{ padding:"10px 10px", borderRight:"1px solid #F3F4F6", minHeight:120, verticalAlign:"top" }}>
                    {(byDay[day]||[]).map((e,i) => {
                      const { materia, docente } = parseClase(e.clase);
                      const displayMateria = getDisplayMateria(materia);
                      const displayDocente = getDisplayDocente(docente);
                      const col = TRAYECTO_COLORS[e.trayecto]||"#555";
                      const bg = TRAYECTO_BG[e.trayecto]||"#f5f5f5";
                      return (
                        <div key={i} style={{ background:bg, borderLeft:`3px solid ${col}`, borderRadius:5, padding:"5px 8px", marginBottom:5 }}>
                          <div style={{ fontSize:11, fontWeight:600, color:col, lineHeight:1.3 }}>
                            {displayMateria.length>22 ? displayMateria.slice(0,20)+"…" : displayMateria}
                          </div>
                          <div style={{ fontSize:10, color:col, opacity:0.7, marginTop:2 }}>{e.hora.split(" ")[0]}</div>
                          {displayDocente && <div style={{ fontSize:10, color:col, opacity:0.65, marginTop:1 }}>{displayDocente.split(" ")[0]}</div>}
                        </div>
                      );
                    })}
                    {byDay[day].length === 0 && (
                      <div style={{ fontSize:11, color:"#D1D5DB", textAlign:"center", marginTop:20 }}>—</div>
                    )}
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

// ---------- DocentesView (con edición) ----------
function DocentesView({ byDocente, conflicts, initialSel, onConsumeNav }) {
  const sorted = Object.keys(byDocente).sort();
  const [sel, setSel] = useState(initialSel || null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const { updateDocente, getDisplayDocente } = useOverrides();

  useEffect(() => {
    if (initialSel) { setSel(initialSel); onConsumeNav(); }
  }, [initialSel]);

  const hasConflict = (name) => conflicts.some(c => getDisplayDocente(c.docente) === name);
  const selEntries = sel ? byDocente[sel] : [];
  const selConflicts = sel ? conflicts.filter(c => getDisplayDocente(c.docente) === sel) : [];

  const filteredSorted = search
    ? sorted.filter(d => d.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const startEdit = (originalName) => {
    setEditing(originalName);
    setEditValue(originalName);
  };
  const saveEdit = () => {
    if (editing && editValue.trim() && editValue !== editing) {
      // Necesitamos el nombre original (el que está en RAW_DATA)
      // En byDocente la clave es el nombre mostrado. Para obtener el original,
      // buscamos en RAW_DATA el primer docente que coincida con el nombre mostrado.
      const originalDoc = RAW_DATA.find(d => {
        const { docente } = parseClase(d.clase);
        return docente && getDisplayDocente(docente) === editing;
      })?.docente;
      if (originalDoc) {
        updateDocente(originalDoc, editValue);
      }
    }
    setEditing(null);
  };
  const handleKey = (e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); };

  return (
    <div style={{ padding:20, display:"flex", gap:16, height:"calc(100vh - 61px)", overflow:"hidden" }}>
      <div style={{ width:240, flexShrink:0, display:"flex", flexDirection:"column", gap:10 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filtrar docente…" style={{ fontSize:13, padding:"6px 12px", borderRadius:8, border:"1px solid #D1D5DB", background:"#fff", outline:"none" }} />
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", flex:1, overflowY:"auto" }}>
          <div style={{ padding:"8px 12px", fontSize:11, fontWeight:700, color:"#9CA3AF", textTransform:"uppercase", letterSpacing:"0.06em", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB" }}>
            {filteredSorted.length} docentes
          </div>
          {filteredSorted.map(d => (
            <div key={d} style={{
              padding:"9px 12px", cursor:"pointer", fontSize:13,
              background: sel===d ? "#EFF6FF" : "transparent",
              color: sel===d ? "#1D4ED8" : "#374151",
              borderBottom:"1px solid #F3F4F6",
              display:"flex", justifyContent:"space-between", alignItems:"center",
              fontWeight: sel===d ? 600 : 400,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
                {hasConflict(d) && <span title="Tiene conflictos" style={{ fontSize:14 }}>⚠️</span>}
                {editing === d ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e=>setEditValue(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={handleKey}
                    style={{ fontSize:13, padding:"2px 6px", borderRadius:6, border:"1px solid #2563EB", outline:"none", width:"100%" }}
                  />
                ) : (
                  <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d}</span>
                )}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {!editing && (
                  <button onClick={(e)=>{ e.stopPropagation(); startEdit(d); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, padding:"2px 4px", borderRadius:4, color:"#9CA3AF" }}>✏️</button>
                )}
                <span style={{ fontSize:11, background:"#F3F4F6", borderRadius:10, padding:"1px 7px", color:"#6B7280", fontWeight:600 }}>{byDocente[d].length}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        {!sel ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:200, color:"#9CA3AF", fontSize:14 }}>
            Selecciona un docente para ver su horario
          </div>
        ) : (
          <>
            <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"16px 20px", marginBottom:16, display:"flex", alignItems:"center", gap:14 }}>
              <Avatar name={sel} size={48} />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:17, fontWeight:700, color:"#111827" }}>{sel}</div>
                <div style={{ fontSize:13, color:"#6B7280", marginTop:2 }}>
                  {selEntries.length} clases asignadas
                  {selConflicts.length > 0 && (
                    <span style={{ marginLeft:10, background:"#FEF2F2", color:"#DC2626", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>⚠️ {selConflicts.length} conflicto{selConflicts.length>1?"s":""}</span>
                  )}
                </div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {[...new Set(selEntries.map(e=>e.trayecto))].map(t=>(
                  <span key={t} style={{ background:TRAYECTO_BG[t]||"#f3f4f6", color:TRAYECTO_COLORS[t]||"#555", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>T.{t}</span>
                ))}
              </div>
            </div>
            {/* el resto del detalle del docente igual que antes, pero usando getDisplayMateria/getDisplayDocente */}
            {selConflicts.map((c,i) => (
              <div key={i} style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:10, padding:"12px 16px", marginBottom:10, display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:18 }}>⚠️</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:"#991B1B" }}>Conflicto: {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {c.hora}</div>
                  <div style={{ fontSize:12, color:"#B91C1C", marginTop:4 }}>{c.entries.map(e=>getDisplayMateria(parseClase(e.clase).materia)).join(" · ")}</div>
                </div>
              </div>
            ))}
            {/* tabla del docente (se mantiene igual, solo usar display names) */}
            <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    {["Día","Hora","Materia","Trayecto","Sección"].map(h=><th key={h} style={{ padding:"9px 14px", fontSize:11, fontWeight:600, color:"#6B7280", textAlign:"left", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {selEntries.sort((a,b)=>DAYS.indexOf(a.dia)-DAYS.indexOf(b.dia)).map((e,i) => {
                    const { materia } = parseClase(e.clase);
                    const displayMateria = getDisplayMateria(materia);
                    return (
                      <tr key={i} style={{ background: i%2===0?"#fff":"#FAFAFA" }}>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6" }}>{e.dia.charAt(0)+e.dia.slice(1).toLowerCase()}</td>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6", color:"#9CA3AF", whiteSpace:"nowrap" }}>{e.hora}</td>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6", fontWeight:500 }}>{displayMateria}</td>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6" }}>
                          <span style={{ background:TRAYECTO_BG[e.trayecto]||"#f3f4f6", color:TRAYECTO_COLORS[e.trayecto]||"#555", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>{e.trayecto}</span>
                        </td>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6", color:"#6B7280" }}>{e.sheet.trim()}</td>
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

// ---------- MateriasView (nuevo) ----------
function MateriasView({ byMateria, initialSel, onConsumeNav }) {
  const sorted = Object.keys(byMateria).sort();
  const [sel, setSel] = useState(initialSel || null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const { updateMateria, getDisplayMateria } = useOverrides();

  useEffect(() => {
    if (initialSel) { setSel(initialSel); onConsumeNav(); }
  }, [initialSel]);

  const filteredSorted = search
    ? sorted.filter(m => m.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const selEntries = sel ? byMateria[sel] : [];

  const startEdit = (displayName) => {
    setEditing(displayName);
    setEditValue(displayName);
  };
  const saveEdit = () => {
    if (editing && editValue.trim() && editValue !== editing) {
      // Buscar la materia original (la que está en RAW_DATA)
      const originalMat = RAW_DATA.find(d => {
        const { materia } = parseClase(d.clase);
        return getDisplayMateria(materia) === editing;
      })?.materia;
      if (originalMat) {
        updateMateria(originalMat, editValue);
      }
    }
    setEditing(null);
  };
  const handleKey = (e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); };

  return (
    <div style={{ padding:20, display:"flex", gap:16, height:"calc(100vh - 61px)", overflow:"hidden" }}>
      <div style={{ width:260, flexShrink:0, display:"flex", flexDirection:"column", gap:10 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filtrar materia…" style={{ fontSize:13, padding:"6px 12px", borderRadius:8, border:"1px solid #D1D5DB", background:"#fff", outline:"none" }} />
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", flex:1, overflowY:"auto" }}>
          <div style={{ padding:"8px 12px", fontSize:11, fontWeight:700, color:"#9CA3AF", textTransform:"uppercase", letterSpacing:"0.06em", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB" }}>
            {filteredSorted.length} materias
          </div>
          {filteredSorted.map(m => (
            <div key={m} onClick={()=>setSel(m)} style={{
              padding:"9px 12px", cursor:"pointer", fontSize:13,
              background: sel===m ? "#EFF6FF" : "transparent",
              color: sel===m ? "#1D4ED8" : "#374151",
              borderBottom:"1px solid #F3F4F6",
              display:"flex", justifyContent:"space-between", alignItems:"center",
              fontWeight: sel===m ? 600 : 400,
            }}>
              <div style={{ flex:1, minWidth:0 }}>
                {editing === m ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e=>setEditValue(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={handleKey}
                    style={{ fontSize:13, padding:"2px 6px", borderRadius:6, border:"1px solid #2563EB", outline:"none", width:"100%" }}
                  />
                ) : (
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{m}</span>
                )}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {!editing && (
                  <button onClick={(e)=>{ e.stopPropagation(); startEdit(m); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, padding:"2px 4px", borderRadius:4, color:"#9CA3AF" }}>✏️</button>
                )}
                <span style={{ fontSize:11, background:"#F3F4F6", borderRadius:10, padding:"1px 7px", color:"#6B7280", fontWeight:600 }}>{byMateria[m].length}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        {!sel ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:200, color:"#9CA3AF", fontSize:14 }}>
            Selecciona una materia para ver sus detalles
          </div>
        ) : (
          <>
            <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"16px 20px", marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:700, color:"#111827" }}>{sel}</div>
                  <div style={{ fontSize:13, color:"#6B7280", marginTop:2 }}>{selEntries.length} clases asignadas</div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {[...new Set(selEntries.map(e=>e.trayecto))].map(t=>(
                    <span key={t} style={{ background:TRAYECTO_BG[t]||"#f3f4f6", color:TRAYECTO_COLORS[t]||"#555", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>T.{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    {["Día","Hora","Docente","Trayecto","Sección"].map(h=><th key={h} style={{ padding:"9px 14px", fontSize:11, fontWeight:600, color:"#6B7280", textAlign:"left", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {selEntries.sort((a,b)=>DAYS.indexOf(a.dia)-DAYS.indexOf(b.dia)).map((e,i) => {
                    const { docente } = parseClase(e.clase);
                    const displayDocente = getDisplayDocente(docente);
                    return (
                      <tr key={i} style={{ background: i%2===0?"#fff":"#FAFAFA" }}>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6" }}>{e.dia.charAt(0)+e.dia.slice(1).toLowerCase()}</td>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6", color:"#9CA3AF", whiteSpace:"nowrap" }}>{e.hora}</td>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6" }}>{displayDocente || "—"}</td>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6" }}>
                          <span style={{ background:TRAYECTO_BG[e.trayecto]||"#f3f4f6", color:TRAYECTO_COLORS[e.trayecto]||"#555", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>{e.trayecto}</span>
                        </td>
                        <td style={{ padding:"10px 14px", fontSize:13, borderTop:"1px solid #F3F4F6", color:"#6B7280" }}>{e.sheet.trim()}</td>
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

// ---------- ConflictosView (con nombres editados) ----------
function ConflictosView({ conflicts, onGoDocente }) {
  const { getDisplayDocente, getDisplayMateria } = useOverrides();
  return (
    <div style={{ padding:20 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <h1 style={{ margin:0, fontSize:17, fontWeight:700 }}>⚠️ Conflictos detectados</h1>
        <span style={{ background:conflicts.length>0?"#FEF2F2":"#F0FDF4", color:conflicts.length>0?"#DC2626":"#16A34A", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>
          {conflicts.length} {conflicts.length===1?"conflicto":"conflictos"}
        </span>
      </div>
      {conflicts.length === 0 ? (
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"60px 20px", textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
          <div style={{ fontSize:17, fontWeight:600, color:"#111827" }}>Sin conflictos</div>
          <div style={{ fontSize:13, color:"#9CA3AF", marginTop:6 }}>No se detectaron solapamientos horarios.</div>
        </div>
      ) : (
        <>
          <div style={{ background:"#FFFBEB", borderRadius:10, border:"1px solid #FDE68A", padding:"14px 18px", marginBottom:20, display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ fontSize:20 }}>💡</span>
            <div style={{ fontSize:13, color:"#92400E" }}>Un conflicto ocurre cuando el mismo docente aparece asignado a dos grupos distintos en el mismo día y horario. Haz clic en el nombre del docente para ver su horario completo.</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {conflicts.map((c, i) => (
              <div key={i} style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", borderLeft:"4px solid #EF4444", padding:"14px 18px" }}>
                <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                  <span style={{ fontSize:20, flexShrink:0 }}>⚠️</span>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                      <button onClick={()=>onGoDocente(c.docente)} style={{ fontSize:14, fontWeight:700, color:"#DC2626", background:"none", border:"none", cursor:"pointer", padding:0, textDecoration:"underline" }}>
                        {getDisplayDocente(c.docente)}
                      </button>
                      <span style={{ fontSize:13, color:"#6B7280" }}>— {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {c.hora}</span>
                    </div>
                    <div style={{ fontSize:12, color:"#9CA3AF", marginBottom:8 }}>Aparece en {c.entries.length} clases simultáneas:</div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      {c.entries.map((e, j) => {
                        const { materia } = parseClase(e.clase);
                        const col = TRAYECTO_COLORS[e.trayecto]||"#555";
                        const bg = TRAYECTO_BG[e.trayecto]||"#f5f5f5";
                        return (
                          <div key={j} style={{ background:bg, borderLeft:`3px solid ${col}`, borderRadius:6, padding:"6px 12px", fontSize:12 }}>
                            <div style={{ fontWeight:600, color:col }}>{getDisplayMateria(materia)}</div>
                            <div style={{ color:col, opacity:0.7, fontSize:11 }}>{e.sheet.trim()} · T.{e.trayecto}</div>
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

// ---------- EstadisticasView (con nombres editados) ----------
function EstadisticasView({ stats, byDocente, byMateria }) {
  const trayectoCount = {};
  RAW_DATA.forEach(d => { trayectoCount[d.trayecto] = (trayectoCount[d.trayecto]||0)+1; });
  const dayCount = {};
  DAYS.forEach(d => { dayCount[d] = RAW_DATA.filter(r=>r.dia===d).length; });
  const maxDay = Math.max(...Object.values(dayCount));
  const topDocentes = Object.entries(byDocente).sort((a,b)=>b[1].length-a[1].length).slice(0,8);
  const maxDoc = Math.max(...topDocentes.map(([,e])=>e.length));
  const topMaterias = Object.entries(byMateria).sort((a,b)=>b[1].length-a[1].length).slice(0,6);
  const maxMat = topMaterias[0]?.[1] || 1;

  return (
    <div style={{ padding:20 }}>
      <h1 style={{ margin:"0 0 20px", fontSize:17, fontWeight:700 }}>📊 Estadísticas</h1>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
        <StatCard label="Total de clases" value={stats.total} icon="📅" color="#2563EB" />
        <StatCard label="Secciones" value={stats.secciones} icon="🏫" color="#059669" />
        <StatCard label="Docentes" value={stats.docentes} icon="👥" color="#7C3AED" />
        <StatCard label="Materias únicas" value={stats.materias} icon="📖" color="#D97706" />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#111827", marginBottom:14 }}>Clases por trayecto</div>
          {Object.entries(trayectoCount).sort().map(([t,c]) => (
            <div key={t} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <span style={{ background:TRAYECTO_BG[t]||"#f3f4f6", color:TRAYECTO_COLORS[t]||"#555", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>{t}</span>
              <div style={{ flex:1, background:"#F3F4F6", borderRadius:4, height:12, overflow:"hidden" }}>
                <div style={{ width:`${(c/stats.total)*100}%`, height:"100%", background:TRAYECTO_COLORS[t]||"#888", borderRadius:4 }} />
              </div>
              <span style={{ fontSize:12, width:32, textAlign:"right", color:"#6B7280", fontWeight:600 }}>{c}</span>
            </div>
          ))}
        </div>
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#111827", marginBottom:14 }}>Distribución por día</div>
          {DAYS.map(d => (
            <div key={d} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <span style={{ fontSize:12, width:80, color:"#6B7280", fontWeight:500 }}>{d.charAt(0)+d.slice(1).toLowerCase()}</span>
              <div style={{ flex:1, background:"#F3F4F6", borderRadius:4, height:12, overflow:"hidden" }}>
                <div style={{ width:`${(dayCount[d]/maxDay)*100}%`, height:"100%", background:"#059669", borderRadius:4 }} />
              </div>
              <span style={{ fontSize:12, width:32, textAlign:"right", color:"#6B7280", fontWeight:600 }}>{dayCount[d]}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#111827", marginBottom:14 }}>Docentes con mayor carga</div>
          {topDocentes.map(([doc, entries], idx) => (
            <div key={doc} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:700, color:"#D1D5DB", width:16 }}>{idx+1}</span>
              <span style={{ fontSize:12, flex:1, color:"#374151", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{doc}</span>
              <div style={{ width:100, background:"#F3F4F6", borderRadius:4, height:10, overflow:"hidden" }}>
                <div style={{ width:`${(entries.length/maxDoc)*100}%`, height:"100%", background:"#7C3AED", borderRadius:4 }} />
              </div>
              <span style={{ fontSize:12, width:24, textAlign:"right", color:"#6B7280", fontWeight:600 }}>{entries.length}</span>
            </div>
          ))}
        </div>
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#111827", marginBottom:14 }}>Materias más frecuentes</div>
          {topMaterias.map(([mat, cnt], idx) => (
            <div key={mat} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:700, color:"#D1D5DB", width:16 }}>{idx+1}</span>
              <span style={{ fontSize:12, flex:1, color:"#374151", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={mat}>{mat.length>28?mat.slice(0,26)+"…":mat}</span>
              <div style={{ width:100, background:"#F3F4F6", borderRadius:4, height:10, overflow:"hidden" }}>
                <div style={{ width:`${(cnt/maxMat)*100}%`, height:"100%", background:"#D97706", borderRadius:4 }} />
              </div>
              <span style={{ fontSize:12, width:24, textAlign:"right", color:"#6B7280", fontWeight:600 }}>{cnt}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Envuelve la aplicación con el proveedor de sobrescrituras
function AppWithProvider() {
  return (
    <OverridesProvider>
      <App />
    </OverridesProvider>
  );
}

export default AppWithProvider;
