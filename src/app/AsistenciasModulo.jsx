import React, { lazy, Suspense, useState, useEffect, useRef } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import ModalCambiarPassword from "../components/ModalCambiarPassword";
import UserMenu from "./UserMenu";

// P5: imports lazy para separar el módulo QR del bundle principal
const AdminQRPanel      = lazy(() => import("../components/asistencias/AdminQRPanel"));
const QRProyeccion      = lazy(() => import("../components/asistencias/QRProyeccion"));
const ReporteAsistencias = lazy(() => import("../components/asistencias/ReporteAsistencias"));

const QRFallback = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
    height: 240, color: "var(--color-text-tertiary)", fontSize: 13, gap: 8 }}>
    <i className="ti ti-loader-2" style={{ fontSize: 20, animation: "spin 1s linear infinite" }} aria-hidden="true" />
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
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)", fontFamily: "var(--font-sans)" }}>

      {cambiarPwdOpen && (
        <ModalCambiarPassword
          onCerrar={() => setCambiarPwdOpen(false)}
          showToast={showToast}
        />
      )}

      {/* Topbar */}
      <header style={{
        background: "#fff",
        borderBottom: "1px solid var(--color-border-tertiary)",
        display: "flex", alignItems: "center", gap: 12,
        padding: "0 20px", height: 52, flexShrink: 0,
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        transition: "transform 0.35s ease",
        transform: headerVisible ? "translateY(0)" : "translateY(-100%)",
      }}>

        {/* Volver al selector — solo si también tiene acceso a horarios */}
        {tieneHorarios && (
          <button
            onClick={() => { qrSession.cerrarSesion(); onVolverSelector(); }}
            style={{
              background: "none", border: "1px solid var(--color-border-tertiary)",
              borderRadius: 7, padding: "5px 12px", cursor: "pointer",
              fontSize: 13, fontWeight: 600, color: "var(--navy-700)",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <i className="ti ti-arrow-left" aria-hidden="true" /> Módulos
          </button>
        )}

        {/* Pestañas internas */}
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSubView(tab.id)}
              style={{
                padding: "5px 14px", borderRadius: 7, border: "none",
                background: subView === tab.id ? "var(--color-background-info)" : "transparent",
                color:      subView === tab.id ? "var(--brand-600)" : "var(--color-text-tertiary)",
                fontWeight: subView === tab.id ? 700 : 500,
                fontSize: 13, cursor: "pointer", transition: "all 0.12s",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <i className={`ti ${tab.icon}`} aria-hidden="true" /> {tab.label}
            </button>
          ))}
        </div>

        {/* Indicador de sesión QR activa */}
        {qrSession.activa && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "3px 10px", background: "#F0FDF4",
            border: "1px solid #86EFAC", borderRadius: 20,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%", background: "#22C55E",
              display: "inline-block", animation: "pulse 1.4s ease-in-out infinite",
            }} />
            <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#15803D" }}>Sesión activa</span>
          </div>
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
      <main style={{ paddingTop: subView === "proyeccion" ? 0 : 52 }}>
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
          </Suspense>
        </ErrorBoundary>
      </main>

    </div>
  );
}
