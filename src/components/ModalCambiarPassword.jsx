/**
 * ModalCambiarPassword.jsx
 *
 * Modal para que cualquier usuario cambie su contraseña o su correo.
 * Dos pestañas: "Contraseña" y "Correo electrónico".
 * Usa supabase.auth.updateUser() — no requiere service_role.
 */

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { validarPassword } from "../utils/password";
import "./ModalCambiarPassword.css";

// ── Pestaña activa ────────────────────────────────────────────────────
const TABS = [
  { id: "password", label: "Contraseña", icon: "ti-key"  },
  { id: "email",    label: "Correo",     icon: "ti-mail" },
];

export default function ModalCambiarPassword({ onCerrar, showToast }) {
  const [tab, setTab] = useState("password");

  // ── Estado contraseña ─────────────────────────────────────────────
  const [actual,    setActual]    = useState("");
  const [nueva,     setNueva]     = useState("");
  const [confirmar, setConfirmar] = useState("");

  // ── Estado correo ─────────────────────────────────────────────────
  const [passwordEmail, setPasswordEmail] = useState(""); // re-auth
  const [nuevoEmail,    setNuevoEmail]    = useState("");
  const [confirmarEmail,setConfirmarEmail]= useState("");

  // ── Compartido ────────────────────────────────────────────────────
  const [guardando, setGuardando] = useState(false);
  const [error,     setError]     = useState(null);

  // ── Accesibilidad: foco al primer input + Escape para cerrar ──────
  const firstInputRef = useRef(null);
  useEffect(() => {
    firstInputRef.current?.focus();
    const handleKeyDown = (e) => { if (e.key === "Escape") onCerrar?.(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCerrar]);

  // Al cambiar de pestaña, redirigir foco al primer campo de esa pestaña
  useEffect(() => {
    firstInputRef.current?.focus();
  }, [tab]);

  const resetError = () => setError(null);

  // ── Validaciones ──────────────────────────────────────────────────
  const validoPassword =
    actual.length >= 1 &&
    validarPassword(nueva) === null &&
    nueva === confirmar;

  const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const validoEmail =
    passwordEmail.length >= 1 &&
    emailValido(nuevoEmail) &&
    nuevoEmail === confirmarEmail;

  // ── Fortaleza contraseña ──────────────────────────────────────────
  const fortaleza = (() => {
    if (!nueva) return null;
    if (nueva.length < 10) return { label: "Muy corta",  variant: "muy-corta" };
    if (!/[A-Z]/.test(nueva) || !/[0-9]/.test(nueva))
                           return { label: "Regular",    variant: "regular" };
    if (nueva.length < 14) return { label: "Buena",      variant: "buena" };
    return                        { label: "Excelente",  variant: "excelente" };
  })();

  // ── Re-autenticar (compartido) ────────────────────────────────────
  const reAutenticar = async (password) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData?.session?.user?.email;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  };

  // ── Guardar contraseña ────────────────────────────────────────────
  const handleGuardarPassword = async () => {
    setError(null);
    if (nueva !== confirmar)  { setError("Las contraseñas no coinciden."); return; }
    const errorPwd = validarPassword(nueva);
    if (errorPwd)             { setError(errorPwd); return; }
    setGuardando(true);

    const reAuthError = await reAutenticar(actual);
    if (reAuthError) {
      setError("La contraseña actual es incorrecta.");
      setGuardando(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: nueva });
    if (updateError) {
      setError("Error al cambiar la contraseña: " + updateError.message);
      setGuardando(false);
      return;
    }

    showToast?.("Contraseña actualizada correctamente.", "success");
    setGuardando(false);
    onCerrar();
  };

  // ── Guardar correo ────────────────────────────────────────────────
  const handleGuardarEmail = async () => {
    setError(null);
    if (!emailValido(nuevoEmail))      { setError("El correo no tiene un formato válido."); return; }
    if (nuevoEmail !== confirmarEmail) { setError("Los correos no coinciden."); return; }
    setGuardando(true);

    const reAuthError = await reAutenticar(passwordEmail);
    if (reAuthError) {
      setError("La contraseña es incorrecta.");
      setGuardando(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ email: nuevoEmail });
    if (updateError) {
      setError("Error al cambiar el correo: " + updateError.message);
      setGuardando(false);
      return;
    }

    // Guardar el email nuevo en sessionStorage para detectar el redirect
    // de confirmación cuando Supabase redirija de vuelta a la app.
    localStorage.setItem("sigma_email_change_pending", nuevoEmail.trim().toLowerCase());

    // Supabase envía un email de confirmación al correo nuevo.
    // La sesión mantiene el correo viejo hasta que el usuario confirme.
    showToast?.("Revisa tu nuevo correo para confirmar el cambio.", "success");
    setGuardando(false);
    onCerrar();
  };

  return (
    <div
      className="mcp-backdrop"
      role="presentation"
      onClick={onCerrar}
    >
      <div
        className="mcp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-cuenta-titulo"
        onClick={e => e.stopPropagation()}
      >

        {/* Cabecera */}
        <div className="mcp-header">
          <i
            className={`ti ${tab === "password" ? "ti-key" : "ti-mail"} mcp-header-icon`}
            aria-hidden="true"
          />
          <h2 id="modal-cuenta-titulo" className="mcp-title">
            Configuración de cuenta
          </h2>
          <p className="mcp-subtitle">
            Cambia tu contraseña o tu correo electrónico.
          </p>
        </div>

        {/* Pestañas */}
        <div className="mcp-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(null); }}
              className={`mcp-tab${tab === t.id ? " mcp-tab--active" : ""}`}
            >
              <i className={`ti ${t.icon} mcp-tab-icon`} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Panel: Contraseña ───────────────────────────────────── */}
        {tab === "password" && (
          <div className="mcp-panel">
            <div>
              <label htmlFor="pwd-actual" className="mcp-field-label">Contraseña actual *</label>
              <input
                id="pwd-actual"
                ref={firstInputRef}
                type="password" value={actual}
                onChange={e => { setActual(e.target.value); resetError(); }}
                placeholder="Tu contraseña actual"
                className="mcp-input" autoComplete="current-password"
              />
            </div>

            <div>
              <label htmlFor="pwd-nueva" className="mcp-field-label">Nueva contraseña * (mín. 8 caracteres)</label>
              <input
                id="pwd-nueva"
                type="password" value={nueva}
                onChange={e => { setNueva(e.target.value); resetError(); }}
                placeholder="Mínimo 8 caracteres"
                className="mcp-input" autoComplete="new-password"
              />
              {fortaleza && (
                <div className="mcp-strength-wrap">
                  <div className="mcp-strength-track">
                    <div
                      className={`mcp-strength-fill mcp-strength--${fortaleza.variant}`}
                    />
                  </div>
                  <span className={`mcp-strength-label mcp-strength--${fortaleza.variant}`}>
                    {fortaleza.label}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="pwd-confirmar" className="mcp-field-label">Confirmar nueva contraseña *</label>
              <input
                id="pwd-confirmar"
                type="password" value={confirmar}
                onChange={e => { setConfirmar(e.target.value); resetError(); }}
                placeholder="Repite la nueva contraseña"
                className={`mcp-input${confirmar && nueva !== confirmar ? " mcp-input--error" : ""}`}
                autoComplete="new-password"
              />
              {confirmar && nueva !== confirmar && (
                <span className="mcp-hint mcp-hint--error">
                  Las contraseñas no coinciden.
                </span>
              )}
              {confirmar && nueva === confirmar && nueva.length >= 8 && (
                <span className="mcp-hint mcp-hint--success">
                  ✓ Las contraseñas coinciden.
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Panel: Correo ───────────────────────────────────────── */}
        {tab === "email" && (
          <div className="mcp-panel">
            <div className="mcp-email-info">
              <i className="ti ti-info-circle mcp-email-info-icon" aria-hidden="true" />
              Se enviará un enlace de confirmación al nuevo correo. El cambio se aplica al hacer clic en ese enlace.
            </div>

            <div>
              <label htmlFor="email-pwd-actual" className="mcp-field-label">Contraseña actual * (para verificar)</label>
              <input
                id="email-pwd-actual"
                ref={firstInputRef}
                type="password" value={passwordEmail}
                onChange={e => { setPasswordEmail(e.target.value); resetError(); }}
                placeholder="Tu contraseña actual"
                className="mcp-input" autoComplete="current-password"
              />
            </div>

            <div>
              <label htmlFor="email-nuevo" className="mcp-field-label">Nuevo correo electrónico *</label>
              <input
                id="email-nuevo"
                type="email" value={nuevoEmail}
                onChange={e => { setNuevoEmail(e.target.value); resetError(); }}
                placeholder="nuevo@correo.com"
                className="mcp-input" autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="email-confirmar" className="mcp-field-label">Confirmar nuevo correo *</label>
              <input
                id="email-confirmar"
                type="email" value={confirmarEmail}
                onChange={e => { setConfirmarEmail(e.target.value); resetError(); }}
                placeholder="Repite el nuevo correo"
                className={`mcp-input${confirmarEmail && nuevoEmail !== confirmarEmail ? " mcp-input--error" : ""}`}
                autoComplete="email"
              />
              {confirmarEmail && nuevoEmail !== confirmarEmail && (
                <span className="mcp-hint mcp-hint--error">
                  Los correos no coinciden.
                </span>
              )}
              {confirmarEmail && nuevoEmail === confirmarEmail && emailValido(nuevoEmail) && (
                <span className="mcp-hint mcp-hint--success">
                  ✓ Los correos coinciden.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error general */}
        {error && (
          <div className="mcp-error-box">
            <i className="ti ti-alert-circle mcp-error-icon" aria-hidden="true" />
            {error}
          </div>
        )}

        {/* Botones */}
        <div className="mcp-actions">
          <button onClick={onCerrar} className="mcp-btn-cancel">
            Cancelar
          </button>
          <button
            onClick={tab === "password" ? handleGuardarPassword : handleGuardarEmail}
            disabled={(tab === "password" ? !validoPassword : !validoEmail) || guardando}
            className="mcp-btn-submit">
            {guardando
              ? "Actualizando…"
              : tab === "password"
                ? <><i className="ti ti-key mcp-btn-icon" aria-hidden="true" />Actualizar contraseña</>
                : <><i className="ti ti-mail mcp-btn-icon" aria-hidden="true" />Actualizar correo</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
