import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { listarUsuariosOffline, verificarPinOffline, guardarPinOffline } from "../utils/pinOffline";

// LIMITACIÓN CONOCIDA — Fix #9 (auditoría Junio 2026)
// El contador de intentos fallidos y el bloqueo temporal viven en
// localStorage. Un atacante puede eludirlos borrando localStorage
// o usando una pestaña privada. Este mecanismo es únicamente una
// capa de UX para el usuario legítimo — no debe considerarse seguridad
// real contra brute-force. La protección efectiva la provee Supabase
// Auth en el backend mediante rate limiting por IP.
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;
const LOCKOUT_STORAGE_KEY = "login_lockout_until";
const ATTEMPTS_STORAGE_KEY = "login_failed_attempts";

// PIN offline: máximo de intentos fallidos antes de bloquear 5 minutos
const PIN_MAX_ATTEMPTS   = 5;
const PIN_LOCKOUT_MS     = 5 * 60 * 1000;
const PIN_LOCKOUT_KEY    = "pin_lockout_until";
const PIN_ATTEMPTS_KEY   = "pin_failed_attempts";

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

function readStoredLockout() {
  try { const u = parseInt(localStorage.getItem(LOCKOUT_STORAGE_KEY) || "0", 10); return u > Date.now() ? u : null; }
  catch { return null; }
}
function readStoredAttempts() {
  try { return parseInt(localStorage.getItem(ATTEMPTS_STORAGE_KEY) || "0", 10); }
  catch { return 0; }
}
function persistLockout(until) {
  try { if (until) localStorage.setItem(LOCKOUT_STORAGE_KEY, String(until)); else localStorage.removeItem(LOCKOUT_STORAGE_KEY); }
  catch { /* degradamos sin persistencia */ }
}
function persistAttempts(n) {
  try { if (n > 0) localStorage.setItem(ATTEMPTS_STORAGE_KEY, String(n)); else localStorage.removeItem(ATTEMPTS_STORAGE_KEY); }
  catch { /* idem */ }
}

// ── PIN lockout helpers ───────────────────────────────────────────────────────
function readPinLockout() {
  try { const u = parseInt(localStorage.getItem(PIN_LOCKOUT_KEY) || "0", 10); return u > Date.now() ? u : null; }
  catch { return null; }
}
function readPinAttempts() {
  try { return parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) || "0", 10); }
  catch { return 0; }
}
function persistPinLockout(until) {
  try { if (until) localStorage.setItem(PIN_LOCKOUT_KEY, String(until)); else localStorage.removeItem(PIN_LOCKOUT_KEY); }
  catch { /* no-op */ }
}
function persistPinAttempts(n) {
  try { if (n > 0) localStorage.setItem(PIN_ATTEMPTS_KEY, String(n)); else localStorage.removeItem(PIN_ATTEMPTS_KEY); }
  catch { /* no-op */ }
}

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

  const inputStyle = {
    width: "100%", padding: "10px 14px", borderRadius: 9,
    border: "1px solid var(--color-border-secondary)", fontSize: 22,
    letterSpacing: "0.3em", textAlign: "center",
    outline: "none", boxSizing: "border-box", fontFamily: "monospace",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(2,6,23,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16,
    }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "32px 28px", maxWidth: 340, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <i className="ti ti-shield-lock" style={{ fontSize: 40, color: "var(--brand-500)", display: "block", marginBottom: 8 }} aria-hidden="true" />
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>Activar PIN offline</div>
          <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginTop: 6 }}>
            Si el internet falla podrás entrar con este PIN. Solo funciona en este dispositivo.
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--navy-700)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            PIN (4–6 dígitos)
          </label>
          <input type="password" inputMode="numeric" maxLength={6} value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ""))} style={inputStyle} placeholder="••••" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--navy-700)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Confirmar PIN
          </label>
          <input type="password" inputMode="numeric" maxLength={6} value={pin2}
            onChange={e => setPin2(e.target.value.replace(/\D/g, ""))} style={inputStyle} placeholder="••••" />
        </div>

        {err && (
          <div style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", padding: "9px 13px", borderRadius: 8, fontSize: 13, marginBottom: 14, display: "flex", gap: 6 }}>
            <i className="ti ti-alert-circle" style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => onDone(false)} disabled={saving}
            style={{ flex: 1, padding: "10px 0", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#334155" }}>
            Ahora no
          </button>
          <button onClick={handleGuardar} disabled={saving || pin.length < 4}
            style={{ flex: 1, padding: "10px 0", background: pin.length >= 4 && !saving ? "var(--brand-500)" : "var(--color-border-info)", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: pin.length >= 4 && !saving ? "pointer" : "not-allowed", color: "#fff" }}>
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
  const [failedAttempts, setFailedAttempts] = useState(
    () => readStoredLockout() ? readStoredAttempts() : 0
  );
  const [lockedUntil, setLockedUntil] = useState(() => readStoredLockout());
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
  const [pinLockedUntil,  setPinLockedUntil]  = useState(() => readPinLockout());
  const [pinRemaining,    setPinRemaining]    = useState(0);
  const [pinAttempts,     setPinAttempts]     = useState(
    () => readPinLockout() ? readPinAttempts() : 0
  );
  const pinTimerRef = useRef(null);

  // ── Modal activar PIN ─────────────────────────────────────────────────────
  // Se muestra tras un login exitoso si el usuario no tiene PIN guardado.
  const [pendingPinUser,    setPendingPinUser]    = useState(null); // { user, profile }
  const [mostrarModalPIN,   setMostrarModalPIN]   = useState(false);

  // ── Lockout normal ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemaining(s);
      if (s <= 0) {
        setLockedUntil(null); setFailedAttempts(0);
        persistLockout(null); persistAttempts(0);
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
        setPinLockedUntil(null); setPinAttempts(0);
        persistPinLockout(null); persistPinAttempts(0);
        clearInterval(pinTimerRef.current);
      }
    };
    tick();
    pinTimerRef.current = setInterval(tick, 500);
    return () => clearInterval(pinTimerRef.current);
  }, [pinLockedUntil]);

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

    // Capturamos el user y profile del callback de Auth para el modal PIN
    let loginUser    = null;
    let loginProfile = null;

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(getAuthErrorMessage(authError));
      const next = failedAttempts + 1;
      setFailedAttempts(next); persistAttempts(next);
      if (next >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_SECONDS * 1000;
        setLockedUntil(until); persistLockout(until);
      }
      try {
        await supabase.rpc("log_login_fallido", {
          p_email: email, p_user_agent: navigator.userAgent, p_motivo: authError.message,
        });
      } catch { /* no-op */ }
    } else {
      setFailedAttempts(0); persistAttempts(0); persistLockout(null);
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
        const { tienePinOffline: check } = await import("../utils/pinOffline");
        const yaTiene = await check(loginUser.id);
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
      const next = pinAttempts + 1;
      setPinAttempts(next); persistPinAttempts(next);
      if (next >= PIN_MAX_ATTEMPTS) {
        const until = Date.now() + PIN_LOCKOUT_MS;
        setPinLockedUntil(until); persistPinLockout(until);
        setPinError(`PIN incorrecto ${next} veces. Bloqueado por 5 minutos.`);
      } else {
        setPinError(`PIN incorrecto. Intento ${next} de ${PIN_MAX_ATTEMPTS}.`);
      }
      setPinLoading(false);
      return;
    }

    // PIN correcto — limpiar intentos y llamar callback
    setPinAttempts(0); persistPinAttempts(0); persistPinLockout(null);
    onOfflineLogin(perfil);
    setPinLoading(false);
  };

  // ── Shared styles ─────────────────────────────────────────────────────────
  const inputStyle = (disabled) => ({
    width: "100%", padding: "10px 14px", borderRadius: 9,
    border: "1px solid var(--color-border-secondary)", fontSize: 14,
    outline: "none", boxSizing: "border-box",
    transition: "border-color .15s, box-shadow .15s",
    background: disabled ? "var(--color-background-tertiary)" : "#fff",
    fontFamily: "inherit",
  });
  const labelStyle = {
    display: "block", fontSize: 12, fontWeight: 600, color: "var(--navy-700)",
    marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em",
  };

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

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100dvh", overflowY: "auto", padding: "24px 16px",
        background: "radial-gradient(circle at 18% 14%, var(--brand-700) 0%, var(--color-text-primary) 42%, var(--navy-950) 100%)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}>
        <div style={{
          background: "#fff", borderRadius: 20, padding: "40px 32px",
          width: "100%", maxWidth: 380,
          boxShadow: "0 24px 64px rgba(2,6,23,0.35)",
          border: "1px solid rgba(148,163,184,0.15)",
        }}>
          {/* Cabecera */}
          <div style={{ textAlign: "center", marginBottom: 30 }}>
            <img src="/logo-coordinacion.png" alt="Logo Coordinación"
              style={{ width: 180, height: 180, objectFit: "contain", margin: "0 auto 10px", display: "block" }} />
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "0.05em", lineHeight: 1.2 }}>
              SIGMA
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 500, letterSpacing: "0.01em" }}>
              Sistema Integrado de Gestión y Módulos Académicos
            </p>
            <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--color-text-tertiary)", fontWeight: 500 }}>
              {isOffline ? "Sin conexión — acceso offline" : "Inicia sesión para continuar"}
            </p>
          </div>

          {/* Banner offline */}
          {isOffline && (
            <div style={{
              background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 9,
              padding: "9px 13px", marginBottom: 20, fontSize: 13,
              color: "#92400E", display: "flex", alignItems: "center", gap: 7,
            }}>
              <i className="ti ti-wifi-off" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
              <span>Sin red. {usuariosOffline.length > 0 ? "Usa tu PIN para acceder." : "No hay usuarios con PIN guardado en este dispositivo."}</span>
            </div>
          )}

          {/* ── MODO OFFLINE: selector + PIN ──────────────────────────── */}
          {isOffline && !loadingOffline && usuariosOffline.length > 0 ? (
            <>
              {usuariosOffline.length > 1 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Usuario</label>
                  <select
                    value={usuarioSelec?.userId || ""}
                    onChange={e => {
                      const u = usuariosOffline.find(x => x.userId === e.target.value);
                      setUsuarioSelec(u || null);
                      setPin(""); setPinError(null);
                    }}
                    style={{ ...inputStyle(false), cursor: "pointer" }}
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
                <div style={{
                  background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 9,
                  padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#0369A1",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <i className="ti ti-user-circle" style={{ fontSize: 18, flexShrink: 0 }} aria-hidden="true" />
                  <div>
                    <div style={{ fontWeight: 600 }}>{usuarioSelec.nombre}</div>
                    <div style={{ fontSize: 12, color: "#0C4A6E" }}>{usuarioSelec.email}</div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 22 }}>
                <label style={labelStyle}>PIN offline</label>
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
                  style={{ ...inputStyle(isPinLocked || !usuarioSelec), fontSize: 28, letterSpacing: "0.3em", textAlign: "center" }}
                />
              </div>

              {pinError && (
                <div style={{
                  background: "var(--color-danger-bg)", color: "var(--color-danger)",
                  padding: "10px 14px", borderRadius: 9, fontSize: 13, marginBottom: 16,
                  fontWeight: 500, display: "flex", alignItems: "flex-start", gap: 8,
                }}>
                  <i className="ti ti-alert-circle" style={{ fontSize: 15, marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
                  {pinError}
                </div>
              )}

              {isPinLocked && (
                <div style={{
                  background: "var(--color-warning-bg)", color: "var(--color-warning-text)",
                  padding: "10px 14px", borderRadius: 9, fontSize: 13, marginBottom: 16,
                  fontWeight: 500, display: "flex", alignItems: "center", gap: 8,
                }}>
                  <i className="ti ti-clock-hour-4" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
                  Bloqueado. Intenta de nuevo en {Math.ceil(pinRemaining / 60)} min {pinRemaining % 60}s.
                </div>
              )}

              <button
                onClick={handlePinLogin}
                disabled={pinLoading || isPinLocked || !usuarioSelec || pin.length < 4}
                style={{
                  width: "100%", padding: "11px 0", border: "none", borderRadius: 9,
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                  background: (pinLoading || isPinLocked || !usuarioSelec || pin.length < 4)
                    ? "var(--color-border-info)" : "var(--brand-500)",
                  color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  transition: "background .15s",
                }}
              >
                {pinLoading
                  ? "Verificando…"
                  : isPinLocked
                    ? `Bloqueado (${Math.ceil(pinRemaining / 60)}:${String(pinRemaining % 60).padStart(2, "0")})`
                    : <><i className="ti ti-shield-check" aria-hidden="true" /> Entrar con PIN</>
                }
              </button>

              <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "var(--color-text-tertiary)" }}>
                Modo offline — los datos se sincronizarán al reconectar
              </div>
            </>
          ) : isOffline && !loadingOffline ? (
            // Sin red y sin usuarios offline guardados
            <div style={{ textAlign: "center", padding: "16px 0 8px", color: "#64748B", fontSize: 13 }}>
              <i className="ti ti-database-off" style={{ fontSize: 36, display: "block", marginBottom: 10, color: "#CBD5E1" }} aria-hidden="true" />
              Para usar el acceso offline, inicia sesión con internet al menos una vez y activa tu PIN desde la pantalla de login.
            </div>
          ) : !isOffline ? (
            /* ── MODO NORMAL: form email + contraseña ─────────────────── */
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Correo electrónico</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required disabled={isLocked} placeholder="tucorreo@dominio.com"
                  autoComplete="email"
                  onFocus={e => { e.target.style.borderColor = "var(--brand-500)"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.15)"; }}
                  onBlur={e  => { e.target.style.borderColor = "var(--color-border-secondary)"; e.target.style.boxShadow = "none"; }}
                  style={inputStyle(isLocked)}
                />
              </div>

              <div style={{ marginBottom: 22 }}>
                <label style={labelStyle}>Contraseña</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required disabled={isLocked} placeholder="••••••••"
                  autoComplete="current-password"
                  onFocus={e => { e.target.style.borderColor = "var(--brand-500)"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.15)"; }}
                  onBlur={e  => { e.target.style.borderColor = "var(--color-border-secondary)"; e.target.style.boxShadow = "none"; }}
                  style={inputStyle(isLocked)}
                />
              </div>

              {error && !isLocked && (
                <div style={{
                  background: "var(--color-danger-bg)", color: "var(--color-danger)",
                  padding: "10px 14px", borderRadius: 9, fontSize: 13, marginBottom: 16,
                  fontWeight: 500, display: "flex", alignItems: "flex-start", gap: 8,
                }}>
                  <i className="ti ti-alert-circle" style={{ fontSize: 15, marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
                  <div>
                    {error}
                    {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
                      <div style={{ marginTop: 4, fontSize: 12, color: "var(--color-danger-dark)" }}>
                        Intento {failedAttempts} de {MAX_ATTEMPTS}.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isLocked && (
                <div style={{
                  background: "var(--color-warning-bg)", color: "var(--color-warning-text)",
                  padding: "10px 14px", borderRadius: 9, fontSize: 13, marginBottom: 16,
                  fontWeight: 500, display: "flex", alignItems: "center", gap: 8,
                }}>
                  <i className="ti ti-clock-hour-4" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
                  Demasiados intentos fallidos. Intenta de nuevo en {remaining} segundo{remaining === 1 ? "" : "s"}.
                </div>
              )}

              <button
                type="submit" disabled={loading || isLocked}
                style={{
                  width: "100%", padding: "11px 0",
                  background: (loading || isLocked) ? "var(--color-border-info)" : "var(--brand-500)",
                  color: "#fff", border: "none", borderRadius: 9, fontSize: 14, fontWeight: 600,
                  cursor: (loading || isLocked) ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  transition: "background .15s",
                }}
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
