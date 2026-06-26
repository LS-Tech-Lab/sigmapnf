/**
 * ModalCambiarPassword.jsx
 *
 * Modal para que cualquier usuario cambie su contraseña o su correo.
 * Dos pestañas: "Contraseña" y "Correo electrónico".
 * Usa supabase.auth.updateUser() — no requiere service_role.
 */

import React, { useState } from "react";
import { supabase } from "../lib/supabase";

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

  const resetError = () => setError(null);

  // ── Validaciones ──────────────────────────────────────────────────
  const validoPassword =
    actual.length >= 1 &&
    nueva.length >= 8 &&
    nueva === confirmar;

  const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const validoEmail =
    passwordEmail.length >= 1 &&
    emailValido(nuevoEmail) &&
    nuevoEmail === confirmarEmail;

  // ── Fortaleza contraseña ──────────────────────────────────────────
  const fortaleza = (() => {
    if (!nueva) return null;
    if (nueva.length < 8)  return { label: "Muy corta",  color: "#EF4444", width: "20%" };
    if (nueva.length < 10) return { label: "Débil",      color: "#F97316", width: "40%" };
    if (!/[A-Z]/.test(nueva) || !/[0-9]/.test(nueva))
                           return { label: "Regular",    color: "#EAB308", width: "60%" };
    if (nueva.length < 14) return { label: "Buena",      color: "#22C55E", width: "80%" };
    return                        { label: "Excelente",  color: "#16A34A", width: "100%" };
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
    if (nueva.length < 8)     { setError("La nueva contraseña debe tener al menos 8 caracteres."); return; }
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

    // Supabase envía un email de confirmación al correo nuevo.
    // La sesión mantiene el correo viejo hasta que el usuario confirme.
    showToast?.("Revisa tu nuevo correo para confirmar el cambio.", "success");
    setGuardando(false);
    onCerrar();
  };

  // ── Estilos compartidos ───────────────────────────────────────────
  const inputStyle = {
    width: "100%", padding: "9px 12px", borderRadius: 8,
    border: "1px solid #E5E7EB", fontSize: 13, outline: "none",
    boxSizing: "border-box", fontFamily: "inherit",
  };
  const labelStyle = {
    fontSize: 12, fontWeight: 600, color: "#374151",
    display: "block", marginBottom: 5,
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20,
    }}>
      <div style={{
        background: "#fff", borderRadius: 14, padding: 28,
        maxWidth: 400, width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
      }}>

        {/* Cabecera */}
        <div style={{ marginBottom: 18 }}>
          <i
            className={`ti ${tab === "password" ? "ti-key" : "ti-mail"}`}
            style={{ fontSize: 28, color: "#2563EB", marginBottom: 6, display: "block" }}
            aria-hidden="true"
          />
          <h2 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700, color: "#0F172A" }}>
            Configuración de cuenta
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: "#64748B" }}>
            Cambia tu contraseña o tu correo electrónico.
          </p>
        </div>

        {/* Pestañas */}
        <div style={{
          display: "flex", gap: 4, marginBottom: 20,
          background: "#F1F5F9", borderRadius: 9, padding: 4,
        }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(null); }}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 7, border: "none",
                background: tab === t.id ? "#fff" : "transparent",
                color: tab === t.id ? "#1E40AF" : "#64748B",
                fontWeight: tab === t.id ? 700 : 500,
                fontSize: 13, cursor: "pointer",
                boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                transition: "all .15s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Panel: Contraseña ───────────────────────────────────── */}
        {tab === "password" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Contraseña actual *</label>
              <input
                type="password" value={actual}
                onChange={e => { setActual(e.target.value); resetError(); }}
                placeholder="Tu contraseña actual"
                style={inputStyle} autoComplete="current-password"
              />
            </div>

            <div>
              <label style={labelStyle}>Nueva contraseña * (mín. 8 caracteres)</label>
              <input
                type="password" value={nueva}
                onChange={e => { setNueva(e.target.value); resetError(); }}
                placeholder="Mínimo 8 caracteres"
                style={inputStyle} autoComplete="new-password"
              />
              {fortaleza && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ height: 4, borderRadius: 4, background: "#E5E7EB", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      width: fortaleza.width, background: fortaleza.color,
                      transition: "width 0.3s, background 0.3s",
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: fortaleza.color, fontWeight: 600, marginTop: 3, display: "block" }}>
                    {fortaleza.label}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label style={labelStyle}>Confirmar nueva contraseña *</label>
              <input
                type="password" value={confirmar}
                onChange={e => { setConfirmar(e.target.value); resetError(); }}
                placeholder="Repite la nueva contraseña"
                style={{ ...inputStyle, borderColor: confirmar && nueva !== confirmar ? "#FCA5A5" : "#E5E7EB" }}
                autoComplete="new-password"
              />
              {confirmar && nueva !== confirmar && (
                <span style={{ fontSize: 11, color: "#EF4444", marginTop: 3, display: "block" }}>
                  Las contraseñas no coinciden.
                </span>
              )}
              {confirmar && nueva === confirmar && nueva.length >= 8 && (
                <span style={{ fontSize: 11, color: "#16A34A", marginTop: 3, display: "block" }}>
                  ✓ Las contraseñas coinciden.
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Panel: Correo ───────────────────────────────────────── */}
        {tab === "email" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: "#EFF6FF", border: "1px solid #BFDBFE",
              borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#1E40AF",
              display: "flex", gap: 8, alignItems: "flex-start",
            }}>
              <i className="ti ti-info-circle" style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              Se enviará un enlace de confirmación al nuevo correo. El cambio se aplica al hacer clic en ese enlace.
            </div>

            <div>
              <label style={labelStyle}>Contraseña actual * (para verificar)</label>
              <input
                type="password" value={passwordEmail}
                onChange={e => { setPasswordEmail(e.target.value); resetError(); }}
                placeholder="Tu contraseña actual"
                style={inputStyle} autoComplete="current-password"
              />
            </div>

            <div>
              <label style={labelStyle}>Nuevo correo electrónico *</label>
              <input
                type="email" value={nuevoEmail}
                onChange={e => { setNuevoEmail(e.target.value); resetError(); }}
                placeholder="nuevo@correo.com"
                style={inputStyle} autoComplete="email"
              />
            </div>

            <div>
              <label style={labelStyle}>Confirmar nuevo correo *</label>
              <input
                type="email" value={confirmarEmail}
                onChange={e => { setConfirmarEmail(e.target.value); resetError(); }}
                placeholder="Repite el nuevo correo"
                style={{
                  ...inputStyle,
                  borderColor: confirmarEmail && nuevoEmail !== confirmarEmail ? "#FCA5A5" : "#E5E7EB",
                }}
                autoComplete="email"
              />
              {confirmarEmail && nuevoEmail !== confirmarEmail && (
                <span style={{ fontSize: 11, color: "#EF4444", marginTop: 3, display: "block" }}>
                  Los correos no coinciden.
                </span>
              )}
              {confirmarEmail && nuevoEmail === confirmarEmail && emailValido(nuevoEmail) && (
                <span style={{ fontSize: 11, color: "#16A34A", marginTop: 3, display: "block" }}>
                  ✓ Los correos coinciden.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error general */}
        {error && (
          <div style={{
            background: "#FEF2F2", color: "#DC2626", borderRadius: 8,
            padding: "10px 14px", fontSize: 13, marginTop: 14,
          }}>
            <i className="ti ti-alert-circle" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 6 }} aria-hidden="true" />
            {error}
          </div>
        )}

        {/* Botones */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onCerrar}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8,
              border: "1px solid #E5E7EB", background: "#F9FAFB",
              color: "#374151", cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}>
            Cancelar
          </button>
          <button
            onClick={tab === "password" ? handleGuardarPassword : handleGuardarEmail}
            disabled={(tab === "password" ? !validoPassword : !validoEmail) || guardando}
            style={{
              flex: 2, padding: "10px 0", borderRadius: 8, border: "none",
              background: ((tab === "password" ? validoPassword : validoEmail) && !guardando) ? "#2563EB" : "#E5E7EB",
              color:      ((tab === "password" ? validoPassword : validoEmail) && !guardando) ? "#fff"    : "#94A3B8",
              cursor:     ((tab === "password" ? validoPassword : validoEmail) && !guardando) ? "pointer" : "not-allowed",
              fontSize: 13, fontWeight: 700,
            }}>
            {guardando
              ? "Actualizando…"
              : tab === "password"
                ? <><i className="ti ti-key"  style={{ fontSize: 14, verticalAlign: "middle", marginRight: 6 }} aria-hidden="true" />Actualizar contraseña</>
                : <><i className="ti ti-mail" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 6 }} aria-hidden="true" />Actualizar correo</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
