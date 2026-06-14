import React, { useState, useEffect, useCallback } from "react";
import useAppData from "./hooks/useAppData";
import useHorariosFilters from "./hooks/useHorariosFilters";
import LoginScreen from "./components/LoginScreen";
import ResponsiveStyles from "./components/ResponsiveStyles";
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
import { NAV_ITEMS, S } from "./constants";
import { getCurrentLapso, getLapsosDisponibles, formatLapso, getSiguienteLapso } from "./utils/lapso";
import { supabase } from "./lib/supabase";
import { supabaseConfigError } from "./lib/supabase";

// ── Íconos de navegación incluye historial ─────────────────────────────────
const NAV_CON_HISTORIAL = [
  ...NAV_ITEMS,
  { id: "historial", emoji: "🗂️", label: "Historial" },
];

export default function App() {
  const [view, setView] = useState("resumen");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [docenteNav, setDocenteNav] = useState(null);
  const [materiaNav, setMateriaNav] = useState(null);

  // ── Trimestre activo ───────────────────────────────────────────────────────
  // Se inicializa con el trimestre calculado por fecha, pero luego se puede
  // cambiar desde el historial (p.ej. para consultar un trimestre pasado).
  const [lapso, setLapso] = useState(() => getCurrentLapso());
  const [modoConsulta, setModoConsulta] = useState(false); // true = viendo trimestre archivado
  const lapsosDisponibles = React.useMemo(() => getLapsosDisponibles(lapso), [lapso]);

  // Cuando el lapso cambia, detectar si es el activo o uno archivado
  const lapsoActual = getCurrentLapso();

  // Resolver si el lapso seleccionado es el activo o uno pasado
  useEffect(() => {
    // Consultar BD para saber el estado real del trimestre
    const checkEstado = async () => {
      const { data } = await supabase
        .from("trimestres")
        .select("estado")
        .eq("lapso", lapso)
        .single();
      setModoConsulta(data?.estado === "cerrado" || data?.estado === "archivado");
    };
    checkEstado();
  }, [lapso]);

  // ── Cambiar de trimestre (desde historial o selector) ─────────────────────
  const handleCambiarLapso = useCallback((nuevoLapso) => {
    setLapso(nuevoLapso);
    // Si viene del historial y es diferente al activo, ir a resumen
    setView("resumen");
  }, []);

  const appData = useAppData(lapso);
  const horariosFilters = useHorariosFilters(appData.data);

  // ── Error de configuración ─────────────────────────────────────────────────
  if (supabaseConfigError) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", color: "#E2E8F0", gap: 16, padding: 32, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      <span style={{ fontSize: 48 }}>⚠️</span>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#F1F5F9" }}>Configuración incompleta</h2>
      <p style={{ margin: 0, fontSize: 14, color: "#94A3B8", maxWidth: 460, lineHeight: 1.6 }}>{supabaseConfigError}</p>
    </div>
  );

  if (appData.user === undefined) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", color: "#94A3B8", fontFamily: "system-ui, sans-serif", fontSize: 15 }}>
      Verificando sesión…
    </div>
  );
  if (!appData.user) return <LoginScreen />;

  if (appData.loading && !appData.data.length) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", gap: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: 36, height: 36, border: "3px solid #1E3A5F", borderTop: "3px solid #3B82F6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ color: "#94A3B8", fontSize: 14, fontWeight: 500 }}>Cargando horarios…</span>
    </div>
  );

  const handleNavigate = (r) => {
    if (r.docente) { setDocenteNav(r.rawDocente || r.docente); setView("docentes"); }
    else if (r.materia) { setMateriaNav(r.rawMateria); setView("materias"); }
    else setView("horarios");
  };

  const nav = NAV_CON_HISTORIAL.map(item => ({
    ...item,
    badge: item.hasBadge ? appData.conflicts.length : 0,
  }));

  const NavBtn = ({ item, active, onClick }) => (
    <button onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px",
        border: "none", borderRadius: 7,
        background: active ? "#1E3A8A" : "transparent",
        color: active ? "#93C5FD" : "#64748B",
        cursor: "pointer", fontSize: 13, textAlign: "left", marginBottom: 1,
        fontWeight: active ? 600 : 400,
        borderLeft: active ? "2px solid #3B82F6" : "2px solid transparent",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      <span style={{ fontSize: 14, opacity: active ? 1 : 0.7 }}>{item.emoji}</span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.badge > 0 && (
        <span style={{ background: "#EF4444", color: "#fff", borderRadius: 10, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>
          {item.badge}
        </span>
      )}
    </button>
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", background: "#F3F4F6", overflow: "hidden" }}>
      <ResponsiveStyles />
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
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}
        style={{ display: "none", position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 299 }} />

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <aside className={`sidebar-aside${sidebarOpen ? " open" : ""}`}
        style={{ width: 228, background: "#0F172A", display: "flex", flexDirection: "column", flexShrink: 0, borderRight: "1px solid #1E293B" }}>

        {/* Marca */}
        <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid #1E293B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#2563EB,#7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>🎓</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9", lineHeight: 1 }}>Horarios PNF</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Sistema de gestión</div>
            </div>
          </div>

          {/* Selector de programa */}
          <select value={appData.selectedPrograma} onChange={e => appData.setSelectedPrograma(e.target.value)}
            style={{ ...S.select, width: "100%", background: "#1E293B", color: "#CBD5E1", borderColor: "#334155", fontSize: 12, padding: "6px 10px" }}>
            {appData.programasDisponibles.map(p => (
              <option key={p} value={p}>{p === "todos" ? "Todos los programas" : p}</option>
            ))}
          </select>
        </div>

        {/* Trimestre activo con indicador */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #1E293B" }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: "#334155", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>
            {modoConsulta ? "📂 Consultando historial" : "📅 Trimestre activo"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              flex: 1, fontSize: 13, fontWeight: 700,
              color: modoConsulta ? "#FBBF24" : "#60A5FA",
            }}>
              {formatLapso(lapso)}
            </span>
            {modoConsulta && (
              <button
                onClick={() => { setLapso(getCurrentLapso()); setModoConsulta(false); setView("resumen"); }}
                title="Volver al trimestre activo"
                style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "1px solid #334155", background: "#1E293B", color: "#60A5FA", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
              >↩ Volver</button>
            )}
          </div>
        </div>

        {/* Estadísticas compactas */}
        <div style={{ padding: "10px 14px 12px", borderBottom: "1px solid #1E293B" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 0" }}>
            {[
              { label: "Clases",    val: appData.stats.total,    color: "#60A5FA" },
              { label: "Secciones", val: appData.stats.secciones, color: "#34D399" },
              { label: "Docentes",  val: appData.stats.docentes,  color: "#A78BFA" },
              { label: "Materias",  val: appData.stats.materias,  color: "#FBBF24" },
            ].map((s, i) => (
              <div key={s.label} style={{ padding: "6px 8px", borderRadius: 7, background: "#1E293B", margin: i % 2 === 0 ? "0 4px 0 0" : "0 0 0 4px" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Navegación */}
        <nav style={{ flex: 1, padding: "10px 10px 6px", overflowY: "auto" }}>

          <div style={{ fontSize: 10, fontWeight: 600, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 6px", marginBottom: 4 }}>Vistas</div>
          {nav.filter(i => ["resumen", "horarios", "secciones"].includes(i.id)).map(item => (
            <NavBtn key={item.id} item={item} active={view === item.id}
              onClick={() => { setView(item.id); setSidebarOpen(false); }} />
          ))}

          <div style={{ height: 1, background: "#1E293B", margin: "8px 6px" }} />

          <div style={{ fontSize: 10, fontWeight: 600, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 6px", marginBottom: 4 }}>Gestión</div>
          {nav.filter(i => ["docentes", "materias", "asistencias"].includes(i.id)).map(item => (
            <NavBtn key={item.id} item={item} active={view === item.id}
              onClick={() => { setView(item.id); setSidebarOpen(false); }} />
          ))}

          <div style={{ height: 1, background: "#1E293B", margin: "8px 6px" }} />

          <div style={{ fontSize: 10, fontWeight: 600, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 6px", marginBottom: 4 }}>Sistema</div>
          {nav.filter(i => ["conflictos", "historial"].includes(i.id)).map(item => (
            <NavBtn key={item.id} item={item} active={view === item.id}
              onClick={() => { setView(item.id); setSidebarOpen(false); }} />
          ))}

          {/* Selector de lapso en asistencias */}
          {view === "asistencias" && (
            <>
              <div style={{ height: 1, background: "#1E293B", margin: "8px 6px" }} />
              <div style={{ padding: "0 6px" }}>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 4, fontWeight: 600 }}>Trimestre académico</div>
                <select value={lapso} onChange={e => setLapso(e.target.value)}
                  style={{ ...S.select, width: "100%", background: "#1E293B", color: "#93C5FD", borderColor: "#334155", fontSize: 12, padding: "6px 10px", fontWeight: 600 }}>
                  {lapsosDisponibles.map(l => (
                    <option key={l} value={l}>{formatLapso(l)}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </nav>

        {/* Acciones de datos (ocultas en modo consulta de historial) */}
        {!modoConsulta && (
          <div style={{ padding: "10px 12px", borderTop: "1px solid #1E293B" }}>
            <label htmlFor="upload-excel"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer", background: "#2563EB", color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              <span>📂</span> Cargar Excel
            </label>
            <input id="upload-excel" type="file" accept=".xlsx, .xls" style={{ display: "none" }}
              onChange={(e) => { if (e.target.files[0]) appData.handleFileUpload(e.target.files[0]); e.target.value = ""; }}
              disabled={appData.uploading} />

            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
              <button onClick={appData.exportarDatos} disabled={appData.uploading || !appData.data.length}
                title="Exportar backup"
                style={{ flex: 1, cursor: appData.data.length ? "pointer" : "not-allowed", background: "#1E293B", color: appData.data.length ? "#94A3B8" : "#334155", border: "1px solid #334155", padding: "6px 0", borderRadius: 7, fontSize: 11, fontWeight: 600 }}>
                💾 Backup
              </button>
              <label htmlFor="import-backup" title="Restaurar backup"
                style={{ flex: 1, cursor: "pointer", background: "#1E293B", color: "#94A3B8", border: "1px solid #334155", padding: "6px 0", borderRadius: 7, fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                📥 Restaurar
              </label>
              <input id="import-backup" type="file" accept=".json" style={{ display: "none" }}
                onChange={(e) => { if (e.target.files[0]) appData.importarDatos(e.target.files[0]); e.target.value = ""; }}
                disabled={appData.uploading} />
              <button onClick={appData.clearAllData} disabled={appData.loading || !appData.data.length}
                title="Borrar todos los datos"
                style={{ flex: 1, cursor: appData.data.length ? "pointer" : "not-allowed", background: "#1E293B", color: appData.data.length ? "#F87171" : "#334155", border: "1px solid #334155", padding: "6px 0", borderRadius: 7, fontSize: 11, fontWeight: 600 }}>
                🗑️ Borrar
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: appData.isOffline ? "#EF4444" : "#22C55E", flexShrink: 0 }}></span>
                <span style={{ color: appData.isOffline ? "#FCA5A5" : "#4ADE80", fontWeight: 600 }}>
                  {appData.isOffline ? "Offline" : "En línea"}
                </span>
              </div>
              {appData.data.length > 0 && !appData.uploading && (
                <span style={{ fontSize: 10, color: "#334155" }}>{appData.data.length} registros</span>
              )}
              {appData.uploading && <span style={{ fontSize: 10, color: "#60A5FA" }}>Procesando…</span>}
            </div>
            {appData.error && <div style={{ fontSize: 10, marginTop: 4, color: "#F87171" }}>{appData.error}</div>}
          </div>
        )}

        {/* Modo consulta: banner de solo lectura */}
        {modoConsulta && (
          <div style={{ padding: "10px 12px", borderTop: "1px solid #1E293B", background: "#1C1A10" }}>
            <div style={{ fontSize: 10, color: "#FBBF24", fontWeight: 600, textAlign: "center", lineHeight: 1.5 }}>
              📂 Modo consulta — solo lectura<br />
              <span style={{ color: "#475569", fontWeight: 400 }}>{formatLapso(lapso)}</span>
            </div>
          </div>
        )}

        {/* Usuario */}
        <div style={{ padding: "10px 12px", borderTop: "1px solid #1E293B", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#2563EB,#7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
            {appData.user.email?.[0]?.toUpperCase() ?? "A"}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 11, color: "#94A3B8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{appData.user.email}</div>
            <div style={{ fontSize: 9, color: "#334155", marginTop: 1 }}>Sinc: {appData.lastSync}</div>
          </div>
          <button onClick={appData.handleLogout} title="Cerrar sesión"
            style={{ background: "none", border: "1px solid #1E293B", borderRadius: 6, cursor: "pointer", color: "#475569", fontSize: 13, padding: "3px 7px", flexShrink: 0 }}>
            ⏏
          </button>
        </div>
      </aside>

      {/* ── CONTENIDO PRINCIPAL ──────────────────────────────────────────────── */}
      <div className="main-content" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <header className="header-bar"
          style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen(o => !o)} className="hamburger-btn"
            style={{ display: "none", background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 18, color: "#374151", flexShrink: 0 }}>
            ☰
          </button>

          <GlobalSearch onNavigate={handleNavigate} docenteNames={appData.docenteNames} materiaNames={appData.materiaNames} data={appData.data} />

          {appData.isSyncing && (
            <span style={{ fontSize: 11, color: "#94A3B8", whiteSpace: "nowrap", flexShrink: 0 }}>🔄 Actualizando…</span>
          )}

          {/* Indicador de trimestre en header */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {modoConsulta && (
              <span style={{ fontSize: 11, background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A", borderRadius: 6, padding: "3px 10px", fontWeight: 600 }}>
                📂 Historial: {formatLapso(lapso)}
              </span>
            )}
            {!modoConsulta && (
              <span style={{ fontSize: 11, background: "#EFF6FF", color: "#1E40AF", border: "1px solid #BFDBFE", borderRadius: 6, padding: "3px 10px", fontWeight: 600 }}>
                📅 {formatLapso(lapso)}
              </span>
            )}
          </div>
        </header>

        {/* Vistas */}
        <main style={{ flex: 1, overflow: "auto" }}>
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
                (horariosFilters.selectedSeccion === "all" || d.sheet.trim() === horariosFilters.selectedSeccion) &&
                (horariosFilters.activeDay === "all" || d.dia === horariosFilters.activeDay)
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
