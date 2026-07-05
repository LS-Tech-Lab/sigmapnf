import React, { useState, useEffect, useCallback, useRef } from "react";
import useAppData from "./hooks/useAppData";
import useHorariosFilters from "./hooks/useHorariosFilters";
import useAuth from "./hooks/useAuth";
import useQRSession from "./hooks/useQRSession";
import useSyncPendientes from "./hooks/useSyncPendientes";
import usePerfilEfectivo from "./hooks/usePerfilEfectivo";
import useModuloActivo from "./hooks/useModuloActivo";
import useAppShell from "./hooks/useAppShell";
import LoginScreen from "./components/LoginScreen";
import ModuleSelector from "./components/ModuleSelector";
import DocenteScan from "./components/asistencias/DocenteScan";
import { getCurrentLapso } from "./utils/lapso";
import { supabase, supabaseConfigError } from "./lib/supabase";

// Context de datos (ARCH-5)
import { AppDataProvider } from "./context/AppDataContext";

// Layouts extraídos (P4)
import HorariosLayout from "./app/HorariosLayout";
import AsistenciasModulo from "./app/AsistenciasModulo";
import CuentaDesactivada from "./app/CuentaDesactivada";
import SinPerfilAsignado from "./app/SinPerfilAsignado";

// Hook que monta los inputs de archivo en document.body directamente,
// sin pasar por el árbol de React. Así nunca se desmontan por re-renders
// condicionales (pantallas de loading, login, etc.) y los refs siempre
// apuntan a un nodo DOM válido.
function useFileInputs({ fileRef, backupRef, onFile, onBackup }) {
  const onFileRef    = useRef(onFile);
  const onBackupRef  = useRef(onBackup);
  useEffect(() => { onFileRef.current   = onFile;   }, [onFile]);
  useEffect(() => { onBackupRef.current = onBackup; }, [onBackup]);

  useEffect(() => {
    const xlsxInput = document.createElement("input");
    xlsxInput.type   = "file";
    xlsxInput.accept = ".xlsx,.xls";
    xlsxInput.style.display = "none";
    xlsxInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      xlsxInput.value = "";
      if (file) onFileRef.current(file);
    });
    document.body.appendChild(xlsxInput);
    fileRef.current = xlsxInput;

    const jsonInput = document.createElement("input");
    jsonInput.type   = "file";
    jsonInput.accept = ".json";
    jsonInput.style.display = "none";
    jsonInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      jsonInput.value = "";
      if (file) onBackupRef.current(file);
    });
    document.body.appendChild(jsonInput);
    backupRef.current = jsonInput;

    return () => {
      document.body.removeChild(xlsxInput);
      document.body.removeChild(jsonInput);
      fileRef.current   = null;
      backupRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo al montar/desmontar App
}

// ── Spinner de carga reutilizable ─────────────────────────────────────────────
function FullScreenSpinner({ label }) {
  return (
    <div className="full-screen-loading">
      <div className="app-spinner-ring" />
      {label && (
        <span className="app-spinner-label">
          {label}
        </span>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function App() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, profile, permisos, loadingProfile, handleLogout, logAudit } = useAuth();

  // ── Perfil y permisos efectivos (online / offline-PIN) ────────────────────
  const {
    efectiveProfile, efectivePermisos,
    offlineProfile, setOfflineProfile,
  } = usePerfilEfectivo({ user, profile, permisos });

  // ── Navegación interna del módulo horarios ────────────────────────────────
  // Declaradas antes de useAppData porque lapso es argumento del hook.
  const [view,        setView]        = useState("resumen");
  const [docenteNav,  setDocenteNav]  = useState(null);
  const [materiaNav,  setMateriaNav]  = useState(null);
  const [horariosTab, setHorariosTab] = useState(null);
  const [lapso,       setLapso]       = useState(() => getCurrentLapso());
  const [modoConsulta,setModoConsulta]= useState(false);

  // ── Datos ─────────────────────────────────────────────────────────────────
  const appData = useAppData(lapso, logAudit, user?.id);

  // ── Sesión QR — vive aquí para no perderse al cambiar sub-vista ──────────
  const qrSession = useQRSession();

  // ── Shell UI (sidebar, modales globales, Supabase caído, email-change) ────
  // showToast se pasa para que useAppShell pueda lanzar el toast de
  // confirmación de cambio de correo una vez que appData esté disponible.
  const shell = useAppShell({ user, showToast: appData.showToast });

  // ── Módulo activo + auto-selección por permisos ───────────────────────────
  const {
    moduloActivo, setModuloActivo,
    tieneHorarios, tieneQR,
  } = useModuloActivo({ efectiveProfile, efectivePermisos });

  // ── Sincronización offline — vacía cola IndexedDB al recuperar red ────────
  // UX-4: pendientesCount se pasa a los layouts para mostrar badge persistente
  const { pendientesCount } = useSyncPendientes(appData.showToast);

  // ── Reset de navegación al cambiar de usuario ─────────────────────────────
  const prevUserIdRef = useRef(undefined);
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (
      prevUserIdRef.current !== undefined &&
      prevUserIdRef.current !== currentId &&
      currentId !== null
    ) {
      setView("resumen");
      setModuloActivo(null);
      setDocenteNav(null);
      setMateriaNav(null);
      shell.setAdminOpen(false);
      shell.setUserMenuOpen(false);
    }
    prevUserIdRef.current = currentId;
  }, [user?.id]);

  // ── Modo consulta histórica ───────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase
        .from("trimestres")
        .select("estado")
        .eq("lapso", lapso)
        .single();
      setModoConsulta(data?.estado === "cerrado" || data?.estado === "archivado");
    };
    check();
  }, [lapso]);

  // Restringir programa para secretarios
  useEffect(() => {
    if (efectivePermisos.puedeVerSoloSuPrograma && efectivePermisos.programaRestringido) {
      appData.setSelectedPrograma(efectivePermisos.programaRestringido);
    }
  }, [efectivePermisos.puedeVerSoloSuPrograma, efectivePermisos.programaRestringido]);

  const horariosFilters = useHorariosFilters(appData.data);

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handleCambiarLapso = useCallback((nuevo) => {
    setLapso(nuevo);
    setView("resumen");
    // A-4: resetear filtros al cambiar lapso — evita que quede una
    // sección/trayecto del lapso anterior que no exista en el nuevo.
    horariosFilters.resetFilters();
  }, [horariosFilters.resetFilters]);

  const handleFileUploadAuditado = async (file) => {
    await appData.handleFileUpload(file);
    await logAudit({
      accion:            "IMPORTAR_EXCEL",
      entidad:           "horarios",
      lapso,
      programa_afectado: appData.selectedPrograma !== "todos" ? appData.selectedPrograma : null,
      resumen:           `Importación Excel: ${file.name}`,
    });
  };

  const handleExportarAuditado = async () => {
    await appData.exportarDatos();
    await logAudit({
      accion:  "EXPORTAR_BACKUP",
      entidad: "horarios",
      lapso,
      resumen: `Exportación de backup. Lapso: ${lapso}`,
    });
  };

  // appData con exportación auditada
  const appDataAuditada = { ...appData, exportarDatos: handleExportarAuditado };

  // ── Refs para inputs de archivo ocultos ──────────────────────────────────
  const fileRef   = useRef(null);
  const backupRef = useRef(null);

  // Inputs de archivo montados en document.body: permanecen vivos sin importar
  // qué pantalla esté renderizando App (loading, login, etc.)
  useFileInputs({
    fileRef,
    backupRef,
    onFile:   handleFileUploadAuditado,
    onBackup: (file) => appDataAuditada.importarDatos(file),
  });

  // ── Guards ────────────────────────────────────────────────────────────────

  // Ruta pública /scan — antes de todos los guards de auth
  if (window.location.pathname === "/scan") {
    return <DocenteScan />;
  }

  // Fix #19: Supabase no responde
  if (shell.supabaseDown) return (
    <div className="app-error-screen">
      <i className="ti ti-wifi-off app-error-icon app-error-icon--danger" aria-hidden="true" />
      <h2 className="app-error-title">
        Servicio no disponible
      </h2>
      <p className="app-error-desc">
        No se pudo conectar con el servidor. Puede ser un problema temporal de red o del servicio.
      </p>
      <button
        onClick={() => { shell.setSupabaseDown(false); window.location.reload(); }}
        className="app-error-btn"
      >
        Reintentar
      </button>
    </div>
  );

  if (supabaseConfigError) return (
    <div className="app-error-screen">
      <i className="ti ti-alert-triangle app-error-icon app-error-icon--warning" aria-hidden="true" />
      <h2 className="app-error-title">
        Configuración incompleta
      </h2>
      <p className="app-error-desc">
        {supabaseConfigError}
      </p>
    </div>
  );

  if (user === undefined) return (
    <div className="full-screen-loading app-loading-text">
      Verificando sesión…
    </div>
  );

  if (!user && !offlineProfile) return <LoginScreen onOfflineLogin={setOfflineProfile} />;

  if (!offlineProfile && loadingProfile) return (
    <FullScreenSpinner label="Cargando perfil…" />
  );

  if (!efectiveProfile)             return <SinPerfilAsignado onLogout={handleLogout} />;
  if (efectiveProfile._desactivado) return <CuentaDesactivada onLogout={handleLogout} />;
  if (efectiveProfile._rolInvalido) return <SinPerfilAsignado onLogout={handleLogout} />;

  // ── Selector de módulo ────────────────────────────────────────────────────
  if (!moduloActivo) {
    // Spinner mientras el useEffect de useModuloActivo procesa la redirección
    if (!(tieneHorarios && tieneQR)) {
      return <FullScreenSpinner label="Cargando…" />;
    }
    return (
      <ModuleSelector
        profile={efectiveProfile}
        onSelectModule={(mod) => setModuloActivo(mod)}
        onLogout={handleLogout}
      />
    );
  }

  // ── Módulo Asistencias QR ─────────────────────────────────────────────────
  if (moduloActivo === "asistencias") {
    return (
      <AsistenciasModulo
        profile={efectiveProfile}
        permisos={efectivePermisos}
        qrSession={qrSession}
        tieneHorarios={tieneHorarios}
        onVolverSelector={() => setModuloActivo(null)}
        showToast={appData.showToast}
        onLogout={handleLogout}
        pendientesCount={pendientesCount}
      />
    );
  }

  // ── Módulo Horarios (default) ─────────────────────────────────────────────
  if (appData.loading && !appData.data.length) return (
    <FullScreenSpinner label="Cargando horarios…" />
  );

  return (
    <>
      <AppDataProvider value={appDataAuditada}>
      <HorariosLayout
        // Navegación
        view={view} setView={setView}
        docenteNav={docenteNav} setDocenteNav={setDocenteNav}
        materiaNav={materiaNav} setMateriaNav={setMateriaNav}
        horariosTab={horariosTab} setHorariosTab={setHorariosTab}
        lapso={lapso}
        modoConsulta={modoConsulta}
        handleCambiarLapso={handleCambiarLapso}
        // Sidebar UI
        hovered={shell.hovered} setHovered={shell.setHovered}
        pinned={shell.pinned} togglePin={shell.togglePin}
        mobileOpen={shell.mobileOpen} setMobileOpen={shell.setMobileOpen}
        adminOpen={shell.adminOpen} setAdminOpen={shell.setAdminOpen}
        userMenuOpen={shell.userMenuOpen} setUserMenuOpen={shell.setUserMenuOpen}
        cambiarPwdOpen={shell.cambiarPwdOpen} setCambiarPwdOpen={shell.setCambiarPwdOpen}
        fileRef={fileRef} backupRef={backupRef}
        // Datos y auth (appData ahora via AppDataContext — ARCH-5)
        horariosFilters={horariosFilters}
        permisos={efectivePermisos}
        profile={efectiveProfile}
        user={user}
        handleLogout={handleLogout}
        handleFileUploadAuditado={handleFileUploadAuditado}
        // Módulos
        tieneHorarios={tieneHorarios}
        tieneQR={tieneQR}
        onCambiarModulo={() => setModuloActivo(null)}
        pendientesCount={pendientesCount}
      />
      </AppDataProvider>
    </>
  );
}
