import React, { useState, useEffect, useCallback, useRef } from "react";
import useAppData from "./hooks/useAppData";
import useHorariosFilters from "./hooks/useHorariosFilters";
import LoginScreen from "./components/LoginScreen";
import GlobalSearch from "./components/GlobalSearch";
import Toast from "./components/Toast";
import ResumenView from "./components/ResumenView";
import HorariosView from "./components/HorariosView";
import SeccionesView from "./components/SeccionesView";
import DocentesView from "./components/DocentesView";
import MateriasView from "./components/MateriasView";
import AsistenciasView from "./components/AsistenciasView";
import ConfirmModal from "./components/ConfirmModal";
import ConflictosView from "./components/ConflictosView";
import HistorialView from "./components/HistorialView";
import { S } from "./constants";
import { getCurrentLapso, getLapsosDisponibles, formatLapso } from "./utils/lapso";
import { supabase, supabaseConfigError } from "./lib/supabase";

// ── Grupos de navegación ──────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: "Consulta",
    items: [
      { id: "resumen",    emoji: "📊", label: "Resumen"     },
      { id: "horarios",  emoji: "📅", label: "Horarios"    },
      { id: "secciones", emoji: "🏫", label: "Secciones"   },
    ],
  },
  {
    label: "Académico",
    items: [
      { id: "docentes",    emoji: "👥", label: "Docentes"    },
      { id: "materias",    emoji: "📖", label: "Materias"    },
      { id: "asistencias", emoji: "🖨️", label: "Asistencias" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { id: "conflictos", emoji: "⚠️", label: "Conflictos", hasBadge: true },
      { id: "historial",  emoji: "🗂️", label: "Historial"  },
    ],
  },
];

// ── Estilos globales ──────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; }

  /* Sidebar */
  .sb { transition: width 0.22s cubic-bezier(.4,0,.2,1); overflow: hidden; }
  .sb-collapsed { width: 56px !important; }
  .sb-expanded  { width: 220px !important; }

  /* Etiquetas y separadores en sidebar */
  .sb-label { transition: opacity 0.15s, width 0.15s; white-space: nowrap; overflow: hidden; }
  .sb-collapsed .sb-label  { opacity: 0; width: 0; }
  .sb-expanded  .sb-label  { opacity: 1; }
  .sb-collapsed .sb-group-title { opacity: 0; }
  .sb-expanded  .sb-group-title { opacity: 1; }

  /* Nav item */
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 10px; border-radius: 7px; cursor: pointer;
    border: none; background: transparent; width: 100%;
    color: #64748B; font-size: 13px; text-align: left;
    transition: background 0.13s, color 0.13s;
    position: relative;
  }
  .nav-item:hover  { background: #1E293B; color: #CBD5E1; }
  .nav-item.active { background: #1E3A8A; color: #93C5FD; font-weight: 600;
                     border-left: 2px solid #3B82F6; }

  /* Tooltip cuando colapsado */
  .nav-item .tooltip {
    display: none; position: absolute; left: 52px; top: 50%;
    transform: translateY(-50%);
    background: #1E293B; color: #E2E8F0; font-size: 12px; font-weight: 500;
    padding: 5px 10px; border-radius: 6px; white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 999;
    pointer-events: none;
  }
  .sb-collapsed .nav-item:hover .tooltip { display: block; }

  /* Admin dropdown */
  .admin-menu {
    position: absolute; bottom: 52px; left: 8px; right: 8px;
    background: #1E293B; border: 1px solid #334155;
    border-radius: 10px; padding: 6px;
    box-shadow: 0 -4px 24px rgba(0,0,0,0.35); z-index: 400;
    animation: fadeUp .15s ease;
  }
  .sb-collapsed .admin-menu { left: 56px; bottom: 8px; width: 200px; right: auto; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  .admin-item {
    display: flex; align-items: center; gap: 9px;
    width: 100%; padding: 8px 10px; border-radius: 7px;
    border: none; background: transparent; cursor: pointer;
    font-size: 13px; color: #CBD5E1; text-align: left;
    transition: background 0.12s;
  }
  .admin-item:hover { background: #334155; }
  .admin-item.danger { color: #F87171; }
  .admin-item.danger:hover { background: #450A0A; }
  .admin-item:disabled { opacity: 0.4; cursor: not-allowed; }
  .admin-divider { height: 1px; background: #334155; margin: 4px 0; }

  /* Pin button */
  .pin-btn {
    background: none; border: none; cursor: pointer; padding: 4px 6px;
    border-radius: 5px; color: #334155; font-size: 13px;
    transition: color 0.12s, background 0.12s;
  }
  .pin-btn:hover { background: #1E293B; color: #60A5FA; }
  .pin-btn.pinned { color: #60A5FA; }

  /* Header */
  .topbar { background: #fff; border-bottom: 1px solid #E5E7EB;
             display: flex; align-items: center; gap: 10px;
             padding: 0 20px; height: 52px; flex-shrink: 0; }

  /* Badge */
  .badge-red { background: #EF4444; color: #fff; border-radius: 10px;
               font-size: 10px; padding: 1px 5px; font-weight: 700; line-height: 1.4; }

  /* Modo consulta banner */
  .consulta-pill {
    font-size: 11px; background: #FFFBEB; color: #92400E;
    border: 1px solid #FDE68A; border-radius: 6px;
    padding: 3px 10px; font-weight: 600; white-space: nowrap;
  }
  .activo-pill {
    font-size: 11px; background: #EFF6FF; color: #1E40AF;
    border: 1px solid #BFDBFE; border-radius: 6px;
    padding: 3px 10px; font-weight: 600; white-space: nowrap;
  }

  /* Mobile */
  @media (max-width: 768px) {
    .sb { position: fixed !important; z-index: 300; height: 100vh;
          transform: translateX(-100%); transition: transform .25s, width .22s; }
    .sb.mobile-open { transform: translateX(0); }
    .sb-overlay { display: block !important; }
    .hamburger { display: flex !important; }
    .global-search { max-width: 160px !important; }
    .stats-grid-4 { grid-template-columns: repeat(2,1fr) !important; }
    .docentes-layout, .materias-layout, .secciones-layout { flex-direction: column !important; height: auto !important; }
    .docentes-left-panel, .materias-left-panel, .secciones-left-panel { width: 100% !important; max-height: 220px; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// ── Admin dropdown ────────────────────────────────────────────────────────────
function AdminMenu({ appData, onClose, modoConsulta }) {
  const ref = useRef(null);
  const fileRef = useRef(null);
  const backupRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const disabled = appData.uploading || appData.loading;

  return (
    <div ref={ref} className="admin-menu">
      {/* Sección: datos */}
      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", padding: "4px 10px 6px" }}>
        Datos del trimestre
      </div>

      {!modoConsulta && (
        <>
          <button className="admin-item" disabled={disabled}
            onClick={() => { fileRef.current?.click(); onClose(); }}>
            <span>📂</span> Cargar Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) appData.handleFileUpload(e.target.files[0]); e.target.value = ""; }} />
        </>
      )}

      <button className="admin-item" disabled={disabled || !appData.data.length}
        onClick={() => { appData.exportarDatos(); onClose(); }}>
        <span>💾</span> Exportar backup
      </button>

      {!modoConsulta && (
        <>
          <button className="admin-item" disabled={disabled}
            onClick={() => backupRef.current?.click()}>
            <span>📥</span> Restaurar backup
          </button>
          <input ref={backupRef} type="file" accept=".json" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) { appData.importarDatos(e.target.files[0]); onClose(); } e.target.value = ""; }} />
        </>
      )}

      {!modoConsulta && (
        <>
          <div className="admin-divider" />
          <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", padding: "4px 10px 6px" }}>
            Zona de peligro
          </div>
          <button className="admin-item danger" disabled={disabled || !appData.data.length}
            onClick={() => { appData.clearAllData(); onClose(); }}>
            <span>🗑️</span> Borrar datos del trimestre
          </button>
        </>
      )}

      <div className="admin-divider" />

      {/* Estado de conexión */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: appData.isOffline ? "#EF4444" : "#22C55E" }} />
        <span style={{ fontSize: 11, color: appData.isOffline ? "#FCA5A5" : "#4ADE80", fontWeight: 600 }}>
          {appData.isOffline ? "Sin conexión" : "En línea"}
        </span>
        {appData.data.length > 0 && (
          <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto" }}>
            {appData.data.length} registros
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: "#334155", padding: "0 10px 4px" }}>
        Últ. sync: {appData.lastSync}
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function App() {
  const [view,        setView]        = useState("resumen");
  const [docenteNav,  setDocenteNav]  = useState(null);
  const [materiaNav,  setMateriaNav]  = useState(null);
  const [lapso,       setLapso]       = useState(() => getCurrentLapso());
  const [modoConsulta,setModoConsulta]= useState(false);

  // Sidebar state: expanded (hover o fijado), pinned (fijado por el usuario), mobileOpen
  const [hovered,    setHovered]    = useState(false);
  const [pinned,     setPinned]     = useState(() => localStorage.getItem("sb_pinned") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminOpen,  setAdminOpen]  = useState(false);

  const expanded = pinned || hovered || mobileOpen;

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem("sb_pinned", next ? "1" : "0");
  };

  // Trimestre: detectar si es consulta histórica
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.from("trimestres").select("estado").eq("lapso", lapso).single();
      setModoConsulta(data?.estado === "cerrado" || data?.estado === "archivado");
    };
    check();
  }, [lapso]);

  const handleCambiarLapso = useCallback((nuevo) => {
    setLapso(nuevo);
    setView("resumen");
  }, []);

  const appData        = useAppData(lapso);
  const horariosFilters = useHorariosFilters(appData.data);

  const handleNavigate = (r) => {
    if (r.docente) { setDocenteNav(r.rawDocente || r.docente); setView("docentes"); }
    else if (r.materia) { setMateriaNav(r.rawMateria); setView("materias"); }
    else setView("horarios");
  };

  // ── Guards ────────────────────────────────────────────────────────────────
  if (supabaseConfigError) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      height:"100vh", background:"#0F172A", color:"#E2E8F0", gap:16, padding:32, textAlign:"center", fontFamily:"system-ui,sans-serif" }}>
      <span style={{ fontSize:48 }}>⚠️</span>
      <h2 style={{ margin:0, fontSize:20, fontWeight:600, color:"#F1F5F9" }}>Configuración incompleta</h2>
      <p style={{ margin:0, fontSize:14, color:"#94A3B8", maxWidth:460, lineHeight:1.6 }}>{supabaseConfigError}</p>
    </div>
  );
  if (appData.user === undefined) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh",
      background:"#0F172A", color:"#94A3B8", fontFamily:"system-ui,sans-serif", fontSize:15 }}>
      Verificando sesión…
    </div>
  );
  if (!appData.user) return <LoginScreen />;
  if (appData.loading && !appData.data.length) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      height:"100vh", background:"#0F172A", gap:16, fontFamily:"system-ui,sans-serif" }}>
      <div style={{ width:36, height:36, border:"3px solid #1E3A5F", borderTop:"3px solid #3B82F6",
        borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ color:"#94A3B8", fontSize:14 }}>Cargando horarios…</span>
    </div>
  );

  // Conflictos count para badge
  const conflictCount = appData.conflicts.length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"system-ui,-apple-system,sans-serif",
      background:"#F3F4F6", overflow:"hidden" }}>
      <style>{GLOBAL_CSS}</style>

      {appData.toast && <Toast message={appData.toast.message} type={appData.toast.type} onClose={appData.hideToast} />}
      <ConfirmModal
        open={!!appData.confirmModal}
        title={appData.confirmModal?.title}
        message={appData.confirmModal?.message}
        confirmLabel={appData.confirmModal?.confirmLabel}
        danger={appData.confirmModal?.danger}
        onConfirm={appData.confirmModal?.onConfirm}
        onCancel={appData.closeConfirm}
      />

      {/* Overlay móvil */}
      <div className="sb-overlay" onClick={() => setMobileOpen(false)}
        style={{ display:"none", position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:299 }} />

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside
        className={`sb ${expanded ? "sb-expanded" : "sb-collapsed"} ${mobileOpen ? "mobile-open" : ""}`}
        onMouseEnter={() => !pinned && setHovered(true)}
        onMouseLeave={() => { if (!pinned) { setHovered(false); setAdminOpen(false); } }}
        style={{ background:"#0F172A", display:"flex", flexDirection:"column",
          flexShrink:0, borderRight:"1px solid #1E293B", position:"relative" }}
      >
        {/* Marca + pin */}
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"14px 10px 12px",
          borderBottom:"1px solid #1E293B", flexShrink:0 }}>
          <div style={{ width:32, height:32, borderRadius:8, flexShrink:0,
            background:"linear-gradient(135deg,#2563EB,#7C3AED)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>
            🎓
          </div>
          <div className="sb-label" style={{ flex:1, overflow:"hidden" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#F1F5F9", whiteSpace:"nowrap" }}>Horarios PNF</div>
            <div style={{ fontSize:10, color:"#475569", marginTop:1, whiteSpace:"nowrap" }}>Sistema de gestión</div>
          </div>
          {expanded && (
            <button className={`pin-btn ${pinned ? "pinned" : ""}`} onClick={togglePin}
              title={pinned ? "Desfijar sidebar" : "Fijar sidebar"}>
              {pinned ? "📌" : "📍"}
            </button>
          )}
        </div>

        {/* Trimestre activo */}
        <div style={{ padding:"10px 10px 10px", borderBottom:"1px solid #1E293B", flexShrink:0 }}>
          <div style={{ width:32, height:32, borderRadius:7, flexShrink:0,
            background: modoConsulta ? "#451A03" : "#0C1A3A",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:14,
            cursor: modoConsulta ? "pointer" : "default",
            ...(expanded ? { display:"none" } : {}) }}
            onClick={() => modoConsulta && handleCambiarLapso(getCurrentLapso())}
            title={modoConsulta ? `Historial: ${lapso} — clic para volver` : `Trimestre activo: ${lapso}`}
          >
            {modoConsulta ? "📂" : "📅"}
          </div>
          {expanded && (
            <div>
              <div style={{ fontSize:9, fontWeight:700, color:"#334155", textTransform:"uppercase",
                letterSpacing:"0.08em", marginBottom:3 }}>
                {modoConsulta ? "📂 Consultando historial" : "📅 Trimestre activo"}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:13, fontWeight:700, color: modoConsulta ? "#FBBF24" : "#60A5FA",
                  flex:1, whiteSpace:"nowrap" }}>
                  {formatLapso(lapso)}
                </span>
                {modoConsulta && (
                  <button onClick={() => handleCambiarLapso(getCurrentLapso())}
                    style={{ fontSize:10, padding:"2px 7px", borderRadius:5, border:"1px solid #334155",
                      background:"#1E293B", color:"#60A5FA", cursor:"pointer", fontWeight:600, flexShrink:0 }}>
                    ↩
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Selector de programa */}
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #1E293B", flexShrink:0 }}>
          {expanded ? (
            <select value={appData.selectedPrograma} onChange={e => appData.setSelectedPrograma(e.target.value)}
              style={{ ...S.select, width:"100%", background:"#1E293B", color:"#CBD5E1",
                borderColor:"#334155", fontSize:12, padding:"6px 8px" }}>
              {appData.programasDisponibles.map(p => (
                <option key={p} value={p}>{p === "todos" ? "Todos los programas" : p}</option>
              ))}
            </select>
          ) : (
            <div style={{ width:32, height:32, borderRadius:7, background:"#1E293B",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:13, color:"#475569", cursor:"default" }}
              title={`Programa: ${appData.selectedPrograma === "todos" ? "Todos" : appData.selectedPrograma}`}>
              🎓
            </div>
          )}
        </div>

        {/* Navegación */}
        <nav style={{ flex:1, padding:"8px 8px 6px", overflowY:"auto", overflowX:"hidden" }}>
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label} style={{ marginBottom: gi < NAV_GROUPS.length - 1 ? 4 : 0 }}>
              {/* Separador con etiqueta */}
              {gi > 0 && (
                <div style={{ height:1, background:"#1E293B", margin:"6px 4px 8px" }} />
              )}
              <div className="sb-group-title" style={{
                fontSize:9, fontWeight:700, color:"#334155", textTransform:"uppercase",
                letterSpacing:"0.1em", padding:"0 8px", marginBottom:4,
                transition:"opacity 0.15s",
              }}>
                {group.label}
              </div>

              {group.items.map(item => {
                const active = view === item.id;
                const badge  = item.hasBadge ? conflictCount : 0;
                return (
                  <button key={item.id}
                    className={`nav-item ${active ? "active" : ""}`}
                    onClick={() => { setView(item.id); setMobileOpen(false); }}
                  >
                    <span style={{ fontSize:15, flexShrink:0, width:20, textAlign:"center" }}>
                      {item.emoji}
                    </span>
                    <span className="sb-label" style={{ flex:1 }}>{item.label}</span>
                    {badge > 0 && <span className="badge-red">{badge}</span>}
                    {/* Tooltip solo cuando colapsado */}
                    <span className="tooltip">
                      {item.label}{badge > 0 ? ` (${badge})` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Admin dropdown */}
        {adminOpen && (
          <AdminMenu
            appData={appData}
            modoConsulta={modoConsulta}
            onClose={() => setAdminOpen(false)}
          />
        )}

        {/* Footer: botón admin + usuario */}
        <div style={{ borderTop:"1px solid #1E293B", padding:"8px 8px", flexShrink:0 }}>
          {/* Botón de administración */}
          <button
            onClick={() => setAdminOpen(o => !o)}
            className="nav-item"
            style={{ marginBottom:6, color: adminOpen ? "#93C5FD" : "#64748B",
              background: adminOpen ? "#1E293B" : "transparent" }}
            title="Administración"
          >
            <span style={{ fontSize:15, flexShrink:0, width:20, textAlign:"center" }}>⚙️</span>
            <span className="sb-label" style={{ flex:1 }}>Administración</span>
            {appData.uploading && (
              <span style={{ width:8, height:8, borderRadius:"50%", border:"1.5px solid #3B82F6",
                borderTop:"1.5px solid transparent", animation:"spin .7s linear infinite", flexShrink:0 }} />
            )}
            <span className="tooltip">Administración</span>
          </button>

          {/* Usuario */}
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 4px 0" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0,
              background:"linear-gradient(135deg,#2563EB,#7C3AED)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:12, fontWeight:700, color:"#fff" }}>
              {appData.user.email?.[0]?.toUpperCase() ?? "A"}
            </div>
            <div className="sb-label" style={{ flex:1, overflow:"hidden" }}>
              <div style={{ fontSize:11, color:"#94A3B8", overflow:"hidden",
                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {appData.user.email}
              </div>
            </div>
            {expanded && (
              <button onClick={appData.handleLogout} title="Cerrar sesión"
                style={{ background:"none", border:"1px solid #1E293B", borderRadius:6,
                  cursor:"pointer", color:"#475569", fontSize:12, padding:"3px 7px", flexShrink:0 }}>
                ⏏
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── CONTENIDO PRINCIPAL ──────────────────────────────────────────── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minWidth:0 }}>

        {/* Topbar */}
        <header className="topbar">
          {/* Hamburger (mobile) */}
          <button className="hamburger"
            onClick={() => setMobileOpen(o => !o)}
            style={{ display:"none", background:"none", border:"1px solid #E5E7EB",
              borderRadius:6, padding:"5px 9px", cursor:"pointer", fontSize:17,
              color:"#374151", flexShrink:0, alignItems:"center" }}>
            ☰
          </button>

          {/* Búsqueda */}
          <div style={{ flex:1, maxWidth:420 }}>
            <GlobalSearch
              onNavigate={handleNavigate}
              docenteNames={appData.docenteNames}
              materiaNames={appData.materiaNames}
              data={appData.data}
            />
          </div>

          {/* Syncing */}
          {appData.isSyncing && (
            <span style={{ fontSize:11, color:"#94A3B8", whiteSpace:"nowrap", flexShrink:0 }}>
              🔄 Actualizando…
            </span>
          )}

          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            {/* Pill de trimestre */}
            {modoConsulta
              ? <span className="consulta-pill">📂 Historial · {formatLapso(lapso)}</span>
              : <span className="activo-pill">📅 {formatLapso(lapso)}</span>
            }
          </div>
        </header>

        {/* Banner modo consulta */}
        {modoConsulta && (
          <div style={{ background:"#FFFBEB", borderBottom:"1px solid #FDE68A",
            padding:"7px 20px", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <span style={{ fontSize:13, color:"#92400E", fontWeight:600 }}>
              📂 Modo consulta — estás viendo el trimestre {formatLapso(lapso)} (solo lectura)
            </span>
            <button onClick={() => handleCambiarLapso(getCurrentLapso())}
              style={{ marginLeft:"auto", fontSize:12, padding:"4px 12px", borderRadius:6,
                border:"1px solid #FDE68A", background:"#fff", color:"#92400E",
                cursor:"pointer", fontWeight:600, flexShrink:0 }}>
              ↩ Volver al trimestre activo
            </button>
          </div>
        )}

        {/* Vistas */}
        <main style={{ flex:1, overflow:"auto" }}>
          {view === "resumen" && (
            <ResumenView
              stats={appData.stats} data={appData.data}
              byDocente={appData.byDocente} byMateria={appData.byMateria}
              conflicts={appData.conflicts}
              getDocName={appData.getDocName} getMateriaName={appData.getMateriaName}
            />
          )}
          {view === "horarios" && (
            <HorariosView
              filtered={appData.data.filter(d =>
                (horariosFilters.selectedTrayecto === "all" || d.trayecto === horariosFilters.selectedTrayecto) &&
                (horariosFilters.selectedSeccion  === "all" || d.sheet.trim() === horariosFilters.selectedSeccion) &&
                (horariosFilters.activeDay        === "all" || d.dia === horariosFilters.activeDay)
              )}
              selectedTrayecto={horariosFilters.selectedTrayecto}
              setSelectedTrayecto={horariosFilters.setSelectedTrayecto}
              selectedSeccion={horariosFilters.selectedSeccion}
              setSelectedSeccion={horariosFilters.setSelectedSeccion}
              activeDay={horariosFilters.activeDay}
              setActiveDay={horariosFilters.setActiveDay}
              seccionesByTrayecto={horariosFilters.seccionesByTrayecto}
              expandedCell={horariosFilters.expandedCell}
              setExpandedCell={horariosFilters.setExpandedCell}
              getDocName={appData.getDocName}
              getMateriaName={appData.getMateriaName}
              allTrayectos={appData.allTrayectos}
              conflicts={appData.conflicts}
              onGoDocente={(d) => { setDocenteNav(d); setView("docentes"); }}
            />
          )}
          {view === "secciones" && (
            <SeccionesView data={appData.data} getDocName={appData.getDocName} getMateriaName={appData.getMateriaName} />
          )}
          {view === "docentes" && (
            <DocentesView byDocente={appData.byDocente} conflicts={appData.conflicts}
              initialSel={docenteNav} onConsumeNav={() => setDocenteNav(null)}
              getDocName={appData.getDocName} onSaveDocenteName={appData.saveDocenteName} />
          )}
          {view === "materias" && (
            <MateriasView byMateria={appData.byMateria} initialSel={materiaNav}
              onConsumeNav={() => setMateriaNav(null)}
              getMateriaName={appData.getMateriaName} onSaveMateriaName={appData.saveMateriaName}
              data={appData.data} getDocName={appData.getDocName} />
          )}
          {view === "asistencias" && (
            <AsistenciasView data={appData.data} getDocName={appData.getDocName}
              getMateriaName={appData.getMateriaName} lapso={lapso} />
          )}
          {view === "conflictos" && (
            <ConflictosView conflicts={appData.conflicts} getDocName={appData.getDocName}
              onGoDocente={(d) => { setDocenteNav(d); setView("docentes"); }} />
          )}
          {view === "historial" && (
            <HistorialView
              lapsoActivo={lapso}
              onCambiarLapso={handleCambiarLapso}
              showToast={appData.showToast}
              openConfirm={appData.openConfirm}
              closeConfirm={appData.closeConfirm}
              user={appData.user}
            />
          )}
        </main>
      </div>
    </div>
  );
}
