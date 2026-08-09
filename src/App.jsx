import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
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
import SedeSelector from "./components/SedeSelector";
import DocenteScan from "./components/asistencias/DocenteScan";
import { getCurrentLapso } from "./utils/lapso";
import { supabase, supabaseConfigError } from "./lib/supabase";
import useSedes from "./hooks/useSedes";
import useSedeActiva from "./hooks/useSedeActiva";

// Context de datos (ARCH-8)
import { AppDataProvider } from "./context/AppDataContext";
// Context de sede activa (SEDE-2)
import { SedeProvider } from "./context/SedeContext";

// Layouts extraídos (P4)
import HorariosLayout from "./app/HorariosLayout";
import CuentaDesactivada from "./app/CuentaDesactivada";
import SinPerfilAsignado from "./app/SinPerfilAsignado";

// Fix ARCH-24: `AsistenciasModulo`/`AdminModulo` se importaban de forma
// estática igual que `HorariosLayout`, así que los 3 módulos raíz (más
// todas sus dependencias exclusivas: `AdminMenu.jsx`, etc.) terminaban en
// el chunk principal aunque una sesión determinada solo visite uno de
// los tres. Nota de verificación: el hallazgo original decía que
// `AdminModulo` era "el único" importado de forma estática, dando a
// entender que los otros dos ya eran `lazy()` — falso positivo parcial
// (confirmado por `grep` de `React.lazy`/`Suspense` en `App.jsx`: ninguno
// de los 3 lo era). `HorariosLayout` se deja estático a propósito, mismo
// criterio que `ResumenView` en `ARCH-10` (es el módulo por defecto:
// auto-seleccionado cuando el perfil solo tiene acceso a Horarios, y el
// destino más común tras el login en el resto de los casos).
const AsistenciasModulo = lazy(() => import("./app/AsistenciasModulo"));
const AdminModulo       = lazy(() => import("./app/AdminModulo"));


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
    xlsxInput.className = "hidden-file-input";
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
    jsonInput.className = "hidden-file-input";
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

  // ── Sede activa (SEDE-2) ────────────────────────────────────────────────
  // Fija para la mayoría de los roles (efectivePermisos.sedeAsignada);
  // seleccionable solo para quienes tienen puedeVerTodasLasSedes.
  const { sedes, loadingSedes, refetchSedes } = useSedes(user?.id);
  const {
    sedeActiva, setSedeActiva, requiereSeleccion, puedeElegir,
  } = useSedeActiva({ userId: user?.id, efectivePermisos });

  // ── Navegación interna del módulo horarios ────────────────────────────────
  // Declaradas antes de useAppData porque lapso es argumento del hook.
  const [view,        setView]        = useState("resumen");
  const [docenteNav,  setDocenteNav]  = useState(null);
  const [materiaNav,  setMateriaNav]  = useState(null);
  const [horariosTab, setHorariosTab] = useState(null);
  const [lapso,       setLapso]       = useState(() => getCurrentLapso());
  const [modoConsulta,setModoConsulta]= useState(false);

  // ── Datos ─────────────────────────────────────────────────────────────────
  const appData = useAppData(lapso, logAudit, user?.id, sedeActiva);
  const { setSelectedPrograma } = appData;

  // ── Sesión QR — vive aquí para no perderse al cambiar sub-vista ──────────
  const qrSession = useQRSession();

  // ── Shell UI (sidebar, modales globales, Supabase caído, email-change) ────
  // showToast se pasa para que useAppShell pueda lanzar el toast de
  // confirmación de cambio de correo una vez que appData esté disponible.
  const shell = useAppShell({ user, showToast: appData.showToast });
  // Setters de shell desestructurados: `shell` es un objeto nuevo en cada
  // render (useAppShell no lo memoiza), pero los setters de useState que
  // contiene sí son estables — se usan por nombre propio en vez de
  // `shell.setX` para poder listarlos en deps de efectos sin causar
  // reruns de más.
  const { setAdminOpen, setUserMenuOpen } = shell;

  // ── Módulo activo + auto-selección por permisos ───────────────────────────
  const {
    moduloActivo, setModuloActivo,
    tieneHorarios, tieneQR, tieneAdmin,
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
      setAdminOpen(false);
      setUserMenuOpen(false);
    }
    prevUserIdRef.current = currentId;
  }, [user?.id, setModuloActivo, setAdminOpen, setUserMenuOpen]);

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

  // Restringir programa para secretarios — PROG-3 (fase 2): con más de un
  // programa asignado, solo se fuerza la selección cuando la actual no es
  // (o dejó de ser) una de las permitidas, para no pisarle al usuario un
  // cambio manual entre sus propios programas en cada render. Mismo
  // criterio de "clamp" que el resto de la serie SEDE-N usa para sede.
  useEffect(() => {
    if (!efectivePermisos.puedeVerSoloSuPrograma) return;
    const misProgramas = efectivePermisos.programasRestringidos;
    if (misProgramas.length === 0) return;
    if (!misProgramas.includes(appData.selectedPrograma)) {
      setSelectedPrograma(misProgramas[0]);
    }
  }, [efectivePermisos.puedeVerSoloSuPrograma, efectivePermisos.programasRestringidos, appData.selectedPrograma, setSelectedPrograma]);

  const horariosFilters = useHorariosFilters(appData.data);
  const { resetFilters } = horariosFilters;

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handleCambiarLapso = useCallback((nuevo) => {
    setLapso(nuevo);
    setView("resumen");
    // ARCH-4: resetear filtros al cambiar lapso — evita que quede una
    // sección/trayecto del lapso anterior que no exista en el nuevo.
    resetFilters();
  }, [resetFilters]);

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

  // ── Selector de sede (SEDE-2) ────────────────────────────────────────────
  // Va después de validar el perfil y antes del selector de módulo, para
  // que todo lo que sigue (módulos, datos, RLS en SEDE-3) ya tenga una
  // sede resuelta. Perfiles con sede fija nunca ven esta pantalla —
  // requiereSeleccion solo es true para puedeVerTodasLasSedes sin sede
  // activa todavía elegida en esta sesión (useSedeActiva.js).
  if (requiereSeleccion) {
    return (
      <SedeSelector
        profile={efectiveProfile}
        sedes={sedes}
        loadingSedes={loadingSedes}
        onSelectSede={setSedeActiva}
        onLogout={handleLogout}
      />
    );
  }

  // ── Selector de módulo ────────────────────────────────────────────────────
  if (!moduloActivo) {
    // Spinner mientras el useEffect de useModuloActivo procesa la
    // auto-selección (caso de un solo módulo disponible).
    const modulosCount = [tieneHorarios, tieneQR, tieneAdmin].filter(Boolean).length;
    if (modulosCount < 2) {
      return <FullScreenSpinner label="Cargando…" />;
    }
    return (
      <ModuleSelector
        profile={efectiveProfile}
        tieneHorarios={tieneHorarios}
        tieneQR={tieneQR}
        tieneAdmin={tieneAdmin}
        onSelectModule={(mod) => setModuloActivo(mod)}
        onLogout={handleLogout}
        // SEDE-2/6: visible solo para quienes pueden elegir sede
        // (admin/coordinador). UX-31: antes onCambiarSede reseteaba
        // sedeActiva a null para forzar la pantalla completa
        // <SedeSelector/> en el siguiente render; ahora el propio
        // ModuleSelector despliega un dropdown in-place con la lista de
        // sedes y llama a onSelectSede(id) directo al elegir una.
        puedeElegirSede={puedeElegir}
        sedes={sedes}
        sedeActiva={sedeActiva}
        onSelectSede={setSedeActiva}
      />
    );
  }

  // SEDE-2: valor del contexto de sede para los 3 módulos de acá en
  // adelante. Objeto simple (no useMemo) porque sedes/sedeActiva/
  // setSedeActiva ya son estables entre renders salvo cuando cambian de
  // verdad (useSedes/useSedeActiva no generan referencias nuevas gratis).
  // SEDE-17: refetchSedes se suma para que GestionSedes.jsx (Sistema →
  // Sedes) pueda refrescar el catálogo en todo el árbol tras un cambio.
  const sedeContextValue = { sedeActiva, sedes, setSedeActiva, refetchSedes };

  // ── Módulo Asistencias QR ─────────────────────────────────────────────────
  if (moduloActivo === "asistencias") {
    return (
      <SedeProvider value={sedeContextValue}>
        <Suspense fallback={<FullScreenSpinner label="Cargando módulo…" />}>
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
        </Suspense>
      </SedeProvider>
    );
  }

  // ── Módulo Sistema (ADMIN-3, id interno "admin") ──────────────────────────
  if (moduloActivo === "admin") {
    return (
      <SedeProvider value={sedeContextValue}>
        <AppDataProvider value={appDataAuditada}>
          <Suspense fallback={<FullScreenSpinner label="Cargando módulo…" />}>
            <AdminModulo
              profile={efectiveProfile}
              permisos={efectivePermisos}
              user={user}
              lapso={lapso}
              onCambiarLapso={handleCambiarLapso}
              tieneHorarios={tieneHorarios}
              tieneQR={tieneQR}
              onVolverSelector={() => setModuloActivo(null)}
              onLogout={handleLogout}
            />
          </Suspense>
        </AppDataProvider>
      </SedeProvider>
    );
  }

  // ── Módulo Horarios (default) ─────────────────────────────────────────────
  if (appData.loading && !appData.data.length) return (
    <FullScreenSpinner label="Cargando horarios…" />
  );

  return (
    <>
      <SedeProvider value={sedeContextValue}>
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
        // Datos y auth (appData ahora via AppDataContext — ARCH-8)
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
      </SedeProvider>
    </>
  );
}
