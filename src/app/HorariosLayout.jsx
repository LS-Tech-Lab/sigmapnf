import React, { lazy, Suspense } from "react";
import { S, ROL_SIDEBAR } from "../constants";
import { getCurrentLapso, getLapsosDisponibles, formatLapso } from "../utils/lapso";
import buildNavGroups from "./buildNavGroups";
import AdminMenu from "./AdminMenu";
import UserMenu from "./UserMenu";
import ProgramaLogo from "../components/ProgramaLogo";
import GlobalSearch from "../components/GlobalSearch";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import ModalCambiarPassword from "../components/ModalCambiarPassword";
import ResumenView from "../components/ResumenView";
import UploadPreviewModal from "../components/UploadPreviewModal";
import HorariosView from "../components/HorariosView";
import SeccionesView from "../components/SeccionesView";
import DocentesView from "../components/DocentesView";
import MateriasView from "../components/MateriasView";
import AsistenciasView from "../components/AsistenciasView";

const HistorialView = lazy(() => import("../components/HistorialView"));
const UsuariosView  = lazy(() => import("../components/usuarios"));
const LogsView      = lazy(() => import("../components/LogsView"));

const LazyFallback = ({ label }) => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "center",
    height: 240, color: "var(--color-text-tertiary)", fontSize: 13, gap: 8,
  }}>
    <i className="ti ti-loader-2" style={{ fontSize: 20, animation: "spin 1s linear infinite" }} aria-hidden="true" />
    {label}
  </div>
);

/**
 * Shell completo del módulo de Horarios.
 * Se monta cuando moduloActivo === "horarios" (o por defecto).
 *
 * Props — estado de navegación:
 *   view, setView
 *   docenteNav, setDocenteNav
 *   materiaNav, setMateriaNav
 *   horariosTab, setHorariosTab
 *   lapso
 *   modoConsulta
 *   handleCambiarLapso
 *
 * Props — sidebar UI:
 *   hovered, setHovered
 *   pinned, togglePin
 *   mobileOpen, setMobileOpen
 *   adminOpen, setAdminOpen
 *   userMenuOpen, setUserMenuOpen
 *   cambiarPwdOpen, setCambiarPwdOpen
 *   fileRef, backupRef
 *
 * Props — datos y auth:
 *   appData           — resultado de useAppData (con exportarDatos ya auditado)
 *   horariosFilters   — resultado de useHorariosFilters
 *   permisos
 *   profile
 *   user
 *   handleLogout
 *   handleFileUploadAuditado
 *
 * Props — módulos:
 *   tieneHorarios, tieneQR
 *   onCambiarModulo   — setModuloActivo(null)
 */
export default function HorariosLayout({
  // Navegación
  view, setView,
  docenteNav, setDocenteNav,
  materiaNav, setMateriaNav,
  horariosTab, setHorariosTab,
  lapso,
  modoConsulta,
  handleCambiarLapso,
  // Sidebar UI
  hovered, setHovered,
  pinned, togglePin,
  mobileOpen, setMobileOpen,
  adminOpen, setAdminOpen,
  userMenuOpen, setUserMenuOpen,
  cambiarPwdOpen, setCambiarPwdOpen,
  fileRef, backupRef,
  // Datos y auth
  appData,
  horariosFilters,
  permisos,
  profile,
  user,
  handleLogout,
  handleFileUploadAuditado,
  // Módulos
  tieneHorarios,
  tieneQR,
  onCambiarModulo,
}) {
  const expanded = pinned || hovered || mobileOpen;

  const navGroups    = buildNavGroups(permisos);
  const conflictCount = appData.conflicts.length;

  const rolInfo = profile.rol_info
    ? { label: profile.rol_info.label, color: profile.rol_info.color }
    : ROL_SIDEBAR[profile.rol] || { label: profile.rol, color: "var(--color-text-tertiary)" };

  const puedeSeleccionarPrograma = !permisos.puedeVerSoloSuPrograma;

  const handleNavigate = (r) => {
    if (r.docente) { setDocenteNav(r.rawDocente || r.docente); setView("docentes"); }
    else if (r.materia) { setMateriaNav(r.rawMateria); setView("materias"); }
    else setView("horarios");
  };

  const handleGoToConflictos = () => {
    setHorariosTab("conflictos");
    setView("horarios");
  };

  return (
    <div style={{
      display: "flex", height: "100dvh", fontFamily: "var(--font-sans)",
      background: "var(--color-background-tertiary)", overflow: "hidden",
    }}>

      {cambiarPwdOpen && (
        <ModalCambiarPassword
          onCerrar={() => setCambiarPwdOpen(false)}
          showToast={appData.showToast}
        />
      )}

      <UploadPreviewModal
        open={!!appData.previewData}
        data={appData.previewData}
        onConfirm={appData.confirmPreview}
        onCancel={appData.cancelPreview}
      />

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
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 299 }}
        />
      )}

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <div
        className={`sb-flow-spacer ${expanded ? "sb-expanded" : "sb-collapsed"}`}
        style={{ flexShrink: 0, transition: "width .22s" }}
      />
      <aside
        className={`sb ${expanded ? "sb-expanded" : "sb-collapsed"} ${mobileOpen ? "mobile-open" : ""}`}
        onMouseEnter={() => !pinned && setHovered(true)}
        onMouseLeave={() => { if (!pinned) { setHovered(false); setAdminOpen(false); } }}
        style={{
          background: "var(--color-text-primary)", display: "flex", flexDirection: "column",
          flexShrink: 0, borderRight: "1px solid var(--navy-800)", position: "relative",
        }}
      >
        {/* Marca + pin */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "14px 10px 12px",
          borderBottom: "1px solid var(--navy-800)", flexShrink: 0,
        }}>
          <ProgramaLogo programa={appData.selectedPrograma ?? "todos"} size={32} />
          <div className="sb-label" style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-background-tertiary)", whiteSpace: "nowrap" }}>
              SIGMA
            </div>
            <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginTop: 1, whiteSpace: "nowrap" }}>
              Gest. y Módulos Académicos
            </div>
          </div>
          {expanded && (
            <button
              className={`pin-btn ${pinned ? "pinned" : ""}`}
              onClick={togglePin}
              title={pinned ? "Desfijar sidebar" : "Fijar sidebar"}
              aria-label={pinned ? "Desfijar sidebar" : "Fijar sidebar"}
            >
              <i className={`ti ${pinned ? "ti-pinned" : "ti-pin"}`} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Trimestre activo */}
        <div style={{ padding: "10px 10px 10px", borderBottom: "1px solid var(--navy-800)", flexShrink: 0 }}>
          {!expanded ? (
            <div
              style={{
                width: 32, height: 32, borderRadius: 7, flexShrink: 0,
                background: modoConsulta ? "#451A03" : "#0C1A3A",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, cursor: modoConsulta ? "pointer" : "default",
              }}
              onClick={() => modoConsulta && handleCambiarLapso(getCurrentLapso())}
              title={modoConsulta ? `Historial: ${lapso}` : `Trimestre activo: ${lapso}`}
            >
              <i className={`ti ${modoConsulta ? "ti-archive" : "ti-calendar-event"}`} aria-hidden="true" />
            </div>
          ) : (
            <div>
              <div style={{
                fontSize: 9, fontWeight: 700, color: "var(--navy-700)", textTransform: "uppercase",
                letterSpacing: "0.08em", marginBottom: 3,
              }}>
                {modoConsulta ? "Consultando historial" : "Trimestre activo"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color: modoConsulta ? "#FBBF24" : "var(--color-accent-light)", flex: 1, whiteSpace: "nowrap",
                }}>
                  {formatLapso(lapso)}
                </span>
                {modoConsulta && (
                  <button
                    onClick={() => handleCambiarLapso(getCurrentLapso())}
                    style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 5,
                      border: "1px solid var(--navy-700)", background: "var(--navy-800)",
                      color: "var(--color-accent-light)", cursor: "pointer", fontWeight: 600, flexShrink: 0,
                      display: "flex", alignItems: "center",
                    }}
                  >
                    <i className="ti ti-arrow-back-up" style={{ fontSize: 12 }} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Selector de programa */}
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--navy-800)", flexShrink: 0 }}>
          {expanded ? (
            <select
              value={appData.selectedPrograma}
              onChange={e => puedeSeleccionarPrograma && appData.setSelectedPrograma(e.target.value)}
              disabled={!puedeSeleccionarPrograma}
              style={{
                ...S.select, width: "100%", background: "var(--navy-800)", color: "var(--color-border-secondary)",
                borderColor: "var(--navy-700)", fontSize: 12, padding: "6px 8px",
                opacity: puedeSeleccionarPrograma ? 1 : 0.6,
                cursor: puedeSeleccionarPrograma ? "pointer" : "not-allowed",
              }}
            >
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
            <ProgramaLogo programa={appData.selectedPrograma ?? "todos"} size={32} />
          )}
        </div>

        {/* Navegación */}
        <nav style={{ flex: 1, padding: "8px 8px 6px", overflowY: "auto", overflowX: "hidden" }}>
          {navGroups.map((group, gi) => (
            <div key={group.label} style={{ marginBottom: gi < navGroups.length - 1 ? 4 : 0 }}>
              {gi > 0 && (
                <div style={{ height: 1, background: "var(--navy-800)", margin: "6px 4px 8px" }} />
              )}
              <div className="sb-group-title" style={{
                fontSize: 9, fontWeight: 700, color: "var(--navy-700)", textTransform: "uppercase",
                letterSpacing: "0.1em", padding: "0 8px", marginBottom: 4, transition: "opacity 0.15s",
              }}>
                {group.label}
              </div>
              {group.items.map(item => {
                const active = view === item.id;
                const badge  = item.hasBadge ? conflictCount : 0;
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${active ? "active" : ""}`}
                    onClick={() => { setView(item.id); setMobileOpen(false); }}
                  >
                    <i className={`ti ${item.icon}`} style={{ fontSize: 16, flexShrink: 0, width: 20, textAlign: "center" }} aria-hidden="true" />
                    <span className="sb-label" style={{ flex: 1 }}>{item.label}</span>
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
            appData={appData}
            modoConsulta={modoConsulta}
            onClose={() => setAdminOpen(false)}
            fileRef={fileRef}
            backupRef={backupRef}
            permisos={permisos}
          />
        )}

        {/* Los inputs type="file" viven en App.jsx para que no sean
            afectados por re-renders del sidebar (onMouseLeave/adminOpen) */}

        {/* Footer: botón admin */}
        <div style={{ borderTop: "1px solid var(--navy-800)", padding: "8px 8px", flexShrink: 0 }}>
          {(permisos.puedeImportarExcel || permisos.puedeHacerBackup || permisos.puedeBorrarHorarios) && (
            <button
              onClick={() => setAdminOpen(o => !o)}
              className="nav-item"
              style={{
                marginBottom: 6,
                color: adminOpen ? "var(--color-border-info)" : "var(--color-text-tertiary)",
                background: adminOpen ? "var(--navy-800)" : "transparent",
              }}
              title="Administración"
            >
              <i className="ti ti-settings" style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: "center" }} aria-hidden="true" />
              <span className="sb-label" style={{ flex: 1 }}>Administración</span>
              {appData.uploading && (
                <span style={{
                  width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--color-accent)",
                  borderTop: "1.5px solid transparent", animation: "spin .7s linear infinite", flexShrink: 0,
                }} />
              )}
              <span className="tooltip">Administración</span>
            </button>
          )}
        </div>
      </aside>

      {/* ── CONTENIDO PRINCIPAL ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

        {/* Topbar */}
        <header className="topbar">
          <button
            className="hamburger"
            onClick={() => setMobileOpen(o => !o)}
            aria-label={mobileOpen ? "Cerrar menú de navegación" : "Abrir menú de navegación"}
            aria-expanded={mobileOpen}
            style={{
              display: "none", background: "none", border: "1px solid var(--color-border-tertiary)",
              borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontSize: 17,
              color: "var(--navy-700)", flexShrink: 0, alignItems: "center",
            }}
          >
            <i className="ti ti-menu-2" aria-hidden="true" />
          </button>

          <div style={{ flex: 1, maxWidth: 420 }}>
            <GlobalSearch
              onNavigate={handleNavigate}
              docenteNames={appData.docenteNames}
              materiaNames={appData.materiaNames}
              data={appData.data}
            />
          </div>

          <UserMenu
            variant="horarios"
            profile={profile}
            rolLabel={rolInfo.label}
            rolColor={rolInfo.color}
            open={userMenuOpen}
            onToggle={() => setUserMenuOpen(o => !o)}
            onClose={() => setUserMenuOpen(false)}
            onCambiarPassword={() => setCambiarPwdOpen(true)}
            onLogout={handleLogout}
            tieneHorarios={tieneHorarios}
            tieneQR={tieneQR}
            onCambiarModulo={onCambiarModulo}
          />

          {appData.isSyncing && (
            <span style={{
              fontSize: 11, color: "var(--color-text-tertiary)", whiteSpace: "nowrap",
              flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
            }}>
              <i className="ti ti-refresh" style={{ animation: "spin 1.1s linear infinite" }} aria-hidden="true" /> Actualizando…
            </span>
          )}
        </header>

        {/* Banner modo consulta */}
        {modoConsulta && (
          <div style={{
            background: "var(--color-warning-bg)", borderBottom: "1px solid var(--color-warning-border)",
            padding: "7px 20px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          }}>
            <span style={{
              fontSize: 13, color: "var(--color-warning-text)", fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <i className="ti ti-archive" aria-hidden="true" /> Modo consulta — estás viendo el trimestre {formatLapso(lapso)} (solo lectura)
            </span>
            <button
              onClick={() => handleCambiarLapso(getCurrentLapso())}
              style={{
                marginLeft: "auto", fontSize: 12, padding: "4px 12px", borderRadius: 6,
                border: "1px solid var(--color-warning-border)", background: "#fff",
                color: "var(--color-warning-text)", cursor: "pointer", fontWeight: 600,
                flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <i className="ti ti-arrow-back-up" aria-hidden="true" /> Volver al trimestre activo
            </button>
          </div>
        )}

        {/* Vistas */}
        <main style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {view === "resumen" && (
            <ResumenView
              stats={appData.stats} data={appData.data}
              byDocente={appData.byDocente} byMateria={appData.byMateria}
              conflicts={appData.conflicts}
              getDocName={appData.getDocName} getMateriaName={appData.getMateriaName}
              onGoToConflictos={handleGoToConflictos}
              isSyncing={appData.isSyncing}
              permisos={permisos}
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
              modoConsulta={modoConsulta}
              lapso={lapso}
            />
          )}
          {view === "materias" && (
            <MateriasView
              byMateria={appData.byMateria} initialSel={materiaNav}
              onConsumeNav={() => setMateriaNav(null)}
              getMateriaName={appData.getMateriaName}
              onSaveMateriaName={permisos.puedeEditarMaterias ? appData.saveMateriaName : null}
              data={appData.data} getDocName={appData.getDocName}
              modoConsulta={modoConsulta}
              lapso={lapso}
            />
          )}
          {view === "asistencias" && (
            <AsistenciasView
              data={appData.data} getDocName={appData.getDocName}
              getMateriaName={appData.getMateriaName} lapso={lapso}
            />
          )}
          {view === "historial" && (
            <Suspense fallback={<LazyFallback label="Cargando historial…" />}>
              <HistorialView
                lapsoActivo={lapso}
                onCambiarLapso={handleCambiarLapso}
                showToast={appData.showToast}
                openConfirm={appData.openConfirm}
                closeConfirm={appData.closeConfirm}
                user={user}
                modoConsulta={!permisos.puedeGestionarTrimestres}
                programaRestringido={permisos.puedeVerSoloSuPrograma ? permisos.programaRestringido : null}
              />
            </Suspense>
          )}
          {view === "logs" && permisos.puedeVerLogs && (
            <Suspense fallback={<LazyFallback label="Cargando registros…" />}>
              <LogsView permisos={permisos} />
            </Suspense>
          )}
          {view === "usuarios" && (permisos.puedeGestionarUsuarios || permisos.puedeGestionarRoles) && (
            <Suspense fallback={<LazyFallback label="Cargando usuarios…" />}>
              <UsuariosView
                permisos={permisos}
                programas={appData.data?.programas || []}
                logAudit={appData.logAudit}
                showToast={appData.showToast}
              />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
