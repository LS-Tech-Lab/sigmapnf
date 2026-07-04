import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  listarUsuariosOffline, verificarPinOffline, guardarPinOffline, tienePinOffline,
  // Fix O-8: lockout del PIN en IDB — resiste tabs privadas
  leerLockoutIDB, registrarIntentoPinFallido, limpiarLockoutIDB,
  // SEC-5: lockout del login normal en IDB
  leerLoginLockoutIDB, registrarIntentoLoginFallido, limpiarLoginLockoutIDB,
} from "../utils/pinOffline";
import "./LoginScreen.css";

// SEC-5 (Junio 2026): el lockout del login normal fue migrado de localStorage a IDB
// usando leerLoginLockoutIDB / registrarIntentoLoginFallido / limpiarLoginLockoutIDB
// (pinOffline.js). Resiste tabs privadas y limpieza manual de DevTools.
// La protección real contra brute-force la provee Supabase Auth (rate limiting por IP).
const MAX_ATTEMPTS    = 5;
const LOCKOUT_SECONDS = 60;

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

// ── Subcomponente: modal para activar PIN tras login exitoso ──────────────────
function ModalActivarPIN({ user, profile, onDone }) {
  const [pin,    setPin]    = useState("");
  const [pin2,   setPin2]   = useState("");
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState(null);

  const handleGuardar = async () => {
    setErr(null);
    if (!/^\d{4,6}$/.test(pin))     { setErr("El PIN debe tener entre 4 y 6 dígitos."); return; }
    if (pin !== pin2)                { setErr("Los PINs no coinciden."); return; }
    setSaving(true);
    try {
      await guardarPinOffline(user, profile, pin);
      onDone(true);
    } catch (e) {
      setErr("No se pudo guardar el PIN: " + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="pin-modal-overlay">
      <div className="pin-modal-card">
        <div className="pin-modal-header">
          <i className="ti ti-shield-lock pin-modal-icon" aria-hidden="true" />
          <div className="pin-modal-title">Activar PIN offline</div>
          <div className="pin-modal-subtitle">
            Si el internet falla podrás entrar con este PIN. Solo funciona en este dispositivo.
          </div>
        </div>

        <div className="mb-14">
          <label className="form-label">
            PIN (4–6 dígitos)
          </label>
          <input type="password" inputMode="numeric" maxLength={6} value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ""))} className="pin-input" placeholder="••••" />
        </div>
        <div className="mb-20">
          <label className="form-label">
            Confirmar PIN
          </label>
          <input type="password" inputMode="numeric" maxLength={6} value={pin2}
            onChange={e => setPin2(e.target.value.replace(/\D/g, ""))} className="pin-input" placeholder="••••" />
        </div>

        {err && (
          <div className="pin-modal-error">
            <i className="ti ti-alert-circle pin-modal-error__icon" aria-hidden="true" />
            {err}
          </div>
        )}

        <div className="pin-modal-btn-row">
          <button onClick={() => onDone(false)} disabled={saving} className="pin-modal-btn-cancel">
            Ahora no
          </button>
          <button onClick={handleGuardar} disabled={saving || pin.length < 4} className="pin-modal-btn-confirm">
            {saving ? "Guardando…" : "Activar PIN"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

    // Capturamos el user y profile del callback de Auth para el modal PIN
    let loginUser    = null;
    let loginProfile = null;

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
            <>
              {usuariosOffline.length > 1 && (
                <div className="mb-16">
                  <label className="form-label">Usuario</label>
                  <select
                    value={usuarioSelec?.userId || ""}
                    onChange={e => {
                      const u = usuariosOffline.find(x => x.userId === e.target.value);
                      setUsuarioSelec(u || null);
                      setPin(""); setPinError(null);
                    }}
                    className="form-input"
                  >
                    <option value="">— Selecciona usuario —</option>
                    {usuariosOffline.map(u => (
                      <option key={u.userId} value={u.userId}>
                        {u.nombre} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {usuarioSelec && usuariosOffline.length === 1 && (
                <div className="login-user-badge">
                  <i className="ti ti-user-circle login-user-badge__icon" aria-hidden="true" />
                  <div>
                    <div className="login-user-badge__name">{usuarioSelec.nombre}</div>
                    <div className="login-user-badge__email">{usuarioSelec.email}</div>
                  </div>
                </div>
              )}

              <div className="mb-22">
                <label className="form-label">PIN offline</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setPinError(null); }}
                  onKeyDown={e => e.key === "Enter" && handlePinLogin()}
                  disabled={isPinLocked || !usuarioSelec}
                  placeholder="••••"
                  autoFocus
                  className="pin-offline-input"
                />
              </div>

              {pinError && (
                <div className="alert-box alert-box--danger">
                  <i className="ti ti-alert-circle icon-alert--top" aria-hidden="true" />
                  {pinError}
                </div>
              )}

              {isPinLocked && (
                <div className="alert-box alert-box--warning alert-box--center">
                  <i className="ti ti-clock-hour-4 icon-alert" aria-hidden="true" />
                  Bloqueado. Intenta de nuevo en {Math.ceil(pinRemaining / 60)} min {pinRemaining % 60}s.
                </div>
              )}

              <button
                onClick={handlePinLogin}
                disabled={pinLoading || isPinLocked || !usuarioSelec || pin.length < 4}
                className="pin-login-btn"
              >
                {pinLoading
                  ? "Verificando…"
                  : isPinLocked
                    ? `Bloqueado (${Math.ceil(pinRemaining / 60)}:${String(pinRemaining % 60).padStart(2, "0")})`
                    : <><i className="ti ti-shield-check" aria-hidden="true" /> Entrar con PIN</>
                }
              </button>

              <div className="login-offline-hint">
                Modo offline — los datos se sincronizarán al reconectar
              </div>
            </>
          ) : isOffline && !loadingOffline ? (
            // Sin red y sin usuarios offline guardados
            <div className="login-offline-empty">
              <i className="ti ti-database-off login-offline-empty__icon" aria-hidden="true" />
              Para usar el acceso offline, inicia sesión con internet al menos una vez y activa tu PIN desde la pantalla de login.
            </div>
          ) : !isOffline ? (
            /* ── MODO NORMAL: form email + contraseña ─────────────────── */
            <form onSubmit={handleLogin}>
              <div className="mb-16">
                <label className="form-label">Correo electrónico</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required disabled={isLocked} placeholder="tucorreo@dominio.com"
                  autoComplete="email"
                  className="form-input"
                />
              </div>

              <div className="mb-22">
                <label className="form-label">Contraseña</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required disabled={isLocked} placeholder="••••••••"
                  autoComplete="current-password"
                  className="form-input"
                />
              </div>

              {error && !isLocked && (
                <div className="alert-box alert-box--danger">
                  <i className="ti ti-alert-circle icon-alert--top" aria-hidden="true" />
                  <div>
                    {error}
                    {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
                      <div className="login-attempt-count">
                        Intento {failedAttempts} de {MAX_ATTEMPTS}.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isLocked && (
                <div className="alert-box alert-box--warning alert-box--center">
                  <i className="ti ti-clock-hour-4 icon-alert" aria-hidden="true" />
                  Demasiados intentos fallidos. Intenta de nuevo en {remaining} segundo{remaining === 1 ? "" : "s"}.
                </div>
              )}

              <button
                type="submit" disabled={loading || isLocked}
                className="login-submit-btn"
              >
                {isLocked
                  ? `Bloqueado (${remaining}s)`
                  : loading
                    ? "Iniciando sesión…"
                    : <><i className="ti ti-login-2" aria-hidden="true" /> Iniciar sesión</>
                }
              </button>
            </form>
          ) : null /* loadingOffline — mostrar nada mientras carga IDB */ }
        </div>
      </div>
    </>
  );
}
