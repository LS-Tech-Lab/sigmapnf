import React, { lazy, Suspense } from "react";
import { useAppDataContext } from "../context/AppDataContext";
import { getCurrentLapso, formatLapso } from "../utils/lapso";
import HorariosSidebar from "./HorariosSidebar";
import HorariosTopbar from "./HorariosTopbar";
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
  <div className="lazy-fallback">
    <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" />
    {label}
  </div>
);

/**
 * Shell completo del módulo de Horarios.
 * Se monta cuando moduloActivo === "horarios" (o por defecto).
 *
 * El sidebar (marca, trimestre, selector de programa, navegación, admin y
 * lógica de expansión/colapso) vive en `HorariosSidebar.jsx`, y el header
 * (búsqueda global, menú de usuario, indicadores de sync) en
 * `HorariosTopbar.jsx` — extraídos de este archivo en ARCH-8. Este archivo
 * orquesta modales globales, el banner de modo consulta y el switch de
 * vistas del contenido principal.
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

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <HorariosSidebar
        view={view} setView={setView}
        modoConsulta={modoConsulta}
        lapso={lapso}
        handleCambiarLapso={handleCambiarLapso}
        hovered={hovered} setHovered={setHovered}
        pinned={pinned} togglePin={togglePin}
        mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}
        adminOpen={adminOpen} setAdminOpen={setAdminOpen}
        permisos={permisos}
        fileRef={fileRef} backupRef={backupRef}
      />

      {/* ── CONTENIDO PRINCIPAL ──────────────────────────────────────────────── */}
      <div className="hl-content-col">

        {/* Topbar */}
        <HorariosTopbar
          setView={setView} setDocenteNav={setDocenteNav} setMateriaNav={setMateriaNav}
          mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}
          userMenuOpen={userMenuOpen} setUserMenuOpen={setUserMenuOpen}
          profile={profile}
          handleLogout={handleLogout}
          setCambiarPwdOpen={setCambiarPwdOpen}
          tieneHorarios={tieneHorarios}
          tieneQR={tieneQR}
          onCambiarModulo={onCambiarModulo}
          pendientesCount={pendientesCount}
        />

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
