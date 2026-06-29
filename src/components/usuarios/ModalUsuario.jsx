/**
 * usuarios/ModalUsuario.jsx
 *
 * Modal de creación y edición de usuarios.
 * Props:
 *   usuario   — objeto usuario existente (null/undefined = modo "nuevo")
 *   roles     — lista de roles disponibles
 *   programas — lista de programas disponibles
 *   onSave    — callback tras guardar con éxito
 *   onClose   — callback para cerrar sin guardar
 *   showToast — función de toast global
 *   logAudit  — función de auditoría
 */

import React, { useState } from "react";
import { supabase } from "../../lib/supabase";
import { S } from "../../constants";
import { Spinner } from "./shared";
import { validarPassword } from "../../utils/password";

export default function ModalUsuario({ usuario, roles, programas, onSave, onClose, showToast, logAudit }) {
  const esNuevo = !usuario?.id;
  const [form, setForm] = useState({
    email:    usuario?.email    || "",
    nombre:   usuario?.nombre   || "",
    rol:      usuario?.rol      || (roles[0]?.nombre || ""),
    programa: usuario?.programa || "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const rolSeleccionado = roles.find(r => r.nombre === form.rol);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    setError("");
    if (!form.email.trim())  return setError("El email es obligatorio.");
    if (!form.nombre.trim()) return setError("El nombre es obligatorio.");
    if (!form.rol)           return setError("Selecciona un rol.");
    if (rolSeleccionado?.restringe_programa && !form.programa)
      return setError("Este rol requiere un programa asignado.");
    if (esNuevo) {
      const errorPwd = validarPassword(form.password);
      if (errorPwd) return setError(errorPwd);
    }

    setSaving(true);
    try {
      const programa = rolSeleccionado?.restringe_programa ? form.programa : null;

      if (esNuevo) {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/admin-users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            action:   "create",
            email:    form.email.trim(),
            password: form.password,
            nombre:   form.nombre.trim(),
            rol:      form.rol,
            programa: rolSeleccionado?.restringe_programa ? form.programa : null,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al crear usuario.");

        await logAudit?.({
          accion:  "CREAR_USUARIO",
          entidad: "usuarios",
          resumen: `Usuario creado: ${form.email.trim()} (${form.rol}${rolSeleccionado?.restringe_programa ? ` - ${form.programa}` : ""})`,
        });
        showToast?.(`Usuario ${form.email.trim()} creado.`, "success");

      } else {
        const { error: profileError } = await supabase.rpc("admin_upsert_user_profile", {
          p_user_id:  usuario.id,
          p_email:    form.email.trim(),
          p_nombre:   form.nombre.trim(),
          p_rol:      form.rol,
          p_programa: programa,
        });
        if (profileError) throw new Error(profileError.message);

        let passwordReseteada = false;
        if (form.password.trim()) {
          const errorPwd = validarPassword(form.password);
          if (errorPwd) throw new Error(errorPwd);
          const { data: { session } } = await supabase.auth.getSession();
          const pwRes = await fetch("/api/admin-users", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ action: "reset_password", user_id: usuario.id, password: form.password }),
          });
          const pwJson = await pwRes.json();
          if (!pwRes.ok) {
            showToast?.(
              "Perfil actualizado pero no se pudo cambiar la contraseña: " + pwJson.error,
              "warning"
            );
            onSave();
            return;
          }
          passwordReseteada = true;
        }

        if (passwordReseteada) {
          await logAudit?.({
            accion:     "RESET_PASSWORD_ADMIN",
            entidad:    "usuarios",
            entidad_id: usuario.id,
            resumen:    `Contraseña reseteada por admin para: ${form.email.trim()}`,
          });
        }

        await logAudit?.({
          accion:     "EDITAR_USUARIO",
          entidad:    "usuarios",
          entidad_id: usuario.id,
          resumen: `Usuario editado: ${form.email.trim()} (${form.rol}${programa ? ` - ${programa}` : ""}${passwordReseteada ? " · contraseña reseteada" : ""})`,
        });
        showToast?.(`Usuario ${form.email.trim()} actualizado.`, "success");
      }
      onSave();
    } catch (e) {
      setError(e.message || "Error al guardar.");
    }
    setSaving(false);
  };

  const inputStyle = { ...S.input, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 14, padding: 28, maxWidth: 480, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", gap: 18,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 17, color: "var(--color-text-primary)", fontWeight: 700 }}>
            {esNuevo ? "Nuevo usuario" : "Editar usuario"}
          </h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 20, color: "var(--color-text-tertiary)", lineHeight: 1,
          }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { field: "nombre", label: "Nombre completo",  placeholder: "Ej: María González", type: "text" },
            { field: "email",  label: "Email",            placeholder: "correo@ejemplo.com",  type: "email", disabled: !esNuevo },
          ].map(({ field, label, placeholder, type, disabled }) => (
            <div key={field}>
              <label style={{
                fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
                textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5,
              }}>{label}</label>
              <input
                style={inputStyle}
                value={form[field]}
                onChange={set(field)}
                placeholder={placeholder}
                type={type}
                disabled={disabled}
              />
            </div>
          ))}

          <div>
            <label style={{
              fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
              textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5,
            }}>
              {esNuevo ? "Contraseña inicial" : "Nueva contraseña (dejar vacío para no cambiar)"}
            </label>
            <input
              style={inputStyle}
              value={form.password}
              onChange={set("password")}
              type="password"
              placeholder={esNuevo ? "Mínimo 8 caracteres" : "••••••••"}
            />
          </div>

          <div>
            <label style={{
              fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
              textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5,
            }}>Rol</label>
            <select style={{ ...S.select, width: "100%" }} value={form.rol} onChange={set("rol")}>
              {roles.map(r => (
                <option key={r.nombre} value={r.nombre}>{r.emoji} {r.label}</option>
              ))}
            </select>
            {rolSeleccionado && (
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {rolSeleccionado.restringe_programa
                  ? "Este rol restringe la vista a un solo programa — debes asignar uno."
                  : "✓ Acceso sin restricción de programa."}
              </p>
            )}
          </div>

          {rolSeleccionado?.restringe_programa && (
            <div>
              <label style={{
                fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
                textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5,
              }}>Programa asignado</label>
              <select style={{ ...S.select, width: "100%" }} value={form.programa} onChange={set("programa")}>
                <option value="">— Seleccionar programa —</option>
                {programas.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div style={{
            background: "var(--color-danger-bg)", border: "1px solid var(--color-danger-light)",
            borderRadius: 8, padding: "10px 14px", color: "var(--color-danger)", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ ...S.btn(false), padding: "9px 20px" }} disabled={saving}>
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "9px 20px", borderRadius: 8, border: "none",
              cursor: saving ? "not-allowed" : "pointer",
              background: "var(--brand-500)", color: "#fff", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 8, opacity: saving ? 0.7 : 1,
            }}
          >
            {saving && <Spinner />}
            {saving ? "Guardando…" : (esNuevo ? "Crear usuario" : "Guardar cambios")}
          </button>
        </div>
      </div>
    </div>
  );
}
