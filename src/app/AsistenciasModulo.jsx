import React, { lazy, Suspense, useState, useEffect, useRef } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import ModalCambiarPassword from "../components/ModalCambiarPassword";
import Toast from "../components/Toast";
import UserMenu from "./UserMenu";
import useTrimestreActivo from "../hooks/useTrimestreActivo";

// P5: imports lazy para separar el módulo QR del bundle principal
const AdminQRPanel      = lazy(() => import("../components/asistencias/AdminQRPanel"));
const QRProyeccion      = lazy(() => import("../components/asistencias/QRProyeccion"));
const ReporteAsistencias = lazy(() => import("../components/asistencias/ReporteAsistencias"));
const PlanillaQR         = lazy(() => import("../components/asistencias/PlanillaQR"));
// ESTAD-1: dashboard de estadísticas y analítica académica -- vista
// hermana de ReporteAsistencias (no anidada), se carga aparte igual que
// ReporteRango.jsx.
const EstadisticasAcademicas = lazy(() => import("../components/asistencias/EstadisticasAcademicas"));

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
 *   toast / hideToast — estado y cierre del toast (ASIST-7: sin esto no
 *                        había nada en este árbol que pintara showToast())
 *   onLogout         — handleLogout de useAuth
 */
export default function AsistenciasModulo({
  profile,
  permisos = {},
  qrSession,
  tieneHorarios,
  onVolverSelector,
  showToast,
  // ASIST-7 (12 ago): faltaban -- este módulo recibía showToast() pero
  // nunca el estado/cierre para poder pintar el aviso (mismo bug
  // encontrado en el módulo Sistema, ver App.jsx). Los toasts se
  // disparaban (appData.toast se actualizaba) pero no había ningún
  // <Toast> en este árbol que lo mostrara.
  toast,
  hideToast,
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

  // UX-39 (auditoría responsive, 15 ago 2026): .asm-tabs se desplaza
  // horizontalmente en móvil (fix UX-34) pero sin ninguna pista visual de
  // que hay más pestañas fuera de vista -- el usuario solo lo descubre
  // por accidente al deslizar. Se agrega un fade en los bordes que solo
  // aparece cuando efectivamente hay contenido oculto hacia ese lado
  // (mismo criterio que los indicadores de carrusel ya usados en otras
  // partes de la app), en vez de un gradiente estático que taparía la
  // primera/última pestaña incluso sin scroll pendiente.
  const tabsRef = useRef(null);
  const [tabsOverflow, setTabsOverflow] = useState({ left: false, right: false });

  const checkTabsOverflow = () => {
    const el = tabsRef.current;
    if (!el) return;
    setTabsOverflow({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  };

  useEffect(() => {
    checkTabsOverflow();
    window.addEventListener("resize", checkTabsOverflow);
    return () => window.removeEventListener("resize", checkTabsOverflow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView]);

  // ASIST-2: hook compartido (mismo que usa Horarios en App.jsx) -- se usa
  // aquí solo para el aviso en Panel QR cuando "hoy" cae fuera del rango
  // de fechas del trimestre activo (caso real: un trimestre se cierra y
  // el siguiente aún no arranca -- ver hoyEnTrimestreActivo). El selector
  // de trimestre para Reporte/Estadísticas/Planilla queda fuera de este
  // shell -- Planilla ya trae el suyo propio (ver PlanillaQR.jsx, ahora
  // también sobre este mismo hook); Reporte/Estadísticas quedan
  // pendientes (ASIST-4) hasta revisar su modelo de filtrado por fecha.
  const { trimestreActivoInfo, hoyEnTrimestreActivo } = useTrimestreActivo();

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

  // PERM-1 fix: filtrar pestañas según permisos individuales.
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
      ? [
          { id: "reporte",       icon: "ti-report",           label: "Reporte" },
          // ESTAD-1: mismo permiso que "Reporte" -- la RLS de
          // asistencias_diarias/horarios (0081) ya lo exige del lado del
          // servidor, no hace falta un permiso nuevo en GRUPOS_PERMISOS.
          { id: "estadisticas",  icon: "ti-chart-histogram",  label: "Estadísticas" },
        ]
      : []),
    // Planilla imprimible (derivada del horario, no de datos QR) — visible
    // a cualquiera con acceso al módulo, igual que en Horarios.
    { id: "planilla", icon: "ti-printer", label: "Planilla" },
  ];

  return (
    <div className="asm-root">

      {/* ASIST-7: ver comentario junto a los props toast/hideToast. */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={hideToast} />
      )}

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
            className="topbar-back-btn"
          >
            <i className="ti ti-arrow-left" aria-hidden="true" /> Módulos
          </button>
        )}

        {/* Pestañas internas.
            UX-39: envueltas en .asm-tabs-wrap para poder posicionar el
            fade de scroll (::before/::after) sin que se desplace junto
            con el contenido -- el wrapper se queda fijo, solo .asm-tabs
            (el hijo) hace scroll. */}
        <div
          className={`asm-tabs-wrap ${tabsOverflow.left ? "asm-tabs-wrap--overflow-left" : ""} ${tabsOverflow.right ? "asm-tabs-wrap--overflow-right" : ""}`}
        >
          <div className="asm-tabs" ref={tabsRef} onScroll={checkTabsOverflow}>
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
                permisos={permisos}
                showToast={showToast}
                onVerReporte={() => setSubView("reporte")}
                onVerProyeccion={() => setSubView("proyeccion")}
                hoyEnTrimestreActivo={hoyEnTrimestreActivo}
                trimestreActivoInfo={trimestreActivoInfo}
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
                permisos={permisos}
                showToast={showToast}
              />
            )}
            {subView === "planilla" && (
              <PlanillaQR permisos={permisos} profile={profile} />
            )}
            {subView === "estadisticas" && (
              <EstadisticasAcademicas permisos={permisos} />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>

    </div>
  );
}
