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
 *   programas    — lista de programas disponibles (catálogo completo,
 *                  sin filtrar por sede)
 *   sedes        — lista de sedes disponibles ({id, nombre}) — SEDE-2
 *   sedeProgramaActivo — PROG-4 (12 ago 2026): mapa { sede_id:
 *                  Set<nombrePrograma> } de qué programas están activos
 *                  en cada sede (migración 0090). Con `form.sede_id`
 *                  elegido, el checklist de abajo se filtra a los
 *                  programas activos en ESA sede (unión con lo que el
 *                  usuario ya tuviera asignado, para no ocultar en
 *                  silencio una asignación previa que quedó inactiva).
 *                  Sin sede elegida todavía (o si no llega el mapa),
 *                  cae de vuelta al catálogo completo — mismo criterio
 *                  que useProgramasActivosPorSede.js.
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

export default function ModalUsuario({ usuario, esActorAdmin = false, roles, programas, sedes, sedeProgramaActivo, onSave, onClose, showToast, logAudit }) {
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
  // UX-43 (auditoría UI/UX de élite, 15 ago): antes handleSave() validaba
  // secuencialmente con `return` en el primer campo inválido — un usuario
  // con 3 errores a la vez necesitaba 3 intentos de "Guardar" para
  // enterarse de todos, y el único mensaje vivía en un banner genérico al
  // final del modal, sin `aria-invalid` ni asociación al campo. Ahora se
  // valida todo de una vez en `validar()` y cada campo muestra su propio
  // error junto al input. `error` queda solo para fallos del guardado en
  // sí (red, RPC, API) — no para validación de formulario.
  const [fieldErrors, setFieldErrors] = useState({});

  const rolSeleccionado = roles.find(r => r.nombre === form.rol);
  // PROG-4: catálogo de programas filtrado a los activos en la sede
  // elegida (unión con lo ya asignado, ver doc del prop arriba).
  const programasVisibles = React.useMemo(() => {
    const activosEnSede = form.sede_id ? sedeProgramaActivo?.[form.sede_id] : null;
    if (!activosEnSede) return programas;
    const permitidos = new Set([...activosEnSede, ...form.programas]);
    return programas.filter(p => permitidos.has(p));
  }, [programas, sedeProgramaActivo, form.sede_id, form.programas]);
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

  const validar = () => {
    const errores = {};
    if (!form.nombre.trim()) errores.nombre = "El nombre es obligatorio.";
    if (!form.email.trim())  errores.email  = "El email es obligatorio.";
    if (!form.rol)           errores.rol    = "Selecciona un rol.";
    if (rolSeleccionado?.restringe_programa && form.programas.length === 0)
      errores.programas = "Este rol requiere al menos un programa asignado.";
    if (!rolVeTodasSedes && !form.sede_id)
      errores.sede_id = "Este rol requiere una sede asignada.";
    if (esNuevo) {
      const errorPwd = validarPassword(form.password);
      if (errorPwd) errores.password = errorPwd;
    }
    return errores;
  };

  const handleSave = async () => {
    setError("");
    const errores = validar();
    setFieldErrors(errores);
    if (Object.keys(errores).length > 0) {
      // Mueve el foco al primer campo inválido en vez de dejarlo en el
      // botón "Guardar" — el orden sigue el orden visual del formulario,
      // no el orden en que se insertaron las claves del objeto.
      const orden = ["nombre", "email", "password", "rol", "programas", "sede_id"];
      const primerCampo = orden.find(f => errores[f]);
      document.getElementById(`usr-field-${primerCampo}`)?.focus();
      return;
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
                aria-invalid={!!fieldErrors[field]}
                aria-describedby={fieldErrors[field] ? `usr-field-${field}-error` : undefined}
              />
              {fieldErrors[field] && (
                <p id={`usr-field-${field}-error`} className="mu-field-error">{fieldErrors[field]}</p>
              )}
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
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? "usr-field-password-error" : undefined}
            />
            {fieldErrors.password && (
              <p id="usr-field-password-error" className="mu-field-error">{fieldErrors.password}</p>
            )}
          </div>

          <div>
            <label htmlFor="usr-field-rol" className="mu-field-label">Rol</label>
            <select
              id="usr-field-rol"
              className="s-select s-select--full"
              value={form.rol}
              onChange={set("rol")}
              aria-invalid={!!fieldErrors.rol}
              aria-describedby={fieldErrors.rol ? "usr-field-rol-error" : undefined}
            >
              {rolesVisibles.map(r => (
                <option key={r.nombre} value={r.nombre}>{r.emoji} {r.label}</option>
              ))}
            </select>
            {fieldErrors.rol && <p id="usr-field-rol-error" className="mu-field-error">{fieldErrors.rol}</p>}
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
              <div
                id="usr-field-programas"
                className="mu-programas-lista"
                role="group"
                aria-label="Programas asignados"
                aria-invalid={!!fieldErrors.programas}
                aria-describedby={fieldErrors.programas ? "usr-field-programas-error" : undefined}
                tabIndex={-1}
              >
                {programasVisibles.map(p => (
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
              {fieldErrors.programas && (
                <p id="usr-field-programas-error" className="mu-field-error">{fieldErrors.programas}</p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="usr-field-sede_id" className="mu-field-label">
              {rolVeTodasSedes ? "Sede de origen (opcional)" : "Sede asignada"}
            </label>
            <select
              id="usr-field-sede_id"
              className="s-select s-select--full"
              value={form.sede_id}
              onChange={set("sede_id")}
              aria-invalid={!!fieldErrors.sede_id}
              aria-describedby={fieldErrors.sede_id ? "usr-field-sede_id-error" : undefined}
            >
              <option value="">
                {rolVeTodasSedes ? "— Sin sede fija (ve todas) —" : "— Seleccionar sede —"}
              </option>
              {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            {fieldErrors.sede_id && <p id="usr-field-sede_id-error" className="mu-field-error">{fieldErrors.sede_id}</p>}
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
// PROG-4 (12 ago 2026): se agrega `sedeProgramaActivo` (mapa opcional,
// ver doc del prop arriba) — sin ella el componente se comporta como
// antes (catálogo completo sin filtrar por sede).
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
  sedeProgramaActivo: PropTypes.objectOf(PropTypes.instanceOf(Set)),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  showToast: PropTypes.func,
  logAudit: PropTypes.func,
};
