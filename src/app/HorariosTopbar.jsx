// Topbar del módulo Horarios: hamburguesa móvil, búsqueda global, menú de
// usuario, indicador de sincronización y badge de pendientes offline.
// Extraído de HorariosLayout.jsx (ARCH-11).
import { useState } from "react";
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

      {/* Fix U-13/ARCH-19 (auditoría 14 de julio): "Cambiar módulo" estaba
          enterrado en el dropdown de UserMenu, inconsistente con Asistencias
          donde es un botón visible del topbar. Unificado: mismo patrón,
          misma clase (.topbar-back-btn), mismo lugar en ambos módulos. */}
      {tieneHorarios && tieneQR && (
        <button
          onClick={onCambiarModulo}
          className="topbar-back-btn"
        >
          <i className="ti ti-arrow-left" aria-hidden="true" /> Módulos
        </button>
      )}

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

      {/* Fix OFF-12 (auditoría de estrés operacional, 10 de agosto):
          badge de cargas de Excel que quedaron pendientes de reintentar
          por un corte de red — mismo patrón visual que el badge de
          asistencias de arriba, pero con un desplegable propio porque acá
          "reintentar" es una acción explícita del usuario por archivo,
          no un sync automático en segundo plano (ver comentario grande
          en excelUploadQueue.js sobre por qué no se reintenta solo). */}
      {appData.cargasExcelPendientes?.length > 0 && (
        <CargasExcelPendientesBadge
          cargas={appData.cargasExcelPendientes}
          onReintentar={appData.reintentarCargaExcel}
          onDescartar={appData.descartarCargaExcelPendiente}
        />
      )}
    </header>
  );
}

function CargasExcelPendientesBadge({ cargas, onReintentar, onDescartar }) {
  const [abierto, setAbierto] = useState(false);
  const n = cargas.length;

  return (
    <div className="hl-cargas-excel-wrap">
      <button
        type="button"
        className="hl-pendientes-badge hl-cargas-excel-badge"
        title={`${n} carga${n > 1 ? 's' : ''} de Excel pendiente${n > 1 ? 's' : ''} de reintentar (se perdió la conexión durante la carga)`}
        onClick={() => setAbierto(o => !o)}
        aria-expanded={abierto}
      >
        <i className="ti ti-file-upload" aria-hidden="true" />
        {n} carga{n > 1 ? 's' : ''} pendiente{n > 1 ? 's' : ''}
      </button>

      {abierto && (
        <div className="hl-cargas-excel-dropdown" role="menu">
          {cargas.map(c => (
            <div key={c.id} className="hl-cargas-excel-item">
              <span className="hl-cargas-excel-nombre" title={c.fileName}>
                <i className="ti ti-file-spreadsheet" aria-hidden="true" /> {c.fileName}
              </span>
              <div className="hl-cargas-excel-acciones">
                <button
                  type="button"
                  className="hl-cargas-excel-btn hl-cargas-excel-btn--reintentar"
                  onClick={() => { setAbierto(false); onReintentar?.(c.id); }}
                >
                  Reintentar
                </button>
                <button
                  type="button"
                  className="hl-cargas-excel-btn hl-cargas-excel-btn--descartar"
                  onClick={() => onDescartar?.(c.id)}
                  title="Descartar esta carga pendiente sin reintentarla"
                >
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
