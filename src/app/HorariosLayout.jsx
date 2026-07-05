import React, { lazy, Suspense } from "react";
import { useAppDataContext } from "../context/AppDataContext";
import { ROL_SIDEBAR } from "../constants";
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
  <div className="hl-lazy-fallback">
    <i className="ti ti-loader-2 hl-lazy-spin" aria-hidden="true" />
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
 *   appData           — consumido desde AppDataContext (ARCH-5), ya no es prop
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
  // Datos y auth (appData viene de AppDataContext — ARCH-5)
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
  // UX-4: badge de registros offline pendientes
  pendientesCount = 0,
}) {
  const appData = useAppDataContext();
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
    <div className="hl-root">

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
          className="hl-overlay"
        />
      )}

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <div
        className={`sb-flow-spacer ${expanded ? "sb-expanded" : "sb-collapsed"}`}
      />
      <aside
        className={`sb ${expanded ? "sb-expanded" : "sb-collapsed"} ${mobileOpen ? "mobile-open" : ""}`}
        onMouseEnter={() => !pinned && setHovered(true)}
        onMouseLeave={() => { if (!pinned) { setHovered(false); setAdminOpen(false); } }}
      >
        {/* Marca + pin */}
        <div className="hl-brand-row">
          <ProgramaLogo programa={appData.selectedPrograma ?? "todos"} size={32} />
          <div className="sb-label hl-brand-text-wrap">
            <div className="hl-brand-title">
              SIGMA
            </div>
            <div className="hl-brand-subtitle">
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
        <div className="hl-lapso-box">
          {!expanded ? (
            <div
              className={`hl-lapso-icon ${modoConsulta ? "hl-lapso-icon--consulta" : ""}`}
              onClick={() => modoConsulta && handleCambiarLapso(getCurrentLapso())}
              title={modoConsulta ? `Historial: ${lapso}` : `Trimestre activo: ${lapso}`}
            >
              <i className={`ti ${modoConsulta ? "ti-archive" : "ti-calendar-event"}`} aria-hidden="true" />
            </div>
          ) : (
            <div>
              <div className="hl-lapso-label">
                {modoConsulta ? "Consultando historial" : "Trimestre activo"}
              </div>
              <div className="hl-lapso-row">
                <span className={`hl-lapso-value ${modoConsulta ? "hl-lapso-value--consulta" : ""}`}>
                  {formatLapso(lapso)}
                </span>
                {modoConsulta && (
                  <button
                    onClick={() => handleCambiarLapso(getCurrentLapso())}
                    className="hl-lapso-reset-btn"
                  >
                    <i className="ti ti-arrow-back-up hl-icon-sm" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Selector de programa */}
        <div className="hl-programa-box">
          {expanded ? (
            <select
              value={appData.selectedPrograma}
              onChange={e => puedeSeleccionarPrograma && appData.setSelectedPrograma(e.target.value)}
              disabled={!puedeSeleccionarPrograma}
              className="s-select hl-select-dark"
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
        <nav className="hl-nav">
          {navGroups.map((group, gi) => (
            <div key={group.label} className={`hl-nav-group ${gi < navGroups.length - 1 ? "" : "hl-nav-group--last"}`}>
              {gi > 0 && (
                <div className="hl-nav-divider" />
              )}
              <div className="sb-group-title hl-nav-title">
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
                    <i className={`ti ${item.icon} hl-nav-icon`} aria-hidden="true" />
                    <span className="sb-label hl-nav-label">{item.label}</span>
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
        <div className="hl-footer">
          {(permisos.puedeImportarExcel || permisos.puedeHacerBackup || permisos.puedeBorrarHorarios) && (
            <button
              onClick={() => setAdminOpen(o => !o)}
              className={`nav-item hl-admin-btn ${adminOpen ? "hl-admin-btn--open" : ""}`}
              title="Administración"
            >
              <i className="ti ti-settings hl-admin-icon" aria-hidden="true" />
              <span className="sb-label hl-nav-label">Administración</span>
              {appData.uploading && (
                <span className="hl-uploading-dot" />
              )}
              <span className="tooltip">Administración</span>
            </button>
          )}
        </div>
      </aside>

      {/* ── CONTENIDO PRINCIPAL ──────────────────────────────────────────────── */}
      <div className="hl-content-col">

        {/* Topbar */}
        <header className="topbar">
          <button
            className="hamburger"
            onClick={() => setMobileOpen(o => !o)}
            aria-label={mobileOpen ? "Cerrar menú de navegación" : "Abrir menú de navegación"}
            aria-expanded={mobileOpen}
          >
            <i className="ti ti-menu-2" aria-hidden="true" />
          </button>

          <div className="hl-search-wrap">
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
            <span className="hl-syncing">
              <i className="ti ti-refresh hl-spin-slow" aria-hidden="true" /> Actualizando…
            </span>
          )}

          {/* UX-4: badge de registros offline pendientes de sincronizar */}
          {pendientesCount > 0 && (
            <span
              title={`${pendientesCount} registro${pendientesCount > 1 ? 's' : ''} de asistencia pendiente${pendientesCount > 1 ? 's' : ''} de sincronizar`}
              className="hl-pendientes-badge"
            >
              <i className="ti ti-clock-exclamation" aria-hidden="true" />
              {pendientesCount} pendiente{pendientesCount > 1 ? 's' : ''}
            </span>
          )}
        </header>

        {/* Banner modo consulta */}
        {modoConsulta && (
          <div className="hl-consulta-banner">
            <span className="hl-consulta-text">
              <i className="ti ti-archive" aria-hidden="true" /> Modo consulta — estás viendo el trimestre {formatLapso(lapso)} (solo lectura)
            </span>
            <button
              onClick={() => handleCambiarLapso(getCurrentLapso())}
              className="hl-consulta-btn"
            >
              <i className="ti ti-arrow-back-up" aria-hidden="true" /> Volver al trimestre activo
            </button>
          </div>
        )}

        {/* Vistas */}
        <main className="hl-main">
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
