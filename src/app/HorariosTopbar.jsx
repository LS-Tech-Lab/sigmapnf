// Topbar del módulo Horarios: hamburguesa móvil, búsqueda global, menú de
// usuario, indicador de sincronización y badge de pendientes offline.
// Extraído de HorariosLayout.jsx (ARCH-11).
import { useAppDataContext } from "../context/AppDataContext";
import { ROL_SIDEBAR } from "../constants";
import UserMenu from "./UserMenu";
import GlobalSearch from "../components/GlobalSearch";

/**
 * Props — navegación:
 *   setView, setDocenteNav, setMateriaNav
 *
 * Props — UI:
 *   mobileOpen, setMobileOpen
 *   userMenuOpen, setUserMenuOpen
 *
 * Props — datos y auth:
 *   profile
 *   handleLogout
 *   setCambiarPwdOpen
 *
 * Props — módulos:
 *   tieneHorarios, tieneQR, onCambiarModulo
 *
 * Props — UX-4:
 *   pendientesCount
 */
export default function HorariosTopbar({
  setView, setDocenteNav, setMateriaNav,
  mobileOpen, setMobileOpen,
  userMenuOpen, setUserMenuOpen,
  profile,
  handleLogout,
  setCambiarPwdOpen,
  tieneHorarios,
  tieneQR,
  onCambiarModulo,
  pendientesCount = 0,
}) {
  const appData = useAppDataContext();

  const rolInfo = profile.rol_info
    ? { label: profile.rol_info.label, color: profile.rol_info.color }
    : ROL_SIDEBAR[profile.rol] || { label: profile.rol, color: "var(--color-text-tertiary)" };

  const handleNavigate = (r) => {
    if (r.docente) { setDocenteNav(r.rawDocente || r.docente); setView("docentes"); }
    else if (r.materia) { setMateriaNav(r.rawMateria); setView("materias"); }
    else setView("horarios");
  };

  return (
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
  );
}
