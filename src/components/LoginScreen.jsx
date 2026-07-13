import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  listarUsuariosOffline, verificarPinOffline, tienePinOffline,
  // Fix O-8: lockout del PIN en IDB — resiste tabs privadas
  leerLockoutIDB, registrarIntentoPinFallido, limpiarLockoutIDB,
  // SEC-5: lockout del login normal en IDB
  leerLoginLockoutIDB, registrarIntentoLoginFallido, limpiarLoginLockoutIDB,
} from "../utils/pinOffline";
import ModalActivarPIN from "./login/ModalActivarPIN";
import LoginOfflinePinPanel from "./login/LoginOfflinePinPanel";
import LoginFormNormal from "./login/LoginFormNormal";
import "./LoginScreen.css";

// SEC-5 (Junio 2026): el lockout del login normal fue migrado de localStorage a IDB
// usando leerLoginLockoutIDB / registrarIntentoLoginFallido / limpiarLoginLockoutIDB
// (pinOffline.js). Resiste tabs privadas y limpieza manual de DevTools.
// La protección real contra brute-force la provee Supabase Auth (rate limiting por IP).
const MAX_ATTEMPTS    = 5;

function getAuthErrorMessage(error) {
  const msg    = (error?.message || "").toLowerCase();
  const status = error?.status;
  if (msg.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (msg.includes("email not confirmed"))        return "Correo no confirmado. Revisa tu bandeja de entrada para confirmar la cuenta.";
  if (msg.includes("user not found"))             return "No existe una cuenta con ese correo.";
  if (msg.includes("too many requests") || status === 429) return "Demasiados intentos. Espera unos minutos antes de volver a intentarlo.";
  if (msg.includes("network") || msg.includes("fetch")) return "Error de conexión. Verifica tu internet e intenta de nuevo.";
  return "No se pudo iniciar sesión. Intenta de nuevo.";
}

// ── PIN lockout helpers — Fix O-8: reemplazados por IDB (ver pinOffline.js) ───
// Los helpers readPinLockout / persistPinLockout etc. han sido eliminados.
// El estado de bloqueo ahora se lee/escribe en IDB mediante:
//   leerLockoutIDB(userId), registrarIntentoPinFallido(userId), limpiarLockoutIDB(userId)

// Fix ARCH-10 (auditoría 9 de julio): ModalActivarPIN, el panel de PIN
// offline y el formulario normal se extrajeron a src/components/login/ —
// mismo patrón que ARCH-8 (HorariosSidebar/HorariosTopbar). Este archivo
// mantiene TODO el estado, los efectos y los handlers (son los que
// realmente concentraban la complejidad, no el JSX); los tres
// subcomponentes son puramente presentacionales y reciben todo por props.

// ── Componente principal ──────────────────────────────────────────────────────
export default function LoginScreen({ onOfflineLogin }) {
  // ── Estado form normal ────────────────────────────────────────────────────
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  // SEC-5: inicializar a 0 — IDB es async, se carga en useEffect
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil,    setLockedUntil]    = useState(null);
  const [remaining,   setRemaining]   = useState(0);
  const timerRef = useRef(null);

  // ── Estado offline ────────────────────────────────────────────────────────
  const [isOffline,       setIsOffline]       = useState(!navigator.onLine);
  const [usuariosOffline, setUsuariosOffline] = useState([]);  // cargados de IDB
  const [loadingOffline,  setLoadingOffline]  = useState(true);
  const [usuarioSelec,    setUsuarioSelec]    = useState(null); // objeto usuario offline
  const [pin,             setPin]             = useState("");
  const [pinError,        setPinError]        = useState(null);
  const [pinLoading,      setPinLoading]      = useState(false);
  // Fix O-8: el lockout ya no se inicializa desde localStorage — se carga
  // desde IDB cuando el usuario selecciona su perfil (ver useEffect abajo).
  const [pinLockedUntil,  setPinLockedUntil]  = useState(null);
  const [pinRemaining,    setPinRemaining]    = useState(0);
  // Nota (ARCH-16, 12 de julio): `pinAttempts` se actualiza en 4 lugares del
  // flujo de lockout de PIN (O-8) pero su valor nunca se lee en ningún lado
  // (no se muestra "intentos restantes" en la UI). No se retiran los
  // `setPinAttempts()` en este fix — tocar 4 puntos de lógica de lockout ya
  // auditada (SEC-5/O-8) está fuera del alcance de agregar linting. Si se
  // decide mostrar el contador al usuario, ya está siendo trackeado.
  // eslint-disable-next-line no-unused-vars
  const [pinAttempts,     setPinAttempts]     = useState(0);
  const pinTimerRef = useRef(null);

  // ── Modal activar PIN ─────────────────────────────────────────────────────
  // Se muestra tras un login exitoso si el usuario no tiene PIN guardado.
  const [pendingPinUser,    setPendingPinUser]    = useState(null); // { user, profile }
  const [mostrarModalPIN,   setMostrarModalPIN]   = useState(false);

  // SEC-5: cargar estado de lockout del login normal desde IDB cuando el email cambia.
  // Permite mostrar el bloqueo restante si el usuario ya agotó intentos anteriores.
  useEffect(() => {
    if (!email) return;
    leerLoginLockoutIDB(email).then(({ intentos, bloqueadoHasta }) => {
      setFailedAttempts(intentos);
      setLockedUntil(bloqueadoHasta && bloqueadoHasta > Date.now() ? bloqueadoHasta : null);
    });
  }, [email]);

  // ── Lockout normal ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemaining(s);
      if (s <= 0) {
        setLockedUntil(null); setFailedAttempts(0);
        limpiarLoginLockoutIDB(email);
        clearInterval(timerRef.current);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => clearInterval(timerRef.current);
  }, [lockedUntil]);

  // ── Lockout PIN ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pinLockedUntil) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((pinLockedUntil - Date.now()) / 1000));
      setPinRemaining(s);
      if (s <= 0) {
        // Fix O-8: limpiar IDB cuando vence el bloqueo
        if (usuarioSelec?.userId) limpiarLockoutIDB(usuarioSelec.userId);
        setPinLockedUntil(null); setPinAttempts(0);
        clearInterval(pinTimerRef.current);
      }
    };
    tick();
    pinTimerRef.current = setInterval(tick, 500);
    return () => clearInterval(pinTimerRef.current);
  }, [pinLockedUntil, usuarioSelec]);

  // Fix O-8: cargar estado de lockout desde IDB al seleccionar un usuario offline
  useEffect(() => {
    if (!usuarioSelec?.userId) return;
    leerLockoutIDB(usuarioSelec.userId).then(({ intentos, bloqueadoHasta }) => {
      setPinAttempts(intentos);
      setPinLockedUntil(bloqueadoHasta);
      setPinError(null);
      setPin("");
    });
  }, [usuarioSelec]);

  // ── Detectar online/offline ───────────────────────────────────────────────
  useEffect(() => {
    const goOnline  = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  // ── Cargar usuarios offline de IDB ────────────────────────────────────────
  useEffect(() => {
    listarUsuariosOffline().then(lista => {
      setUsuariosOffline(lista);
      if (lista.length === 1) setUsuarioSelec(lista[0]); // pre-seleccionar si solo hay uno
      setLoadingOffline(false);
    });
  }, []);

  const isLocked    = !!lockedUntil && remaining > 0;
  const isPinLocked = !!pinLockedUntil && pinRemaining > 0;

  // ── Login normal (Supabase) ───────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setLoading(true);
    setError(null);

    // Fix SEC-6 (auditoría julio 2026): respaldo server-side del lockout de
    // SEC-5. El de IDB se salta borrando el navegador o cambiando de
    // dispositivo — este no, porque cuenta contra login_attempts (0031),
    // que ya se llenaba pero nadie leía para bloquear nada. Se consulta
    // ANTES de llamar a signInWithPassword para no gastar ese intento
    // contra Supabase Auth si el servidor ya sabe que está bloqueado.
    try {
      const { data: bloqueo } = await supabase.rpc("verificar_bloqueo_login", { p_email: email });
      if (bloqueo?.bloqueado) {
        const hasta = new Date(bloqueo.desbloquea_en).getTime();
        setFailedAttempts(bloqueo.intentos);
        setLockedUntil(hasta);
        setError("Demasiados intentos fallidos. Espera antes de volver a intentar.");
        setLoading(false);
        return;
      }
    } catch {
      // Si la RPC falla (red, etc.) no bloqueamos el login por eso —
      // el lockout de IDB (SEC-5) sigue funcionando como respaldo mínimo.
    }

    // Capturamos el user y profile del callback de Auth para el modal PIN.
    // Nota (ARCH-16): sin valor inicial — solo se leen dentro del bloque
    // `else` de abajo, que siempre los asigna antes de cualquier lectura.
    let loginUser;
    let loginProfile;

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(getAuthErrorMessage(authError));
      // SEC-5: registrar intento fallido en IDB
      const { intentos, bloqueadoHasta, bloqueadoAhora } =
        await registrarIntentoLoginFallido(email);
      setFailedAttempts(intentos);
      if (bloqueadoAhora) setLockedUntil(bloqueadoHasta);
      try {
        await supabase.rpc("log_login_fallido", {
          p_email: email, p_user_agent: navigator.userAgent, p_motivo: authError.message,
        });
      } catch { /* no-op */ }
    } else {
      // SEC-5: limpiar lockout en IDB tras login exitoso
      setFailedAttempts(0); setLockedUntil(null);
      limpiarLoginLockoutIDB(email);
      loginUser = data.user;

      // Cargar perfil para el modal PIN
      try {
        const { data: prof } = await supabase
          .from("user_profiles")
          .select("*, rol_info:roles!user_profiles_rol_fk(nombre, label, emoji, color, restringe_programa, permisos)")
          .eq("id", loginUser.id)
          .single();
        loginProfile = prof;
      } catch { /* no-op: no bloquear login por esto */ }

      // Mostrar modal PIN solo si el usuario no tiene uno ya guardado
      if (loginUser && loginProfile) {
        const yaTiene = await tienePinOffline(loginUser.id);
        if (!yaTiene) {
          setPendingPinUser({ user: loginUser, profile: loginProfile });
          setMostrarModalPIN(true);
        }
      }
      // useAuth detecta el cambio de sesión via onAuthStateChange — no hacemos nada más aquí
    }
    setLoading(false);
  };

  // ── Login offline (PIN) ───────────────────────────────────────────────────
  const handlePinLogin = async () => {
    if (isPinLocked || !usuarioSelec || pin.length < 4) return;
    setPinLoading(true);
    setPinError(null);

    const perfil = await verificarPinOffline(usuarioSelec.userId, pin);

    if (!perfil) {
      // Fix O-8: registrar intento en IDB — resiste tabs privadas
      const { intentos, bloqueadoHasta, bloqueadoAhora } =
        await registrarIntentoPinFallido(usuarioSelec.userId);

      setPinAttempts(intentos);
      if (bloqueadoAhora) {
        setPinLockedUntil(bloqueadoHasta);
        setPinError(`PIN incorrecto ${intentos} veces. Bloqueado por 5 minutos.`);
      } else {
        setPinError(`PIN incorrecto. Intento ${intentos} de 5.`);
      }
      setPinLoading(false);
      return;
    }

    // PIN correcto — limpiar lockout en IDB y llamar callback
    await limpiarLockoutIDB(usuarioSelec.userId);
    setPinAttempts(0);
    setPinLockedUntil(null);
    onOfflineLogin(perfil);
    setPinLoading(false);
  };

  // A3 (auditoría 2026-06-30): los estilos de inputs/labels/botones se
  // resolvieron a clases CSS (LoginScreen.css + utilidades de index.css).
  // El estado disabled ya no requiere objetos de estilo condicionales en JS
  // — se resuelve con el selector :disabled directamente en el CSS.

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {mostrarModalPIN && pendingPinUser && (
        <ModalActivarPIN
          user={pendingPinUser.user}
          profile={pendingPinUser.profile}
          onDone={() => { setMostrarModalPIN(false); setPendingPinUser(null); }}
        />
      )}

      <div className="login-page">
        <div className="login-card">
          {/* Cabecera */}
          <div className="login-header">
            <img src="/logo-coordinacion.png" alt="Logo Coordinación" className="login-logo" />
            <h1 className="login-title">
              SIGMA
            </h1>
            <p className="login-tagline">
              Sistema Integrado de Gestión y Módulos Académicos
            </p>
            <p className="login-status">
              {isOffline ? "Sin conexión — acceso offline" : "Inicia sesión para continuar"}
            </p>
          </div>

          {/* Banner offline */}
          {isOffline && (
            <div className="login-offline-banner">
              <i className="ti ti-wifi-off icon-alert" aria-hidden="true" />
              <span>Sin red. {usuariosOffline.length > 0 ? "Usa tu PIN para acceder." : "No hay usuarios con PIN guardado en este dispositivo."}</span>
            </div>
          )}

          {/* ── MODO OFFLINE: selector + PIN ──────────────────────────── */}
          {isOffline && !loadingOffline && usuariosOffline.length > 0 ? (
            <LoginOfflinePinPanel
              usuariosOffline={usuariosOffline}
              usuarioSelec={usuarioSelec} setUsuarioSelec={setUsuarioSelec}
              pin={pin} setPin={setPin}
              pinError={pinError} setPinError={setPinError}
              isPinLocked={isPinLocked} pinRemaining={pinRemaining}
              pinLoading={pinLoading}
              handlePinLogin={handlePinLogin}
            />
          ) : isOffline && !loadingOffline ? (
            // Sin red y sin usuarios offline guardados
            <div className="login-offline-empty">
              <i className="ti ti-database-off login-offline-empty__icon" aria-hidden="true" />
              Para usar el acceso offline, inicia sesión con internet al menos una vez y activa tu PIN desde la pantalla de login.
            </div>
          ) : !isOffline ? (
            /* ── MODO NORMAL: form email + contraseña ─────────────────── */
            <LoginFormNormal
              email={email} setEmail={setEmail}
              password={password} setPassword={setPassword}
              isLocked={isLocked}
              error={error}
              failedAttempts={failedAttempts} maxAttempts={MAX_ATTEMPTS}
              remaining={remaining}
              loading={loading}
              handleLogin={handleLogin}
            />
          ) : null /* loadingOffline — mostrar nada mientras carga IDB */ }
        </div>
      </div>
    </>
  );
}
