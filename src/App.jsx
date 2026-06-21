import React, { useState, useEffect, useCallback, useRef } from "react";
import useAppData from "./hooks/useAppData";
import useHorariosFilters from "./hooks/useHorariosFilters";
import useAuth from "./hooks/useAuth";
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
import HistorialView from "./components/HistorialView";
import UsuariosView from "./components/UsuariosView";
import LogsView from "./components/LogsView";
// ── Módulo de Asistencias QR ──────────────────────────────────────────────────
import ModuleSelector from "./components/ModuleSelector";
import AdminQRPanel from "./components/asistencias/AdminQRPanel";
import QRProyeccion from "./components/asistencias/QRProyeccion";
import ReporteAsistencias from "./components/asistencias/ReporteAsistencias";
import DocenteScan from "./components/asistencias/DocenteScan";
import useQRSession from "./hooks/useQRSession";
import { S, ROL_SIDEBAR } from "./constants";
import { getCurrentLapso, getLapsosDisponibles, formatLapso } from "./utils/lapso";
import { supabase, supabaseConfigError } from "./lib/supabase";

// ── Piezas extraídas a archivos propios (ver src/app/) ────────────────────────
import buildNavGroups from "./app/buildNavGroups";
import GLOBAL_CSS from "./app/AppStyles";
import AdminMenu from "./app/AdminMenu";
import CuentaDesactivada from "./app/CuentaDesactivada";
import SinPerfilAsignado from "./app/SinPerfilAsignado";

// ── Componente principal ──────────────────────────────────────────────────────
export default function App() {
  const [view,        setView]        = useState("resumen");
  const [docenteNav,  setDocenteNav]  = useState(null);
  const [materiaNav,  setMateriaNav]  = useState(null);
  const [horariosTab, setHorariosTab] = useState(null);
  const [lapso,       setLapso]       = useState(() => getCurrentLapso());
  const [modoConsulta,setModoConsulta]= useState(false);

  // ── Módulo activo: null = selector, "horarios" | "asistencias" ───────────
  // Para roles no-admin, se salta el selector y se va directo a "horarios".
  const [moduloActivo,      setModuloActivo]      = useState(null);
  // Sub-vista dentro del módulo de asistencias
  const [asistenciasSubView, setAsistenciasSubView] = useState("panel"); // "panel" | "reporte"

  // ── Hook de sesión QR — vive AQUÍ para no perderse al cambiar sub-vista ──
  const qrSession = useQRSession();

  const [hovered,    setHovered]    = useState(false);
  const [pinned,     setPinned]     = useState(() => localStorage.getItem("sb_pinned") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminOpen,  setAdminOpen]  = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const fileRef   = useRef(null);
  const backupRef = useRef(null);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, profile, permisos, loadingProfile, handleLogin, handleLogout, logAudit } = useAuth();

  const expanded = pinned || hovered || mobileOpen;

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem("sb_pinned", next ? "1" : "0");
  };

  // Detectar modo consulta histórica
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.from("trimestres").select("estado").eq("lapso", lapso).single();
      setModoConsulta(data?.estado === "cerrado" || data?.estado === "archivado");
    };
    check();
  }, [lapso]);

  // Restringir programa automáticamente para secretarios
  const appData = useAppData(lapso);

  useEffect(() => {
    if (permisos.puedeVerSoloSuPrograma && permisos.programaRestringido) {
      appData.setSelectedPrograma(permisos.programaRestringido);
    }
  }, [permisos.puedeVerSoloSuPrograma, permisos.programaRestringido]);

  // ── Auto-selección de módulo (roles no-admin y operador_qr) ───────────────
  // DEBE estar aquí, junto a los otros hooks, ANTES de cualquier return
  // condicional — viola la Regla de Hooks si se pone después de un return.
  useEffect(() => {
    if (!profile || moduloActivo) return;
    if (profile.rol === "operador_qr") setModuloActivo("asistencias");
    else if (profile.rol !== "admin") setModuloActivo("horarios");
  }, [profile, moduloActivo]);

  const horariosFilters = useHorariosFilters(appData.data);

  const handleCambiarLapso = useCallback((nuevo) => {
    setLapso(nuevo);
    setView("resumen");
  }, []);

  const handleNavigate = (r) => {
    if (r.docente) { setDocenteNav(r.rawDocente || r.docente); setView("docentes"); }
    else if (r.materia) { setMateriaNav(r.rawMateria); setView("materias"); }
    else setView("horarios");
  };

  const handleGoToConflictos = () => {
    setHorariosTab("conflictos");
    setView("horarios");
  };

  // Envolver operaciones de escritura con auditoría
  const handleFileUploadAuditado = async (file) => {
    await appData.handleFileUpload(file);
    await logAudit({
      accion:            "IMPORTAR_EXCEL",
      entidad:           "horarios",
      lapso,
      programa_afectado: appData.selectedPrograma !== "todos" ? appData.selectedPrograma : null,
      resumen:           `Importación Excel: ${file.name}`,
    });
  };

  const handleExportarAuditado = async () => {
    await appData.exportarDatos();
    await logAudit({
      accion:  "EXPORTAR_BACKUP",
      entidad: "horarios",
      lapso,
      resumen: `Exportación de backup. Lapso: ${lapso}`,
    });
  };

  const appDataAuditada = {
    ...appData,
    exportarDatos: handleExportarAuditado,
  };

  // ── Guards ────────────────────────────────────────────────────────────────
  // ── Ruta pública /scan ────────────────────────────────────────────────────
  // Debe ir ANTES de todos los guards de auth: el docente no tiene sesión.
  // vercel.json redirige todo a "/" pero la URL conserva el pathname.
  if (window.location.pathname === "/scan") {
    return <DocenteScan />;
  }

  if (supabaseConfigError) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      height:"100vh", background:"#0F172A", color:"#E2E8F0", gap:16, padding:32,
      textAlign:"center", fontFamily:"system-ui,sans-serif" }}>
      <i className="ti ti-alert-triangle" style={{ fontSize:44, color:"#FBBF24" }} aria-hidden="true" />
      <h2 style={{ margin:0, fontSize:20, fontWeight:600, color:"#F1F5F9" }}>Configuración incompleta</h2>
      <p style={{ margin:0, fontSize:14, color:"#94A3B8", maxWidth:460, lineHeight:1.6 }}>
        {supabaseConfigError}
      </p>
    </div>
  );

  // Cargando sesión
  if (user === undefined) return (
    <div className="full-screen-loading" style={{ color:"#94A3B8", fontSize:15 }}>
      Verificando sesión…
    </div>
  );

  // Sin sesión → login
  if (!user) return <LoginScreen />;

  // Sesión activa pero cargando perfil
  if (loadingProfile) return (
    <div className="full-screen-loading">
      <div style={{ width:32, height:32, border:"3px solid #1E3A5F", borderTop:"3px solid #3B82F6",
        borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      <span style={{ color:"#94A3B8", fontSize:14 }}>Cargando perfil…</span>
    </div>
  );

  // Sin perfil asignado
  if (!profile) return <SinPerfilAsignado onLogout={handleLogout} />;

  // Cuenta desactivada
  if (profile._desactivado) return <CuentaDesactivada onLogout={handleLogout} />;


  // ── Selector de módulo ────────────────────────────────────────────────────
  // - admin: ve el selector de módulos
  // - operador_qr: va directo a asistencias (via useEffect arriba)
  // - resto de roles: van directo a horarios (via useEffect arriba)
  if (!moduloActivo) {
    // Mientras el useEffect procesa la redirección automática, mostramos
    // spinner en lugar de null para evitar flash de pantalla negra en móvil.
    if (profile.rol !== "admin") {
      return (
        <div className="full-screen-loading">
          <div style={{ width:32, height:32, border:"3px solid #1E3A5F", borderTop:"3px solid #3B82F6",
            borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
          <span style={{ color:"#94A3B8", fontSize:14 }}>Cargando…</span>
        </div>
      );
    }
    return (
      <ModuleSelector
        profile={profile}
        onSelectModule={(mod) => {
          setModuloActivo(mod);
          setAsistenciasSubView("panel");
        }}
        onLogout={handleLogout}
      />
    );
  }

  // ── Módulo de Asistencias QR (admin + operador_qr) ────────────────────────
  if (moduloActivo === "asistencias") {
    const esAdmin = profile.rol === "admin";
    const rolLabel = esAdmin ? "Administrador" : "Operador QR";
    const rolColor = esAdmin ? "#A78BFA" : "#34D399";

    return (
      <div style={{ minHeight: "100vh", background: "#F3F4F6", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {/* Topbar */}
        <header style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 12, padding: "0 20px", height: 52, flexShrink: 0 }}>

          {/* Volver al selector — solo admin, operador_qr no tiene a dónde volver */}
          {esAdmin && (
            <button
              onClick={() => { qrSession.cerrarSesion(); setModuloActivo(null); }}
              style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}
            >
              <i className="ti ti-arrow-left" aria-hidden="true" /> Módulos
            </button>
          )}

          {/* Pestañas internas */}
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { id: "panel",      icon: "ti-device-mobile", label: "Panel QR"   },
              { id: "proyeccion", icon: "ti-device-tv",     label: "Proyección" },
              { id: "reporte",    icon: "ti-report",        label: "Reporte"    },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAsistenciasSubView(tab.id)}
                style={{
                  padding: "5px 14px", borderRadius: 7, border: "none",
                  background: asistenciasSubView === tab.id ? "#EFF6FF" : "transparent",
                  color:      asistenciasSubView === tab.id ? "#1D4ED8" : "#6B7280",
                  fontWeight: asistenciasSubView === tab.id ? 700 : 500,
                  fontSize: 13, cursor: "pointer", transition: "all 0.12s",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <i className={`ti ${tab.icon}`} aria-hidden="true" /> {tab.label}
              </button>
            ))}
          </div>

          {/* Indicador de sesión QR activa en el topbar */}
          {qrSession.activa && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 20 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", display: "inline-block", animation: "pulse 1.4s ease-in-out infinite" }} />
              <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#15803D" }}>Sesión activa</span>
            </div>
          )}

          {/* Badge usuario + logout */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: rolColor, background: "#1E293B", borderRadius: 6, padding: "3px 10px" }}>
              {rolLabel}
            </span>
            {profile.nombre && profile.nombre !== rolLabel && (
              <span style={{ fontSize: 12, color: "#9CA3AF" }}>{profile.nombre}</span>
            )}
            <button onClick={handleLogout} title="Cerrar sesión" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, cursor: "pointer", color: "#6B7280", fontSize: 12, padding: "3px 9px", display: "flex", alignItems: "center" }}>
              <i className="ti ti-logout" style={{ fontSize: 14 }} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Sub-vistas */}
        <main>
          {asistenciasSubView === "panel" && (
            <AdminQRPanel
              profile={profile}
              onVerReporte={() => setAsistenciasSubView("reporte")}
              onVerProyeccion={() => setAsistenciasSubView("proyeccion")}
              {...qrSession}
            />
          )}
          {asistenciasSubView === "proyeccion" && (
            <QRProyeccion
              activa={qrSession.activa}
              qrUrl={qrSession.qrUrl}
              segundosRestantes={qrSession.segundosRestantes}
              ttlMinutes={qrSession.ttlMinutes}
              meta={qrSession.meta}
            />
          )}
          {asistenciasSubView === "reporte" && (
            <ReporteAsistencias
              onVolverPanel={() => setAsistenciasSubView("panel")}
            />
          )}
        </main>

      </div>
    );
  }

  // Datos cargando
  if (appData.loading && !appData.data.length) return (
    <div className="full-screen-loading">
      <div style={{ width:36, height:36, border:"3px solid #1E3A5F", borderTop:"3px solid #3B82F6",
        borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      <span style={{ color:"#94A3B8", fontSize:14 }}>Cargando horarios…</span>
    </div>
  );

  const navGroups = buildNavGroups(permisos);
  const conflictCount = appData.conflicts.length;
  const rolInfo = ROL_SIDEBAR[profile.rol] || { label: profile.rol, color: "#94A3B8" };

  // Selector de programa: deshabilitado para secretarios
  const puedeSeleccionarPrograma = !permisos.puedeVerSoloSuPrograma;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", height:"100dvh", fontFamily:"system-ui,-apple-system,sans-serif",
      background:"#F3F4F6", overflow:"hidden" }}>
      <style>{GLOBAL_CSS}</style>

      {appData.toast && (
        <Toast message={appData.toast.message} type={appData.toast.type} onClose={appData.hideToast} />
      )}
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
      {/* Overlay: solo visible cuando el sidebar móvil/tablet está abierto */}
      {mobileOpen && (
        <div onClick={() => setMobileOpen(false)}
          style={{ position:"fixed", inset:0,
            background:"rgba(0,0,0,0.45)", zIndex:299 }} />
      )}

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      {/* sb-flow-spacer: ocupa el espacio del sidebar en desktop;
          en tablet/móvil se oculta (CSS) porque el sidebar es fixed overlay */}
      <div className={`sb-flow-spacer ${expanded ? "sb-expanded" : "sb-collapsed"}`}
        style={{ flexShrink:0, transition:"width .22s" }} />
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
            <i className="ti ti-school" style={{ color:"#fff", fontSize:17 }} aria-hidden="true" />
          </div>
          <div className="sb-label" style={{ flex:1, overflow:"hidden" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#F1F5F9", whiteSpace:"nowrap" }}>
              SIGMA
            </div>
            <div style={{ fontSize:10, color:"#475569", marginTop:1, whiteSpace:"nowrap" }}>
              Gest. y Módulos Académicos
            </div>
          </div>
          {expanded && (
            <button className={`pin-btn ${pinned ? "pinned" : ""}`} onClick={togglePin}
              title={pinned ? "Desfijar sidebar" : "Fijar sidebar"}>
              <i className={`ti ${pinned ? "ti-pinned" : "ti-pin"}`} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Trimestre activo */}
        <div style={{ padding:"10px 10px 10px", borderBottom:"1px solid #1E293B", flexShrink:0 }}>
          {!expanded ? (
            <div style={{ width:32, height:32, borderRadius:7, flexShrink:0,
              background: modoConsulta ? "#451A03" : "#0C1A3A",
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:14,
              cursor: modoConsulta ? "pointer" : "default" }}
              onClick={() => modoConsulta && handleCambiarLapso(getCurrentLapso())}
              title={modoConsulta ? `Historial: ${lapso}` : `Trimestre activo: ${lapso}`}>
              <i className={`ti ${modoConsulta ? "ti-archive" : "ti-calendar-event"}`} aria-hidden="true" />
            </div>
          ) : (
            <div>
              <div style={{ fontSize:9, fontWeight:700, color:"#334155", textTransform:"uppercase",
                letterSpacing:"0.08em", marginBottom:3 }}>
                {modoConsulta ? "Consultando historial" : "Trimestre activo"}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:13, fontWeight:700,
                  color: modoConsulta ? "#FBBF24" : "#60A5FA", flex:1, whiteSpace:"nowrap" }}>
                  {formatLapso(lapso)}
                </span>
                {modoConsulta && (
                  <button onClick={() => handleCambiarLapso(getCurrentLapso())}
                    style={{ fontSize:10, padding:"2px 7px", borderRadius:5,
                      border:"1px solid #334155", background:"#1E293B",
                      color:"#60A5FA", cursor:"pointer", fontWeight:600, flexShrink:0,
                      display:"flex", alignItems:"center" }}>
                    <i className="ti ti-arrow-back-up" style={{ fontSize:12 }} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Selector de programa */}
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #1E293B", flexShrink:0 }}>
          {expanded ? (
            <select
              value={appData.selectedPrograma}
              onChange={e => puedeSeleccionarPrograma && appData.setSelectedPrograma(e.target.value)}
              disabled={!puedeSeleccionarPrograma}
              style={{ ...S.select, width:"100%", background:"#1E293B", color:"#CBD5E1",
                borderColor:"#334155", fontSize:12, padding:"6px 8px",
                opacity: puedeSeleccionarPrograma ? 1 : 0.6,
                cursor: puedeSeleccionarPrograma ? "pointer" : "not-allowed" }}>
              {puedeSeleccionarPrograma
                ? appData.programasDisponibles.map(p => (
                    <option key={p} value={p}>
                      {p === "todos" ? "Todos los programas" : p}
                    </option>
                  ))
                : <option value={permisos.programaRestringido}>{permisos.programaRestringido}</option>
              }
            </select>
          ) : (
            <div style={{ width:32, height:32, borderRadius:7, background:"#1E293B",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:13, color:"#475569" }}
              title={`Programa: ${appData.selectedPrograma === "todos" ? "Todos" : appData.selectedPrograma}`}>
              <i className="ti ti-school" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Navegación */}
        <nav style={{ flex:1, padding:"8px 8px 6px", overflowY:"auto", overflowX:"hidden" }}>
          {navGroups.map((group, gi) => (
            <div key={group.label} style={{ marginBottom: gi < navGroups.length - 1 ? 4 : 0 }}>
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
                    <i className={`ti ${item.icon}`} style={{ fontSize:16, flexShrink:0, width:20, textAlign:"center" }} aria-hidden="true" />
                    <span className="sb-label" style={{ flex:1 }}>{item.label}</span>
                    {badge > 0 && <span className="badge-red">{badge}</span>}
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
            appData={appDataAuditada}
            modoConsulta={modoConsulta}
            onClose={() => setAdminOpen(false)}
            fileRef={fileRef}
            backupRef={backupRef}
            permisos={permisos}
          />
        )}

        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
          onChange={e => {
            if (e.target.files[0]) handleFileUploadAuditado(e.target.files[0]);
            e.target.value = "";
          }} />
        <input ref={backupRef} type="file" accept=".json" style={{ display: "none" }}
          onChange={e => {
            if (e.target.files[0]) appData.importarDatos(e.target.files[0]);
            e.target.value = "";
          }} />

        {/* Footer: botón de administración del sistema */}
        {(permisos.puedeImportarExcel || permisos.puedeHacerBackup || permisos.puedeBorrarHorarios) && (
          <div style={{ borderTop:"1px solid #1E293B", padding:"8px", flexShrink:0 }}>
            <button
              onClick={() => setAdminOpen(o => !o)}
              className="nav-item"
              style={{ color: adminOpen ? "#93C5FD" : "#64748B",
                background: adminOpen ? "#1E293B" : "transparent" }}
              title="Administración del sistema"
            >
              <i className="ti ti-settings" style={{ fontSize:15, flexShrink:0, width:20, textAlign:"center" }} aria-hidden="true" />
              <span className="sb-label" style={{ flex:1 }}>Administración</span>
              {appData.uploading && (
                <span style={{ width:8, height:8, borderRadius:"50%", border:"1.5px solid #3B82F6",
                  borderTop:"1.5px solid transparent",
                  animation:"spin .7s linear infinite", flexShrink:0 }} />
              )}
              <span className="tooltip">Administración</span>
            </button>
          </div>
        )}
      </aside>

      {/* ── CONTENIDO PRINCIPAL ──────────────────────────────────────────── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minWidth:0 }}>

        {/* Topbar */}
        <header className="topbar">
          <button className="hamburger"
            onClick={() => setMobileOpen(o => !o)}
            style={{ display:"none", background:"none", border:"1px solid #E5E7EB",
              borderRadius:6, padding:"5px 9px", cursor:"pointer", fontSize:17,
              color:"#374151", flexShrink:0, alignItems:"center" }}>
            <i className="ti ti-menu-2" aria-hidden="true" />
          </button>

          <div style={{ flex:1, maxWidth:420 }}>
            <GlobalSearch
              onNavigate={handleNavigate}
              docenteNames={appData.docenteNames}
              materiaNames={appData.materiaNames}
              data={appData.data}
            />
          </div>

          {/* Menú de usuario en topbar */}
          <div style={{ marginLeft:"auto", position:"relative" }}>
            <button
              onClick={() => setUserMenuOpen(o => !o)}
              title="Menú de usuario"
              style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer",
                background: userMenuOpen ? "#F1F5F9" : "transparent",
                border:"1px solid " + (userMenuOpen ? "#CBD5E1" : "#E5E7EB"),
                borderRadius:8, padding:"4px 10px 4px 6px",
                transition:"background .13s, border-color .13s" }}>
              <div style={{ width:26, height:26, borderRadius:"50%", flexShrink:0,
                background:"linear-gradient(135deg,#2563EB,#7C3AED)",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:11, fontWeight:700, color:"#fff" }}>
                {profile.nombre?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div style={{ textAlign:"left", lineHeight:1.3 }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#111827", whiteSpace:"nowrap" }}>
                  {profile.nombre && profile.nombre !== rolInfo.label ? profile.nombre : rolInfo.label}
                </div>
                <div style={{ fontSize:10, color: rolInfo.color, fontWeight:600, whiteSpace:"nowrap" }}>
                  {rolInfo.label}{profile.programa ? ` · ${profile.programa.replace("PNF ","")}` : ""}
                </div>
              </div>
              <i className="ti ti-chevron-down" style={{ fontSize:12, color:"#94A3B8",
                transform: userMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition:"transform .15s" }} aria-hidden="true" />
            </button>

            {userMenuOpen && (
              <>
                <div onClick={() => setUserMenuOpen(false)}
                  style={{ position:"fixed", inset:0, zIndex:398 }} />
                <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, minWidth:200,
                  background:"#fff", border:"1px solid #E5E7EB", borderRadius:10,
                  boxShadow:"0 8px 24px rgba(0,0,0,0.12)", zIndex:399, overflow:"hidden",
                  animation:"fadeDown .15s ease" }}>
                  {/* Info usuario */}
                  <div style={{ padding:"12px 14px 10px", borderBottom:"1px solid #F1F5F9" }}>
                    <div style={{ fontSize:12, fontWeight:700, color:"#111827" }}>
                      {profile.nombre && profile.nombre !== rolInfo.label ? profile.nombre : rolInfo.label}
                    </div>
                    <div style={{ fontSize:11, color:"#6B7280", marginTop:2 }}>{profile.email}</div>
                  </div>
                  {/* Cambiar módulo (solo admin) */}
                  {profile.rol === "admin" && (
                    <button onClick={() => { setModuloActivo(null); setUserMenuOpen(false); }}
                      style={{ display:"flex", alignItems:"center", gap:9, width:"100%",
                        padding:"9px 14px", border:"none", background:"transparent",
                        cursor:"pointer", fontSize:13, color:"#374151", textAlign:"left" }}
                      onMouseEnter={e => e.currentTarget.style.background="#F8FAFC"}
                      onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                      <i className="ti ti-switch-horizontal" style={{ fontSize:15, color:"#6B7280" }} aria-hidden="true" />
                      Cambiar módulo
                    </button>
                  )}
                  {/* Cambiar contraseña */}
                  <button onClick={() => { /* TODO: modal cambiar pwd */ setUserMenuOpen(false); }}
                    style={{ display:"flex", alignItems:"center", gap:9, width:"100%",
                      padding:"9px 14px", border:"none", background:"transparent",
                      cursor:"pointer", fontSize:13, color:"#374151", textAlign:"left" }}
                    onMouseEnter={e => e.currentTarget.style.background="#F8FAFC"}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    <i className="ti ti-key" style={{ fontSize:15, color:"#6B7280" }} aria-hidden="true" />
                    Cambiar contraseña
                  </button>
                  <div style={{ height:1, background:"#F1F5F9" }} />
                  {/* Cerrar sesión */}
                  <button onClick={() => { handleLogout(); setUserMenuOpen(false); }}
                    style={{ display:"flex", alignItems:"center", gap:9, width:"100%",
                      padding:"9px 14px", border:"none", background:"transparent",
                      cursor:"pointer", fontSize:13, color:"#EF4444", textAlign:"left" }}
                    onMouseEnter={e => e.currentTarget.style.background="#FFF5F5"}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    <i className="ti ti-logout" style={{ fontSize:15 }} aria-hidden="true" />
                    Cerrar sesión
                  </button>
                </div>
              </>
            )}
          </div>

          {appData.isSyncing && (
            <span style={{ fontSize:11, color:"#94A3B8", whiteSpace:"nowrap", flexShrink:0, display:"flex", alignItems:"center", gap:5 }}>
              <i className="ti ti-refresh" style={{ animation:"spin 1.1s linear infinite" }} aria-hidden="true" /> Actualizando…
            </span>
          )}
        </header>

        {/* Banner modo consulta */}
        {modoConsulta && (
          <div style={{ background:"#FFFBEB", borderBottom:"1px solid #FDE68A",
            padding:"7px 20px", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <span style={{ fontSize:13, color:"#92400E", fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              <i className="ti ti-archive" aria-hidden="true" /> Modo consulta — estás viendo el trimestre {formatLapso(lapso)} (solo lectura)
            </span>
            <button onClick={() => handleCambiarLapso(getCurrentLapso())}
              style={{ marginLeft:"auto", fontSize:12, padding:"4px 12px", borderRadius:6,
                border:"1px solid #FDE68A", background:"#fff", color:"#92400E",
                cursor:"pointer", fontWeight:600, flexShrink:0, display:"flex", alignItems:"center", gap:5 }}>
              <i className="ti ti-arrow-back-up" aria-hidden="true" /> Volver al trimestre activo
            </button>
          </div>
        )}

        {/* Vistas */}
        <main style={{ flex:1, overflow:"auto", display:"flex", flexDirection:"column" }}>
          {view === "resumen" && (
            <ResumenView
              stats={appData.stats} data={appData.data}
              byDocente={appData.byDocente} byMateria={appData.byMateria}
              conflicts={appData.conflicts}
              getDocName={appData.getDocName} getMateriaName={appData.getMateriaName}
              onGoToConflictos={handleGoToConflictos}
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
              initialTab={horariosTab}
              onConsumeInitialTab={() => setHorariosTab(null)}
              modoConsulta={modoConsulta || !permisos.puedeEditarHorarios}
            />
          )}
          {view === "secciones" && (
            <SeccionesView
              data={appData.data}
              getDocName={appData.getDocName}
              getMateriaName={appData.getMateriaName}
            />
          )}
          {view === "docentes" && (
            <DocentesView
              byDocente={appData.byDocente} conflicts={appData.conflicts}
              initialSel={docenteNav} onConsumeNav={() => setDocenteNav(null)}
              getDocName={appData.getDocName}
              onSaveDocenteName={permisos.puedeEditarDocentes ? appData.saveDocenteName : null}
              getDocCedula={appData.getDocCedula}
              getDocCedulaFuente={appData.getDocCedulaFuente}
              onSaveDocenteCedula={permisos.puedeEditarDocentes ? appData.saveDocenteCedula : null}
            />
          )}
          {view === "materias" && (
            <MateriasView
              byMateria={appData.byMateria} initialSel={materiaNav}
              onConsumeNav={() => setMateriaNav(null)}
              getMateriaName={appData.getMateriaName}
              onSaveMateriaName={permisos.puedeEditarMaterias ? appData.saveMateriaName : null}
              data={appData.data} getDocName={appData.getDocName}
            />
          )}
          {view === "asistencias" && (
            <AsistenciasView
              data={appData.data} getDocName={appData.getDocName}
              getMateriaName={appData.getMateriaName} lapso={lapso}
            />
          )}
          {view === "historial" && (
            <HistorialView
              lapsoActivo={lapso}
              onCambiarLapso={handleCambiarLapso}
              showToast={appData.showToast}
              openConfirm={appData.openConfirm}
              closeConfirm={appData.closeConfirm}
              user={user}
              modoConsulta={!permisos.puedeGestionarTrimestres}
            />
          )}
          {view === "logs" && permisos.puedeVerLogs && (
            <LogsView permisos={permisos} />
          )}
          {view === "usuarios" && permisos.puedeGestionarUsuarios && (
            <UsuariosView
              permisos={permisos}
              logAudit={logAudit}
              showToast={appData.showToast}
            />
          )}
        </main>
      </div>
    </div>
  );
}
