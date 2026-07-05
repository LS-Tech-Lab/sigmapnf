import React, { lazy, Suspense, useState, useEffect, useRef } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import ModalCambiarPassword from "../components/ModalCambiarPassword";
import UserMenu from "./UserMenu";

// P5: imports lazy para separar el módulo QR del bundle principal
const AdminQRPanel      = lazy(() => import("../components/asistencias/AdminQRPanel"));
const QRProyeccion      = lazy(() => import("../components/asistencias/QRProyeccion"));
const ReporteAsistencias = lazy(() => import("../components/asistencias/ReporteAsistencias"));
const PlanillaQR         = lazy(() => import("../components/asistencias/PlanillaQR"));

const QRFallback = () => (
  <div className="lazy-fallback">
    <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" />
    Cargando…
  </div>
);

/**
 * Shell completo del módulo de Asistencias QR.
 * Se monta cuando moduloActivo === "asistencias".
 *
 * Props:
 *   profile          — perfil del usuario
 *   qrSession        — objeto completo de useQRSession()
 *   tieneHorarios    — si el usuario también tiene acceso al módulo de horarios
 *   onVolverSelector — callback para volver al ModuleSelector
 *   showToast        — función de toast (de appData)
 *   onLogout         — handleLogout de useAuth
 */
export default function AsistenciasModulo({
  profile,
  permisos = {},
  qrSession,
  tieneHorarios,
  onVolverSelector,
  showToast,
  onLogout,
  // UX-4: badge de registros offline pendientes
  pendientesCount = 0,
}) {
  // subView inicial: "panel" si tiene puedeGestionarQR, si no "reporte"
  const initialView = permisos.puedeGestionarQR ? "panel" : "reporte";
  const [subView,           setSubView]           = useState(initialView); // "panel" | "proyeccion" | "reporte"
  const [userMenuOpen,      setUserMenuOpen]      = useState(false);
  const [cambiarPwdOpen,    setCambiarPwdOpen]    = useState(false);
  const [headerVisible,     setHeaderVisible]     = useState(true);
  const headerTimerRef = useRef(null);

  const rolLabel = profile.rol_info?.label || "Operador QR";
  const rolColor = profile.rol_info?.color || "#34D399";

  // ── Detectar ?proyeccion=1 en la URL ────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("proyeccion") === "1") {
      setSubView("proyeccion");
      const url = new URL(window.location.href);
      url.searchParams.delete("proyeccion");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // ── Auto-ocultar header en proyección ────────────────────────────────────
  useEffect(() => {
    if (subView !== "proyeccion") {
      setHeaderVisible(true);
      clearTimeout(headerTimerRef.current);
      return;
    }
    const show = () => {
      setHeaderVisible(true);
      clearTimeout(headerTimerRef.current);
      headerTimerRef.current = setTimeout(() => setHeaderVisible(false), 4000);
    };
    show();
    window.addEventListener("mousemove", show);
    window.addEventListener("touchstart", show);
    return () => {
      clearTimeout(headerTimerRef.current);
      window.removeEventListener("mousemove", show);
      window.removeEventListener("touchstart", show);
    };
  }, [subView]);

  // V-3 fix: filtrar pestañas según permisos individuales.
  // Antes todas las pestañas eran accesibles a cualquier usuario que
  // llegara al módulo, sin verificar puedeGestionarQR / puedeVerReporteAsistencias.
  const TABS = [
    ...(permisos.puedeGestionarQR
      ? [
          { id: "panel",      icon: "ti-device-mobile", label: "Panel QR"   },
          { id: "proyeccion", icon: "ti-device-tv",     label: "Proyección" },
        ]
      : []),
    ...(permisos.puedeVerReporteAsistencias
      ? [{ id: "reporte", icon: "ti-report", label: "Reporte" }]
      : []),
    // Planilla imprimible (derivada del horario, no de datos QR) — visible
    // a cualquiera con acceso al módulo, igual que en Horarios.
    { id: "planilla", icon: "ti-printer", label: "Planilla" },
  ];

  return (
    <div className="asm-root">

      {cambiarPwdOpen && (
        <ModalCambiarPassword
          onCerrar={() => setCambiarPwdOpen(false)}
          showToast={showToast}
        />
      )}

      {/* Topbar */}
      <header className={`asm-topbar ${headerVisible ? "" : "asm-topbar--hidden"}`}>

        {/* Volver al selector — solo si también tiene acceso a horarios */}
        {tieneHorarios && (
          <button
            onClick={() => { qrSession.cerrarSesion(); onVolverSelector(); }}
            className="asm-back-btn"
          >
            <i className="ti ti-arrow-left" aria-hidden="true" /> Módulos
          </button>
        )}

        {/* Pestañas internas */}
        <div className="asm-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSubView(tab.id)}
              className={`asm-tab ${subView === tab.id ? "asm-tab--active" : ""}`}
            >
              <i className={`ti ${tab.icon}`} aria-hidden="true" /> {tab.label}
            </button>
          ))}
        </div>

        {/* Indicador de sesión QR activa */}
        {qrSession.activa && (
          <div className="asm-session-badge">
            <span className="asm-session-dot" />
            <span className="asm-session-text">Sesión activa</span>
          </div>
        )}

        {/* UX-4: badge de registros offline pendientes de sincronizar */}
        {pendientesCount > 0 && (
          <span
            title={`${pendientesCount} registro${pendientesCount > 1 ? 's' : ''} de asistencia pendiente${pendientesCount > 1 ? 's' : ''} de sincronizar`}
            className="asm-pendientes-badge"
          >
            <i className="ti ti-clock-exclamation" aria-hidden="true" />
            {pendientesCount} pendiente{pendientesCount > 1 ? 's' : ''}
          </span>
        )}

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
      <main className={`asm-main ${subView === "proyeccion" ? "asm-main--proyeccion" : ""}`}>
        <ErrorBoundary>
          <Suspense fallback={<QRFallback />}>
            {subView === "panel" && (
              <AdminQRPanel
                profile={profile}
                onVerReporte={() => setSubView("reporte")}
                onVerProyeccion={() => setSubView("proyeccion")}
                {...qrSession}
              />
            )}
            {subView === "proyeccion" && (
              <QRProyeccion
                activa={qrSession.activa}
                qrUrl={qrSession.qrUrl}
                segundosRestantes={qrSession.segundosRestantes}
                ttlMinutes={qrSession.ttlMinutes}
                meta={qrSession.meta}
                sessionId={qrSession.sessionId}
                isOffline={qrSession.isOffline}
              />
            )}
            {subView === "reporte" && (
              <ReporteAsistencias
                onVolverPanel={() => setSubView("panel")}
              />
            )}
            {subView === "planilla" && (
              <PlanillaQR permisos={permisos} profile={profile} />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>

    </div>
  );
}
