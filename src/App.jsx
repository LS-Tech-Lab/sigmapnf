import React, { useState, useEffect, useCallback, useRef } from "react";
import useAppData from "./hooks/useAppData";
import useHorariosFilters from "./hooks/useHorariosFilters";
import useAuth from "./hooks/useAuth";
import useQRSession from "./hooks/useQRSession";
import LoginScreen from "./components/LoginScreen";
import ModuleSelector from "./components/ModuleSelector";
import DocenteScan from "./components/asistencias/DocenteScan";
import { getCurrentLapso } from "./utils/lapso";
import { supabase, supabaseConfigError } from "./lib/supabase";

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

// ── Componente principal ──────────────────────────────────────────────────────
export default function App() {
  // ── Navegación ────────────────────────────────────────────────────────────
  const [view,        setView]        = useState("resumen");
  const [docenteNav,  setDocenteNav]  = useState(null);
  const [materiaNav,  setMateriaNav]  = useState(null);
  const [horariosTab, setHorariosTab] = useState(null);
  const [lapso,       setLapso]       = useState(() => getCurrentLapso());
  const [modoConsulta,setModoConsulta]= useState(false);

  // ── Módulo activo ─────────────────────────────────────────────────────────
  // null = selector, "horarios" | "asistencias"
  // Para roles sin acceso a ambos, el useEffect de abajo redirige directo.
  const [moduloActivo, setModuloActivo] = useState(null);

  // ── Sesión QR — vive aquí para no perderse al cambiar sub-vista ──────────
  const qrSession = useQRSession();

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const [hovered,    setHovered]    = useState(false);
  const [pinned,     setPinned]     = useState(() => localStorage.getItem("sb_pinned") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminOpen,  setAdminOpen]  = useState(false);

  // ── Modales ───────────────────────────────────────────────────────────────
  const [userMenuOpen,   setUserMenuOpen]   = useState(false);
  const [cambiarPwdOpen, setCambiarPwdOpen] = useState(false);

  // ── Refs para inputs de archivo ocultos ──────────────────────────────────
  const fileRef   = useRef(null);
  const backupRef = useRef(null);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, profile, permisos, loadingProfile, handleLogin, handleLogout, logAudit } = useAuth();

  // Fix #19: Supabase caído / anon key expirada
  const [supabaseDown, setSupabaseDown] = useState(false);
  useEffect(() => {
    if (user !== undefined) return;
    const id = setTimeout(() => {
      if (user === undefined) setSupabaseDown(true);
    }, 8000);
    return () => clearTimeout(id);
  }, [user]);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem("sb_pinned", next ? "1" : "0");
  };

  // ── Reset de navegación al cambiar de usuario ─────────────────────────────
  const prevUserIdRef = useRef(undefined);
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== currentId && currentId !== null) {
      setView("resumen");
      setModuloActivo(null);
      setDocenteNav(null);
      setMateriaNav(null);
      setAdminOpen(false);
      setUserMenuOpen(false);
    }
    prevUserIdRef.current = currentId;
  }, [user?.id]);

  // ── Modo consulta histórica ───────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.from("trimestres").select("estado").eq("lapso", lapso).single();
      setModoConsulta(data?.estado === "cerrado" || data?.estado === "archivado");
    };
    check();
  }, [lapso]);

  // ── Datos ─────────────────────────────────────────────────────────────────
  const appData = useAppData(lapso, logAudit, user?.id);

  // Restringir programa para secretarios
  useEffect(() => {
    if (permisos.puedeVerSoloSuPrograma && permisos.programaRestringido) {
      appData.setSelectedPrograma(permisos.programaRestringido);
    }
  }, [permisos.puedeVerSoloSuPrograma, permisos.programaRestringido]);

  // ── Auto-selección de módulo según permisos ───────────────────────────────
  // DEBE estar aquí, antes de cualquier return condicional (Regla de Hooks).
  useEffect(() => {
    if (!profile || moduloActivo) return;
    const tieneHorarios = permisos.puedeVerTodo || permisos.puedeVerSoloSuPrograma;
    const tieneQR = permisos.puedeGestionarQR || permisos.puedeVerReporteAsistencias;
    if (tieneHorarios && tieneQR) return; // ambos: queda en selector
    if (tieneQR) setModuloActivo("asistencias");
    else setModuloActivo("horarios");
  }, [profile, moduloActivo, permisos.puedeVerTodo, permisos.puedeVerSoloSuPrograma,
      permisos.puedeGestionarQR, permisos.puedeVerReporteAsistencias]);

  const horariosFilters = useHorariosFilters(appData.data);

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handleCambiarLapso = useCallback((nuevo) => {
    setLapso(nuevo);
    setView("resumen");
  }, []);

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
  if (supabaseDown) return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "var(--color-text-primary)", color: "var(--color-border-tertiary)",
      gap: 16, padding: 32, textAlign: "center", fontFamily: "var(--font-sans)",
    }}>
      <i className="ti ti-wifi-off" style={{ fontSize: 44, color: "#F87171" }} aria-hidden="true" />
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--color-background-tertiary)" }}>
        Servicio no disponible
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary)", maxWidth: 460, lineHeight: 1.6 }}>
        No se pudo conectar con el servidor. Puede ser un problema temporal de red o del servicio.
      </p>
      <button
        onClick={() => { setSupabaseDown(false); window.location.reload(); }}
        style={{
          marginTop: 8, padding: "9px 22px", background: "var(--brand-500)", color: "#fff",
          border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer",
        }}
      >
        Reintentar
      </button>
    </div>
  );

  if (supabaseConfigError) return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "var(--color-text-primary)", color: "var(--color-border-tertiary)",
      gap: 16, padding: 32, textAlign: "center", fontFamily: "var(--font-sans)",
    }}>
      <i className="ti ti-alert-triangle" style={{ fontSize: 44, color: "#FBBF24" }} aria-hidden="true" />
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--color-background-tertiary)" }}>
        Configuración incompleta
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary)", maxWidth: 460, lineHeight: 1.6 }}>
        {supabaseConfigError}
      </p>
    </div>
  );

  if (user === undefined) return (
    <div className="full-screen-loading" style={{ color: "var(--color-text-tertiary)", fontSize: 15 }}>
      Verificando sesión…
    </div>
  );

  if (!user) return <LoginScreen />;

  if (loadingProfile) return (
    <div className="full-screen-loading">
      <div style={{
        width: 32, height: 32, border: "3px solid #1E3A5F", borderTop: "3px solid var(--color-accent)",
        borderRadius: "50%", animation: "spin 0.8s linear infinite",
      }} />
      <span style={{ color: "var(--color-text-tertiary)", fontSize: 14 }}>Cargando perfil…</span>
    </div>
  );

  if (!profile)              return <SinPerfilAsignado onLogout={handleLogout} />;
  if (profile._desactivado)  return <CuentaDesactivada onLogout={handleLogout} />;
  if (profile._rolInvalido)  return <SinPerfilAsignado onLogout={handleLogout} />;

  // ── Selector de módulo ────────────────────────────────────────────────────
  const tieneHorarios = permisos.puedeVerTodo || permisos.puedeVerSoloSuPrograma;
  const tieneQR       = permisos.puedeGestionarQR || permisos.puedeVerReporteAsistencias;

  if (!moduloActivo) {
    // Spinner mientras el useEffect procesa la redirección automática
    if (!(tieneHorarios && tieneQR)) {
      return (
        <div className="full-screen-loading">
          <div style={{
            width: 32, height: 32, border: "3px solid #1E3A5F", borderTop: "3px solid var(--color-accent)",
            borderRadius: "50%", animation: "spin 0.8s linear infinite",
          }} />
          <span style={{ color: "var(--color-text-tertiary)", fontSize: 14 }}>Cargando…</span>
        </div>
      );
    }
    return (
      <ModuleSelector
        profile={profile}
        onSelectModule={(mod) => setModuloActivo(mod)}
        onLogout={handleLogout}
      />
    );
  }

  // ── Módulo Asistencias QR ─────────────────────────────────────────────────
  if (moduloActivo === "asistencias") {
    return (
      <AsistenciasModulo
        profile={profile}
        qrSession={qrSession}
        tieneHorarios={tieneHorarios}
        onVolverSelector={() => setModuloActivo(null)}
        showToast={appData.showToast}
        onLogout={handleLogout}
      />
    );
  }

  // ── Módulo Horarios (default) ─────────────────────────────────────────────
  if (appData.loading && !appData.data.length) return (
    <div className="full-screen-loading">
      <div style={{
        width: 36, height: 36, border: "3px solid #1E3A5F", borderTop: "3px solid var(--color-accent)",
        borderRadius: "50%", animation: "spin 0.8s linear infinite",
      }} />
      <span style={{ color: "var(--color-text-tertiary)", fontSize: 14 }}>Cargando horarios…</span>
    </div>
  );

  return (
    <>
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
        hovered={hovered} setHovered={setHovered}
        pinned={pinned} togglePin={togglePin}
        mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}
        adminOpen={adminOpen} setAdminOpen={setAdminOpen}
        userMenuOpen={userMenuOpen} setUserMenuOpen={setUserMenuOpen}
        cambiarPwdOpen={cambiarPwdOpen} setCambiarPwdOpen={setCambiarPwdOpen}
        fileRef={fileRef} backupRef={backupRef}
        // Datos y auth
        appData={appDataAuditada}
        horariosFilters={horariosFilters}
        permisos={permisos}
        profile={profile}
        user={user}
        handleLogout={handleLogout}
        handleFileUploadAuditado={handleFileUploadAuditado}
        // Módulos
        tieneHorarios={tieneHorarios}
        tieneQR={tieneQR}
        onCambiarModulo={() => setModuloActivo(null)}
      />
    </>
  );
}
