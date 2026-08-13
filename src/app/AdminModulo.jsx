import React, { lazy, Suspense, useState } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import ModalCambiarPassword from "../components/ModalCambiarPassword";
import UserMenu from "./UserMenu";
import { useAppDataContext } from "../context/AppDataContext";

const UsuariosView  = lazy(() => import("../components/usuarios"));
const LogsView       = lazy(() => import("../components/LogsView"));
const HistorialView  = lazy(() => import("../components/HistorialView"));
const ConfiguracionReportes = lazy(() => import("../components/ConfiguracionReportes"));
const GestionSedes   = lazy(() => import("../components/GestionSedes"));

const AdminFallback = () => (
  <div className="lazy-fallback">
    <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" />
    Cargando…
  </div>
);

/**
 * Shell del módulo "Sistema" (ADMIN-3, auditoría 10 de julio). Internamente
 * sigue llamándose "admin" en el código (moduloActivo === "admin",
 * useModuloActivo.tieneAdmin) — solo el nombre visible para el usuario es
 * "Sistema", para no chocar con el dropdown "Administración" que ya
 * existía en el sidebar de Horarios (AdminMenu.jsx: Importar Excel,
 * Backup, Restaurar, Borrar Horarios).
 * Se monta cuando moduloActivo === "admin". Agrupa lo que antes vivía sin
 * filtro dentro del grupo "Sistema" de Horarios: Usuarios y Roles,
 * Registros (Logs) e Historial.
 *
 * Decisión de producto confirmada (10 de julio): Historial pasa a ser
 * EXCLUSIVO de este módulo — antes era visible sin chequeo de permiso
 * para cualquiera con acceso a Horarios; un docente/operador sin ningún
 * permiso admin ya no lo ve. Por eso la pestaña "historial" no tiene
 * gate propio abajo: cualquiera que llegó a este módulo (tieneAdmin en
 * useModuloActivo) ya tiene al menos uno de los permisos admin.
 *
 * El gate de "Registros" se deja EXACTAMENTE igual que en
 * buildNavGroups.js/HorariosLayout antes de este cambio (solo
 * puedeVerLogs, no puedeVerAuditoria) para no ampliar accesos como
 * efecto secundario de la migración — ver LogsView.jsx para el detalle
 * de sus pestañas internas.
 *
 * Reutiliza las clases CSS globales `asm-*` (definidas en src/index.css
 * para AsistenciasModulo) en vez de crear un archivo CSS nuevo: mismo
 * look de topbar/tabs, cero reglas nuevas que mantener.
 *
 * Props:
 *   profile, permisos     — perfil y permisos efectivos
 *   user                  — de useAuth (lo necesita HistorialView)
 *   lapso, onCambiarLapso — estado de lapso compartido con Horarios
 *                           (vive en App.jsx, no se duplica aquí)
 *   tieneHorarios, tieneQR — para el botón "Módulos" (volver al selector)
 *   onVolverSelector      — setModuloActivo(null)
 *   onLogout              — handleLogout de useAuth
 *
 * appData (showToast, openConfirm, closeConfirm, logAudit, data.programas)
 * se consume vía AppDataContext (ARCH-8) — el padre (App.jsx) envuelve
 * este componente en <AppDataProvider>, igual que HorariosLayout.
 */
export default function AdminModulo({
  profile,
  permisos = {},
  user,
  lapso,
  onCambiarLapso,
  tieneHorarios,
  tieneQR,
  onVolverSelector,
  onLogout,
}) {
  const appData = useAppDataContext();

  const TABS = [
    ...(permisos.puedeGestionarUsuarios || permisos.puedeGestionarRoles
      ? [{ id: "usuarios", icon: "ti-crown", label: "Usuarios y Roles" }]
      : []),
    ...(permisos.puedeVerLogs
      ? [{ id: "logs", icon: "ti-shield-lock", label: "Registros" }]
      : []),
    // ADMIN-6 (1 ago): personalización del membrete de los reportes
    // imprimibles — gateada por su propio permiso granular
    // (puedeConfigurarReportes), no por pertenecer a este módulo.
    ...(permisos.puedeConfigurarReportes
      ? [{ id: "reportes", icon: "ti-palette", label: "Reportes" }]
      : []),
    // SEDE-17 (6 ago): alta/edición/activación del catálogo de sedes —
    // mismo criterio que "Reportes": permiso granular propio
    // (puedeGestionarSedes), no puedeVerTodasLasSedes (una cosa es VER
    // todas las sedes en los reportes, otra ADMINISTRAR el catálogo).
    // Fase 1 del editor de plantillas (12 ago): la pestaña "Plantillas"
    // vive dentro de este mismo panel (GestionSedes.jsx) pero detrás de
    // su propio permiso (puedeGestionarPlantillas) — alguien con SOLO
    // ese permiso también necesita ver esta entrada de nav para poder
    // llegar a su pestaña; GestionSedes decide adentro cuáles de sus 4
    // sub-pestañas mostrar según qué permiso puntual tenga cada quien.
    ...(permisos.puedeGestionarSedes || permisos.puedeGestionarPlantillas
      ? [{ id: "sedes", icon: "ti-building-community", label: "Sedes" }]
      : []),
    { id: "historial", icon: "ti-archive", label: "Historial" },
  ];

  const [tab, setTab] = useState(TABS[0]?.id || "historial");
  const [userMenuOpen,   setUserMenuOpen]   = useState(false);
  const [cambiarPwdOpen, setCambiarPwdOpen] = useState(false);

  const rolLabel = profile.rol_info?.label || "Administrador";
  const rolColor = profile.rol_info?.color || "#7C3AED";

  return (
    <div className="asm-root">
      {cambiarPwdOpen && (
        <ModalCambiarPassword
          onCerrar={() => setCambiarPwdOpen(false)}
          showToast={appData.showToast}
        />
      )}

      {/* Topbar */}
      <header className="asm-topbar">
        {/* Volver al selector — solo si también tiene acceso a otro módulo */}
        {(tieneHorarios || tieneQR) && (
          <button onClick={onVolverSelector} className="topbar-back-btn">
            <i className="ti ti-arrow-left" aria-hidden="true" /> Módulos
          </button>
        )}

        {/* Pestañas internas */}
        <div className="asm-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`asm-tab ${tab === t.id ? "asm-tab--active" : ""}`}
            >
              <i className={`ti ${t.icon}`} aria-hidden="true" /> {t.label}
            </button>
          ))}
        </div>

        {/* Menú de usuario */}
        <UserMenu
          variant="asistencias"
          profile={profile}
          rolLabel={rolLabel}
          rolColor={rolColor}
          open={userMenuOpen}
          onToggle={() => setUserMenuOpen(o => !o)}
          onClose={() => setUserMenuOpen(false)}
          onCambiarPassword={() => setCambiarPwdOpen(true)}
          onLogout={onLogout}
        />
      </header>

      {/* Sub-vistas */}
      <main className="asm-main">
        <ErrorBoundary>
          <Suspense fallback={<AdminFallback />}>
            {tab === "usuarios" && (permisos.puedeGestionarUsuarios || permisos.puedeGestionarRoles) && (
              <UsuariosView
                permisos={permisos}
                profile={profile}
                programas={appData.data?.programas || []}
                logAudit={appData.logAudit}
                showToast={appData.showToast}
              />
            )}

            {tab === "logs" && permisos.puedeVerLogs && (
              <LogsView permisos={permisos} showToast={appData.showToast} />
            )}

            {tab === "reportes" && permisos.puedeConfigurarReportes && (
              <ConfiguracionReportes showToast={appData.showToast} logAudit={appData.logAudit} />
            )}

            {tab === "sedes" && (permisos.puedeGestionarSedes || permisos.puedeGestionarPlantillas) && (
              <GestionSedes showToast={appData.showToast} logAudit={appData.logAudit} permisos={permisos} />
            )}

            {tab === "historial" && (
              <HistorialView
                lapsoActivo={lapso}
                onCambiarLapso={onCambiarLapso}
                showToast={appData.showToast}
                openConfirm={appData.openConfirm}
                closeConfirm={appData.closeConfirm}
                user={user}
                modoConsulta={!permisos.puedeGestionarTrimestres}
                programasRestringidos={permisos.puedeVerSoloSuPrograma ? permisos.programasRestringidos : []}
              />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
