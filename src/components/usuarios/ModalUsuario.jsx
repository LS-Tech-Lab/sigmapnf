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

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { Spinner } from "./shared";
import { validarPassword } from "../../utils/password";
import useFocusTrap from "../../hooks/useFocusTrap";
import "./ModalUsuario.css";

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

  const inputClass = "s-input s-input--full";

  // Accesibilidad: foco al primer campo al abrir + Escape para cerrar
  const firstInputRef = useRef(null);
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, true);
  useEffect(() => {
    firstInputRef.current?.focus();
    const handleKeyDown = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="mu-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="mu-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-usuario-titulo"
        onClick={e => e.stopPropagation()}
      >
        <div className="mu-header">
          <h2 id="modal-usuario-titulo" className="mu-title">
            {esNuevo ? "Nuevo usuario" : "Editar usuario"}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="mu-close">✕</button>
        </div>

        <div className="mu-fields">
          {[
            { field: "nombre", label: "Nombre completo",  placeholder: "Ej: María González", type: "text" },
            { field: "email",  label: "Email",            placeholder: "correo@ejemplo.com",  type: "email", disabled: !esNuevo },
          ].map(({ field, label, placeholder, type, disabled }, idx) => (
            <div key={field}>
              <label htmlFor={`usr-field-${field}`} className="mu-field-label">{label}</label>
              <input
                id={`usr-field-${field}`}
                ref={idx === 0 ? firstInputRef : undefined}
                className={inputClass}
                value={form[field]}
                onChange={set(field)}
                placeholder={placeholder}
                type={type}
                disabled={disabled}
              />
            </div>
          ))}

          <div>
            <label htmlFor="usr-field-password" className="mu-field-label">
              {esNuevo ? "Contraseña inicial" : "Nueva contraseña (dejar vacío para no cambiar)"}
            </label>
            <input
              id="usr-field-password"
              className={inputClass}
              value={form.password}
              onChange={set("password")}
              type="password"
              placeholder={esNuevo ? "Mínimo 8 caracteres" : "••••••••"}
            />
          </div>

          <div>
            <label htmlFor="usr-field-rol" className="mu-field-label">Rol</label>
            <select id="usr-field-rol" className="s-select s-select--full" value={form.rol} onChange={set("rol")}>
              {roles.map(r => (
                <option key={r.nombre} value={r.nombre}>{r.emoji} {r.label}</option>
              ))}
            </select>
            {rolSeleccionado && (
              <p className="mu-field-hint">
                {rolSeleccionado.restringe_programa
                  ? "Este rol restringe la vista a un solo programa — debes asignar uno."
                  : "✓ Acceso sin restricción de programa."}
              </p>
            )}
          </div>

          {rolSeleccionado?.restringe_programa && (
            <div>
              <label htmlFor="usr-field-programa" className="mu-field-label">Programa asignado</label>
              <select id="usr-field-programa" className="s-select s-select--full" value={form.programa} onChange={set("programa")}>
                <option value="">— Seleccionar programa —</option>
                {programas.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="mu-error">
            {error}
          </div>
        )}

        <div className="mu-actions">
          <button onClick={onClose} className="s-btn s-btn--cancel" disabled={saving}>
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="mu-btn-save"
          >
            {saving && <Spinner />}
            {saving ? "Guardando…" : (esNuevo ? "Crear usuario" : "Guardar cambios")}
          </button>
        </div>
      </div>
    </div>
  );
}
