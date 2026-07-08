// Sidebar del módulo Horarios: marca, trimestre activo, selector de programa,
// navegación, dropdown de administración y lógica de expansión/colapso
// (hover, pin, apertura móvil). Extraído de HorariosLayout.jsx (ARCH-8).
import { useAppDataContext } from "../context/AppDataContext";
import { getCurrentLapso, formatLapso } from "../utils/lapso";
import buildNavGroups from "./buildNavGroups";
import AdminMenu from "./AdminMenu";
import ProgramaLogo from "../components/ProgramaLogo";

/**
 * Props — navegación:
 *   view, setView
 *   modoConsulta, lapso, handleCambiarLapso
 *
 * Props — UI / colapso:
 *   hovered, setHovered
 *   pinned, togglePin
 *   mobileOpen, setMobileOpen
 *   adminOpen, setAdminOpen
 *
 * Props — datos y auth:
 *   permisos
 *   fileRef, backupRef
 */
export default function HorariosSidebar({
  view, setView,
  modoConsulta,
  lapso,
  handleCambiarLapso,
  hovered, setHovered,
  pinned, togglePin,
  mobileOpen, setMobileOpen,
  adminOpen, setAdminOpen,
  permisos,
  fileRef, backupRef,
}) {
  const appData = useAppDataContext();

  // Lógica de colapso: expandido si está fijado, en hover, o abierto en móvil.
  const expanded = pinned || hovered || mobileOpen;

  const navGroups      = buildNavGroups(permisos);
  const conflictCount  = appData.conflicts.length;
  const puedeSeleccionarPrograma = !permisos.puedeVerSoloSuPrograma;

  return (
    <>
      {/* Overlay móvil */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="hl-overlay"
        />
      )}

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
    </>
  );
}
