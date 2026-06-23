import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

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

function getAuthErrorMessage(error) {
  const msg = (error?.message || "").toLowerCase();
  const status = error?.status;

  if (msg.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (msg.includes("email not confirmed")) {
    return "Correo no confirmado. Revisa tu bandeja de entrada para confirmar la cuenta.";
  }
  if (msg.includes("user not found")) {
    return "No existe una cuenta con ese correo.";
  }
  if (msg.includes("too many requests") || status === 429) {
    return "Demasiados intentos. Espera unos minutos antes de volver a intentarlo.";
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return "Error de conexión. Verifica tu internet e intenta de nuevo.";
  }
  return "No se pudo iniciar sesión. Intenta de nuevo.";
}

// El bloqueo se persiste en localStorage para que sobreviva recargas (F5).



function readStoredLockout() {
  try {
    const until = parseInt(localStorage.getItem(LOCKOUT_STORAGE_KEY) || "0", 10);
    return until > Date.now() ? until : null;
  } catch {
    return null;
  }
}

function readStoredAttempts() {
  try {
    return parseInt(localStorage.getItem(ATTEMPTS_STORAGE_KEY) || "0", 10);
  } catch {
    return 0;
  }
}

function persistLockout(until) {
  try {
    if (until) localStorage.setItem(LOCKOUT_STORAGE_KEY, String(until));
    else localStorage.removeItem(LOCKOUT_STORAGE_KEY);
  } catch { /* localStorage no disponible (modo privado, etc.) — degradamos sin persistencia */ }
}

function persistAttempts(n) {
  try {
    if (n > 0) localStorage.setItem(ATTEMPTS_STORAGE_KEY, String(n));
    else localStorage.removeItem(ATTEMPTS_STORAGE_KEY);
  } catch { /* idem */ }
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [failedAttempts, setFailedAttempts] = useState(() => {
    // Si hay un lockout activo persistido, los intentos también se restauran;
    // si el lockout ya expiró, no tiene sentido arrastrar el contador.
    return readStoredLockout() ? readStoredAttempts() : 0;
  });
  const [lockedUntil, setLockedUntil] = useState(() => readStoredLockout());
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const secsLeft = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemaining(secsLeft);
      if (secsLeft <= 0) {
        setLockedUntil(null);
        setFailedAttempts(0);
        persistLockout(null);
        persistAttempts(0);
        clearInterval(timerRef.current);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => clearInterval(timerRef.current);
  }, [lockedUntil]);

  const isLocked = !!lockedUntil && remaining > 0;

  const handleLogin = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(getAuthErrorMessage(error));
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      persistAttempts(nextAttempts);
      if (nextAttempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_SECONDS * 1000;
        setLockedUntil(until);
        persistLockout(until);
      }
      // Registrar intento fallido en BD (RPC accesible por anon)
      try {
        await supabase.rpc("log_login_fallido", {
          p_email:      email,
          p_user_agent: navigator.userAgent,
          p_motivo:     error.message,
        });
      } catch { /* no-op: los logs no deben bloquear el flujo */ }
    } else {
      setFailedAttempts(0);
      persistAttempts(0);
      persistLockout(null);
    }
    setLoading(false);
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      // 100dvh (dynamic viewport height) evita el bug de móviles donde
      // 100vh incluye la barra de URL y el teclado virtual desborda el layout.
      minHeight: "100dvh",
      overflowY: "auto",
      padding: "24px 16px",
      background: "radial-gradient(circle at 18% 14%, #1E3A8A 0%, #0F172A 42%, #0B1220 100%)",
      fontFamily: "var(--font-sans, system-ui, sans-serif)",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 20,
        padding: "40px 32px",
        width: "100%",
        maxWidth: 380,
        boxShadow: "0 24px 64px rgba(2,6,23,0.35)",
        border: "1px solid rgba(148,163,184,0.15)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <img
            src="/logo-coordinacion.png"
            alt="Logo Coordinación"
            style={{ width: 180, height: 180, objectFit: "contain", margin: "0 auto 10px", display: "block" }}
          />
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: "#0F172A", letterSpacing: "0.05em", lineHeight: 1.2 }}>
            SIGMA
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#94A3B8", fontWeight: 500, letterSpacing: "0.01em" }}>
            Sistema Integrado de Gestión y Módulos Académicos
          </p>
          <p style={{ margin: "14px 0 0", fontSize: 13, color: "#64748B", fontWeight: 500 }}>
            Inicia sesión para continuar
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Correo electrónico
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLocked}
              placeholder="tucorreo@dominio.com"
              autoComplete="email"
              onFocus={e => { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.15)"; }}
              onBlur={e  => { e.target.style.borderColor = "#CBD5E1"; e.target.style.boxShadow = "none"; }}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 9,
                border: "1px solid #CBD5E1", fontSize: 14,
                outline: "none", boxSizing: "border-box", transition: "border-color .15s, box-shadow .15s",
                background: isLocked ? "#F1F5F9" : "#fff", fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLocked}
              placeholder="••••••••"
              autoComplete="current-password"
              onFocus={e => { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.15)"; }}
              onBlur={e  => { e.target.style.borderColor = "#CBD5E1"; e.target.style.boxShadow = "none"; }}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 9,
                border: "1px solid #CBD5E1", fontSize: 14,
                outline: "none", boxSizing: "border-box", transition: "border-color .15s, box-shadow .15s",
                background: isLocked ? "#F1F5F9" : "#fff", fontFamily: "inherit",
              }}
            />
          </div>

          {error && !isLocked && (
            <div style={{
              background: "#FEF2F2",
              color: "#DC2626",
              padding: "10px 14px",
              borderRadius: 9,
              fontSize: 13,
              marginBottom: 16,
              fontWeight: 500,
              display: "flex", alignItems: "flex-start", gap: 8,
            }}>
              <i className="ti ti-alert-circle" style={{ fontSize: 15, marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
              <div>
                {error}
                {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
                  <div style={{ marginTop: 4, fontSize: 12, color: "#B91C1C" }}>
                    Intento {failedAttempts} de {MAX_ATTEMPTS}.
                  </div>
                )}
              </div>
            </div>
          )}

          {isLocked && (
            <div style={{
              background: "#FFFBEB",
              color: "#92400E",
              padding: "10px 14px",
              borderRadius: 9,
              fontSize: 13,
              marginBottom: 16,
              fontWeight: 500,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <i className="ti ti-clock-hour-4" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
              Demasiados intentos fallidos. Intenta de nuevo en {remaining} segundo{remaining === 1 ? "" : "s"}.
            </div>
          )}

          <button
            type="submit"
            disabled={loading || isLocked}
            style={{
              width: "100%",
              padding: "11px 0",
              background: (loading || isLocked) ? "#93C5FD" : "#2563EB",
              color: "#fff",
              border: "none",
              borderRadius: 9,
              fontSize: 14,
              fontWeight: 600,
              cursor: (loading || isLocked) ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              transition: "background .15s",
            }}
          >
            {isLocked
              ? `Bloqueado (${remaining}s)`
              : loading
                ? "Iniciando sesión…"
                : (<><i className="ti ti-login-2" aria-hidden="true" /> Iniciar sesión</>)}
          </button>
        </form>
      </div>
    </div>
  );
          }
