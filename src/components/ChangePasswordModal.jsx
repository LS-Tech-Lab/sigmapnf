import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { S } from "../constants";

/**
 * ChangePasswordModal.jsx
 *
 * Permite que el usuario autenticado cambie SU PROPIA contraseña.
 * A diferencia de la creación/reseteo de contraseña de OTROS usuarios
 * (que requiere service_role vía la Edge Function admin-users), esto
 * actúa sobre la sesión actual y no necesita privilegios especiales:
 * `supabase.auth.updateUser()` solo puede modificar la cuenta logueada.
 *
 * Por seguridad, antes de aplicar el cambio se reverifica la contraseña
 * actual con signInWithPassword (evita que alguien cambie la contraseña
 * desde una sesión que quedó abierta sin que sea realmente el dueño).
 *
 * Props:
 *   open      {boolean}
 *   onClose   {fn}
 *   email     {string}  — correo del usuario autenticado
 *   showToast {fn}
 *   logAudit  {fn}
 */
export default function ChangePasswordModal({ open, onClose, email, showToast, logAudit }) {
  const [actual,    setActual]    = useState("");
  const [nueva,     setNueva]     = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error,     setError]     = useState(null);
  const [guardando, setGuardando] = useState(false);
  const firstInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setActual(""); setNueva(""); setConfirmar(""); setError(null);
    const handleKeyDown = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleKeyDown);
    setTimeout(() => firstInputRef.current?.focus(), 0);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const valido = actual.length > 0 && nueva.length >= 8 && nueva === confirmar;

  const handleSubmit = async () => {
    setError(null);

    if (!actual) { setError("Ingresa tu contraseña actual."); return; }
    if (nueva.length < 8) { setError("La nueva contraseña debe tener al menos 8 caracteres."); return; }
    if (nueva !== confirmar) { setError("Las contraseñas no coinciden."); return; }
    if (nueva === actual) { setError("La nueva contraseña debe ser distinta a la actual."); return; }

    setGuardando(true);

    // Reverificar identidad con la contraseña actual antes de cambiarla.
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: actual });
    if (verifyError) {
      setError("La contraseña actual no es correcta.");
      setGuardando(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: nueva });
    setGuardando(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await logAudit?.({
      accion:  "CAMBIAR_PASSWORD_PROPIA",
      entidad: "usuarios",
      resumen: "El usuario cambió su propia contraseña.",
    });

    showToast?.("✅ Contraseña actualizada.", "success");
    onClose?.();
  };

  const inputStyle = { ...S.input, width: "100%", boxSizing: "border-box", padding: "9px 12px" };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", maxWidth: 400, width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)", fontFamily: "system-ui,-apple-system,sans-serif" }}
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-labelledby="change-password-title"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 22 }}>🔑</span>
          <h2 id="change-password-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>
            Cambiar mi contraseña
          </h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Contraseña actual</label>
            <input ref={firstInputRef} type="password" value={actual}
              onChange={e => setActual(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              autoComplete="current-password" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Nueva contraseña (mín. 8 caracteres)</label>
            <input type="password" value={nueva}
              onChange={e => setNueva(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              autoComplete="new-password" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Confirmar nueva contraseña</label>
            <input type="password" value={confirmar}
              onChange={e => setConfirmar(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              autoComplete="new-password" style={inputStyle} />
          </div>

          {error && (
            <div style={{ background: "#FEF2F2", color: "#DC2626", borderRadius: 8,
              padding: "10px 14px", fontSize: 13 }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <button onClick={onClose}
            style={{ padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: "pointer", border: "none", background: "#F3F4F6", color: "#374151" }}>
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={!valido || guardando}
            style={{ padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: valido ? "pointer" : "not-allowed", border: "none",
              background: valido ? "#2563EB" : "#E5E7EB", color: valido ? "#fff" : "#94A3B8" }}>
            {guardando ? "Guardando…" : "✅ Cambiar contraseña"}
          </button>
        </div>
      </div>
    </div>
  );
}
