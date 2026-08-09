/**
 * usuarios/ModalUsuario.jsx
 *
 * Modal de creación y edición de usuarios.
 * Props:
 *   usuario      — objeto usuario existente (null/undefined = modo "nuevo")
 *   esActorAdmin — true si quien usa el modal tiene rol === "admin"
 *                  (SEC-15/migración 0050). Con false, "admin" se oculta
 *                  del selector de rol — el backend ya lo rechazaría,
 *                  esto solo evita que alguien llegue a ese error. Por
 *                  diseño, PestanaUsuarios ya bloquea el botón "Editar"
 *                  sobre una fila admin cuando esActorAdmin es false, así
 *                  que en la práctica `usuario` nunca llega aquí con
 *                  rol === "admin" en ese caso — el filtro de abajo es
 *                  además una segunda barrera, no la única.
 *   roles        — lista de roles disponibles
 *   programas    — lista de programas disponibles
 *   sedes        — lista de sedes disponibles ({id, nombre}) — SEDE-2
 *   onSave       — callback tras guardar con éxito
 *   onClose      — callback para cerrar sin guardar
 *   showToast    — función de toast global
 *   logAudit     — función de auditoría
 */

import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { supabase } from "../../lib/supabase";
import { Spinner } from "./shared";
import { validarPassword } from "../../utils/password";
import useFocusTrap from "../../hooks/useFocusTrap";
import "./ModalUsuario.css";

export default function ModalUsuario({ usuario, esActorAdmin = false, roles, programas, sedes, onSave, onClose, showToast, logAudit }) {
  const esNuevo = !usuario?.id;
  const rolesVisibles = esActorAdmin ? roles : roles.filter(r => r.nombre !== "admin");
  // PROG-3 (fase 1): `usuario.programas` (array) viene de
  // admin_get_user_profiles_programas() cuando existe algo en
  // user_profiles_programas (0078/0079) — PestanaUsuarios lo mezcla en
  // cada fila antes de pasarla acá. Si no hay nada ahí todavía (usuario
  // creado antes de esta migración, o recién editado sin re-cargar), se
  // cae de vuelta al valor de la columna escalar legada `usuario.programa`
  // como lista de un solo elemento — mismo dato, sin perder nada.
  const programasIniciales = Array.isArray(usuario?.programas) && usuario.programas.length > 0
    ? usuario.programas
    : (usuario?.programa ? [usuario.programa] : []);
  const [form, setForm] = useState({
    email:     usuario?.email    || "",
    nombre:    usuario?.nombre   || "",
    rol:       usuario?.rol      || (rolesVisibles[0]?.nombre || ""),
    programas: programasIniciales,
    sede_id:   usuario?.sede_id  || "",
    password:  "",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const rolSeleccionado = roles.find(r => r.nombre === form.rol);
  // SEDE-2: mismo criterio que restringe_programa pero a la inversa —
  // casi todos los roles requieren sede, salvo quien tenga
  // puedeVerTodasLasSedes (admin, coordinador general).
  const rolVeTodasSedes = !!rolSeleccionado?.permisos?.puedeVerTodasLasSedes;
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const toggleProgramaSeleccionado = (p) => {
    setForm(f => ({
      ...f,
      programas: f.programas.includes(p)
        ? f.programas.filter(x => x !== p)
        : [...f.programas, p],
    }));
  };

  const handleSave = async () => {
    setError("");
    if (!form.email.trim())  return setError("El email es obligatorio.");
    if (!form.nombre.trim()) return setError("El nombre es obligatorio.");
    if (!form.rol)           return setError("Selecciona un rol.");
    if (rolSeleccionado?.restringe_programa && form.programas.length === 0)
      return setError("Este rol requiere al menos un programa asignado.");
    if (!rolVeTodasSedes && !form.sede_id)
      return setError("Este rol requiere una sede asignada.");
    if (esNuevo) {
      const errorPwd = validarPassword(form.password);
      if (errorPwd) return setError(errorPwd);
    }

    setSaving(true);
    try {
      // PROG-3: lista completa solo si el rol restringe programa —
      // igual criterio que admin_set_user_programas (0079) del lado del
      // servidor: un rol que no restringe no guarda ninguno.
      const listaProgramas = rolSeleccionado?.restringe_programa ? form.programas : [];
      const programaPrincipal = listaProgramas[0] || null;
      const sedeId   = rolVeTodasSedes ? (form.sede_id || null) : form.sede_id;

      if (esNuevo) {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/admin-users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            action:    "create",
            email:     form.email.trim(),
            password:  form.password,
            nombre:    form.nombre.trim(),
            rol:       form.rol,
            programas: listaProgramas,
            sede_id:   sedeId,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al crear usuario.");

        await logAudit?.({
          accion:  "CREAR_USUARIO",
          entidad: "usuarios",
          resumen: `Usuario creado: ${form.email.trim()} (${form.rol}${listaProgramas.length ? ` - ${listaProgramas.join(", ")}` : ""}${sedeId ? ` - ${sedeId}` : ""})`,
        });
        showToast?.(`Usuario ${form.email.trim()} creado.`, "success");

      } else {
        const { error: profileError } = await supabase.rpc("admin_upsert_user_profile", {
          p_user_id:  usuario.id,
          p_email:    form.email.trim(),
          p_nombre:   form.nombre.trim(),
          p_rol:      form.rol,
          p_programa: programaPrincipal,
          p_sede_id:  sedeId,
        });
        if (profileError) throw new Error(profileError.message);

        // PROG-3: reemplaza el conjunto completo en user_profiles_programas
        // (0079) — llamada aparte, mismo patrón que ya usa este flujo para
        // el reset de contraseña más abajo. Si esto falla, el perfil base
        // ya se guardó (igual que si fallara el reset de password); se
        // avisa sin descartar el resto del guardado.
        const { error: programasError } = await supabase.rpc("admin_set_user_programas", {
          p_user_id:   usuario.id,
          p_programas: listaProgramas,
        });
        if (programasError) {
          showToast?.(
            "Perfil actualizado pero no se pudieron guardar los programas: " + programasError.message,
            "warning"
          );
        }

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
          resumen: `Usuario editado: ${form.email.trim()} (${form.rol}${listaProgramas.length ? ` - ${listaProgramas.join(", ")}` : ""}${passwordReseteada ? " · contraseña reseteada" : ""})`,
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
              {rolesVisibles.map(r => (
                <option key={r.nombre} value={r.nombre}>{r.emoji} {r.label}</option>
              ))}
            </select>
            {rolSeleccionado && (
              <p className="mu-field-hint">
                {rolSeleccionado.restringe_programa
                  ? "Este rol restringe la vista por programa — debes asignar al menos uno."
                  : "✓ Acceso sin restricción de programa."}
              </p>
            )}
          </div>

          {rolSeleccionado?.restringe_programa && (
            <div>
              <span className="mu-field-label">
                Programa(s) asignado(s) {form.programas.length > 1 && `(${form.programas.length} seleccionados)`}
              </span>
              {/* PROG-3 (fase 1): multi-select vía checkboxes — un
                  coordinador puede tener más de un programa a cargo
                  (0078/0079). El primero marcado queda como "principal"
                  en la columna escalar legada, sin que el orden importe
                  para el acceso real (eso lo resuelve la tabla N:N). */}
              <div className="mu-programas-lista" role="group" aria-label="Programas asignados">
                {programas.map(p => (
                  <label key={p} className="mu-programa-item">
                    <input
                      type="checkbox"
                      checked={form.programas.includes(p)}
                      onChange={() => toggleProgramaSeleccionado(p)}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="usr-field-sede" className="mu-field-label">
              {rolVeTodasSedes ? "Sede de origen (opcional)" : "Sede asignada"}
            </label>
            <select id="usr-field-sede" className="s-select s-select--full" value={form.sede_id} onChange={set("sede_id")}>
              <option value="">
                {rolVeTodasSedes ? "— Sin sede fija (ve todas) —" : "— Seleccionar sede —"}
              </option>
              {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <p className="mu-field-hint">
              {rolVeTodasSedes
                ? "Este rol tiene acceso a todas las sedes — la sede es solo informativa."
                : "Este usuario solo verá datos de la sede seleccionada."}
            </p>
          </div>
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

// Fix ARCH-20 (auditoría 12 de julio): PropTypes agregado como contrato de
// props — no cambia comportamiento. El shape de `usuario`/`roles` refleja
// exactamente los campos que este archivo lee (ver uso de `usuario?.email`,
// `r.nombre`/`r.label`/`r.emoji`/`r.restringe_programa` arriba); `programas`
// es un array de strings (nombres de PNF), confirmado contra el único
// caller real (`PestanaUsuarios.jsx`).
// SEDE-2: se agrega `usuario.sede_id`, `roles[].permisos` (ya lo trae
// `admin_get_roles`, ver 0019, solo faltaba declararlo acá) y la prop
// nueva `sedes`.
// PROG-3 (fase 1): se agrega `usuario.programas` (array, opcional —
// viene de admin_get_user_profiles_programas() vía PestanaUsuarios).
// `usuario.programa` (escalar) se conserva como fallback, ver
// programasIniciales arriba.
ModalUsuario.propTypes = {
  usuario: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    email: PropTypes.string,
    nombre: PropTypes.string,
    rol: PropTypes.string,
    programa: PropTypes.string,
    programas: PropTypes.arrayOf(PropTypes.string),
    sede_id: PropTypes.string,
  }),
  esActorAdmin: PropTypes.bool,
  roles: PropTypes.arrayOf(PropTypes.shape({
    nombre: PropTypes.string.isRequired,
    label: PropTypes.string,
    emoji: PropTypes.string,
    restringe_programa: PropTypes.bool,
    permisos: PropTypes.object,
  })).isRequired,
  programas: PropTypes.arrayOf(PropTypes.string).isRequired,
  sedes: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    nombre: PropTypes.string.isRequired,
  })).isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  showToast: PropTypes.func,
  logAudit: PropTypes.func,
};
