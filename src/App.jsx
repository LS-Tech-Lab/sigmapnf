import React, { useState } from "react";
import useAppData from "./hooks/useAppData";
import LoginScreen from "./components/LoginScreen";
import ResponsiveStyles from "./components/ResponsiveStyles";
import GlobalSearch from "./components/GlobalSearch";
import Toast from "./components/Toast";
import DashboardView from "./components/DashboardView";
import HorariosView from "./components/HorariosView";
import SeccionesView from "./components/SeccionesView";
import DocentesView from "./components/DocentesView";
import MateriasView from "./components/MateriasView";
import AsistenciasView from "./components/AsistenciasView";
import ConflictosView from "./components/ConflictosView";
import EstadisticasView from "./components/EstadisticasView";
import { NAV_ITEMS, S } from "./constants";

export default function App() {
  const [view, setView] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedTrayecto, setSelectedTrayecto] = useState("all");
  const [selectedSeccion, setSelectedSeccion] = useState("all");
  const [activeDay, setActiveDay] = useState("all");
  const [expandedCell, setExpandedCell] = useState(null);
  const [docenteNav, setDocenteNav] = useState(null);
  const [materiaNav, setMateriaNav] = useState(null);

  const appData = useAppData();

  if (appData.user === undefined) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", color: "#94A3B8", fontFamily: "system-ui, sans-serif", fontSize: 15 }}>Verificando sesión…</div>;
  if (!appData.user) return <LoginScreen />;
  if (appData.loading && !appData.data.length) return <div style={{ padding: 20, textAlign: "center", fontSize: 15, fontWeight: 500 }}>Cargando horarios...</div>;

  const handleNavigate = (r) => {
    if (r.docente) { setDocenteNav(r.rawDocente || r.docente); setView("docentes"); }
    else if (r.materia) { setMateriaNav(r.rawMateria); setView("materias"); }
    else setView("horarios");
  };

  const seccionesByTrayecto = React.useMemo(() => {
    return [...new Set(appData.data.map(d => d.sheet.trim()))].sort().filter(s =>
      selectedTrayecto === "all" || appData.data.some(d => d.sheet.trim() === s && d.trayecto === selectedTrayecto)
    );
  }, [selectedTrayecto, appData.data]);

  const nav = NAV_ITEMS.map(item => ({ ...item, badge: item.hasBadge ? appData.conflicts.length : 0 }));

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", background: "#F3F4F6", overflow: "hidden" }}>
      <ResponsiveStyles />
      {appData.toast && <Toast message={appData.toast.message} type={appData.toast.type} onClose={() => appData.showToast(null)} />}
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} style={{ display: "none", position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 299 }} />
      <aside className={`sidebar-aside${sidebarOpen ? " open" : ""}`} style={{ width: 220, background: "#111827", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>PNF</div>
          <select value={appData.selectedPrograma} onChange={e => appData.setSelectedPrograma(e.target.value)} style={{ ...S.select, width: "100%", background: "#1F2937", color: "#fff", borderColor: "#374151", marginBottom: 12 }}>
            {appData.programasDisponibles.map(p => <option key={p} value={p}>{p === "todos" ? "📋 Todos los programas" : p}</option>)}
          </select>
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#1F2937", borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 12, color: "#9CA3AF" }}>Clases</span><span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{appData.stats.total}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 12, color: "#9CA3AF" }}>Secciones</span><span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{appData.stats.secciones}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#9CA3AF" }}>Docentes</span><span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{appData.stats.docentes}</span></div>
          </div>
          <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 6, background: appData.isOffline ? "#FEF2F2" : "#F0FDF4", display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: appData.isOffline ? "#DC2626" : "#16A34A", flexShrink: 0 }}></span>
            <span style={{ color: appData.isOffline ? "#991B1B" : "#065F46", fontWeight: 600 }}>{appData.isOffline ? "Modo offline" : "En línea"}</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 9, color: "#6B7280", textAlign: "center" }}>Última sinc: {appData.lastSync}</div>
        </div>
        <nav style={{ flex: 1, padding: "8px 10px", overflowY: "auto" }}>
          {nav.map(item => (
            <button key={item.id} onClick={() => { setView(item.id); setSidebarOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px",
                border: "none", borderRadius: 8, background: view === item.id ? "#2563EB" : "transparent",
                color: view === item.id ? "#fff" : "#9CA3AF", cursor: "pointer", fontSize: 14,
                textAlign: "left", marginBottom: 2, fontWeight: view === item.id ? 600 : 400
              }}
            >
              <span style={{ fontSize: 15 }}>{item.emoji}</span><span style={{ flex: 1 }}>{item.label}</span>
              {item.badge > 0 && <span style={{ background: "#EF4444", color: "#fff", borderRadius: 10, fontSize: 11, padding: "2px 7px", fontWeight: 700 }}>{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div style={{ padding: "12px 14px", borderTop: "1px solid #1F2937" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={appData.exportarDatos} disabled={appData.uploading || !appData.data.length} style={{ flex: 1, cursor: appData.data.length ? "pointer" : "not-allowed", background: "#059669", color: "#fff", textAlign: "center", padding: "7px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", opacity: appData.data.length ? 1 : 0.5 }}>💾 Backup</button>
            <label htmlFor="import-backup" style={{ flex: 1, cursor: "pointer", background: "#D97706", color: "#fff", textAlign: "center", padding: "7px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, marginBottom: 0 }}>📥 Restaurar</label>
            <input id="import-backup" type="file" accept=".json" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) appData.importarDatos(e.target.files[0]); e.target.value = ""; }} disabled={appData.uploading} />
          </div>
          <label htmlFor="upload-excel" style={{ display: "block", cursor: "pointer", background: "#2563EB", color: "#fff", textAlign: "center", padding: "7px 12px", borderRadius: 6, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📂 Cargar Excel</label>
          <input id="upload-excel" type="file" accept=".xlsx, .xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) appData.handleFileUpload(e.target.files[0]); e.target.value = ""; }} disabled={appData.uploading} />
          <button onClick={appData.clearAllData} disabled={appData.loading || !appData.data.length} style={{ display: "block", width: "100%", cursor: appData.data.length ? "pointer" : "not-allowed", background: "#DC2626", color: "#fff", textAlign: "center", padding: "7px 12px", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "none", opacity: appData.data.length ? 1 : 0.5 }}>🗑️ Borrar datos</button>
          {appData.uploading && <div style={{ fontSize: 11, marginTop: 6, color: "#9CA3AF" }}>Procesando...</div>}
          {appData.error && <div style={{ fontSize: 11, marginTop: 6, color: "#EF4444" }}>{appData.error}</div>}
          {appData.data.length > 0 && !appData.uploading && !appData.loading && <div style={{ fontSize: 11, marginTop: 6, color: "#6B7280", textAlign: "center" }}>{appData.data.length} registros cargados</div>}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid #1F2937", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#2563EB,#7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{appData.user.email?.[0]?.toUpperCase() ?? "A"}</div>
          <div style={{ flex: 1, overflow: "hidden" }}><div style={{ fontSize: 12, color: "#D1D5DB", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{appData.user.email}</div></div>
          <button onClick={appData.handleLogout} title="Cerrar sesión" style={{ background: "none", border: "1px solid #374151", borderRadius: 6, cursor: "pointer", color: "#6B7280", fontSize: 14, padding: "3px 7px", flexShrink: 0 }}>⏏</button>
        </div>
      </aside>
      <div className="main-content" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header className="header-bar" style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen(o => !o)} className="hamburger-btn" style={{ display: "none", background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 18, color: "#374151", flexShrink: 0 }}>☰</button>
          <GlobalSearch onNavigate={handleNavigate} docenteNames={appData.docenteNames} materiaNames={appData.materiaNames} data={appData.data} />
          <div className="header-stats" style={{ marginLeft: "auto", fontSize: 13, color: "#6B7280", fontWeight: 500 }}>{appData.stats.total} registros · {appData.stats.materias} materias</div>
        </header>
        <main style={{ flex: 1, overflow: "auto" }}>
          {view === "dashboard" && <DashboardView stats={appData.stats} data={appData.data} byDocente={appData.byDocente} byMateria={appData.byMateria} conflicts={appData.conflicts} getDocName={appData.getDocName} getMateriaName={appData.getMateriaName} />}
          {view === "horarios" && <HorariosView filtered={appData.data.filter(d => (selectedTrayecto === "all" || d.trayecto === selectedTrayecto) && (selectedSeccion === "all" || d.sheet.trim() === selectedSeccion) && (activeDay === "all" || d.dia === activeDay))} selectedTrayecto={selectedTrayecto} setSelectedTrayecto={setSelectedTrayecto} selectedSeccion={selectedSeccion} setSelectedSeccion={setSelectedSeccion} activeDay={activeDay} setActiveDay={setActiveDay} seccionesByTrayecto={seccionesByTrayecto} expandedCell={expandedCell} setExpandedCell={setExpandedCell} getDocName={appData.getDocName} getMateriaName={appData.getMateriaName} allTrayectos={appData.allTrayectos} />}
          {view === "secciones" && <SeccionesView data={appData.data} getDocName={appData.getDocName} getMateriaName={appData.getMateriaName} />}
          {view === "docentes" && <DocentesView byDocente={appData.byDocente} conflicts={appData.conflicts} initialSel={docenteNav} onConsumeNav={() => setDocenteNav(null)} getDocName={appData.getDocName} onSaveDocenteName={appData.saveDocenteName} />}
          {view === "materias" && <MateriasView byMateria={appData.byMateria} initialSel={materiaNav} onConsumeNav={() => setMateriaNav(null)} getMateriaName={appData.getMateriaName} onSaveMateriaName={appData.saveMateriaName} data={appData.data} getDocName={appData.getDocName} />}
          {view === "asistencias" && <AsistenciasView data={appData.data} getDocName={appData.getDocName} getMateriaName={appData.getMateriaName} />}
          {view === "conflictos" && <ConflictosView conflicts={appData.conflicts} onGoDocente={(d) => { setDocenteNav(d); setView("docentes"); }} getDocName={appData.getDocName} />}
          {view === "estadisticas" && <EstadisticasView stats={appData.stats} byDocente={appData.byDocente} byMateria={appData.byMateria} data={appData.data} getDocName={appData.getDocName} getMateriaName={appData.getMateriaName} />}
        </main>
      </div>
    </div>
  );
}
