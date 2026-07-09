/**
 * usuarios/ModalRol.jsx
 *
 * Modal de creación y edición de roles con editor de permisos granular.
 * Props:
 *   rol      — objeto rol existente (null = modo "nuevo")
 *   onSave   — callback tras guardar con éxito
 *   onClose  — callback para cerrar sin guardar
 *   logAudit — función de auditoría
 */

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import {
  GRUPOS_PERMISOS,
  TODOS_LOS_PERMISOS,
  COLORES_PRESET,
  EMOJIS_PRESET,
  Badge,
  Spinner,
} from "./shared";
import { roleColorClass } from "../../constants";
import useFocusTrap from "../../hooks/useFocusTrap";
import "./ModalRol.css";

export default function ModalRol({ rol, onSave, onClose, logAudit }) {
  const esNuevo = !rol;
  const [form, setForm] = useState({
    nombre:             rol?.nombre             || "",
    label:              rol?.label              || "",
    emoji:              rol?.emoji              || "👤",
    color:              rol?.color              || "var(--color-text-mid)",
    restringe_programa: rol?.restringe_programa || false,
    permisos: {
      ...Object.fromEntries(TODOS_LOS_PERMISOS.map(k => [k, false])),
      ...(rol?.permisos || {}),
    },
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const set    = (k) => (v) => setForm(f => ({ ...f, [k]: v }));
  const setPerm = (k) => (v) => setForm(f => ({ ...f, permisos: { ...f.permisos, [k]: v } }));
  const contarPermisos = Object.values(form.permisos).filter(Boolean).length;

  // Accesibilidad: foco al primer campo + Escape para cerrar
  const firstInputRef = useRef(null);
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, true);
  useEffect(() => {
    firstInputRef.current?.focus();
    const handleKeyDown = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    setError("");
    if (!form.label.trim()) return setError("El nombre del rol es obligatorio.");
    if (esNuevo) {
      if (!form.nombre.trim()) return setError("El identificador es obligatorio.");
      if (!/^[a-z0-9_]+$/.test(form.nombre.trim()))
        return setError("El identificador solo puede tener minúsculas, números y guion bajo (sin espacios).");
    }

    setSaving(true);
    try {
      const nombreRol = esNuevo ? form.nombre.trim() : rol.nombre;
      const { error: err } = await supabase.rpc("admin_upsert_role", {
        p_nombre:             nombreRol,
        p_label:              form.label.trim(),
        p_emoji:              form.emoji,
        p_color:              form.color,
        p_restringe_programa: form.restringe_programa,
        p_permisos:           form.permisos,
      });
      if (err) throw err;

      const permisosActivos = Object.entries(form.permisos)
        .filter(([, v]) => v).map(([k]) => k);

      await logAudit?.({
        accion:        esNuevo ? "CREAR_ROL" : "EDITAR_ROL",
        entidad:       "roles",
        entidad_id:    nombreRol,
        resumen:       esNuevo
          ? `Rol creado: "${form.label.trim()}" (${permisosActivos.length} permisos)`
          : `Rol editado: "${form.label.trim()}" → ${permisosActivos.length} permisos activos`,
        datos_antes:   esNuevo ? null : {
          label:              rol.label,
          restringe_programa: rol.restringe_programa,
          permisos:           rol.permisos,
        },
        datos_despues: {
          label:              form.label.trim(),
          restringe_programa: form.restringe_programa,
          permisos:           form.permisos,
        },
      });

      onSave();
    } catch (e) {
      setError(e.message || "Error al guardar el rol.");
    }
    setSaving(false);
  };

  return (
    <div
      className="mr-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="mr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-rol-titulo"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="mr-header">
          <h2 id="modal-rol-titulo" className="mr-title">
            {esNuevo ? "Nuevo rol" : `Editar rol: ${rol.label}`}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="mr-close">✕</button>
        </div>

        {/* Campos básicos */}
        <div className="mr-fields-grid">
          {esNuevo && (
            <div className="mr-field--full">
              <label htmlFor="rol-field-nombre" className="mr-field-label">
                Identificador (slug){" "}
                <span className="mr-field-label-note">— no se puede cambiar luego</span>
              </label>
              <input
                id="rol-field-nombre"
                ref={firstInputRef}
                className="s-input s-input--full"
                onChange={e => set("nombre")(e.target.value.toLowerCase().replace(/\s/g, "_"))}
                placeholder="ej: coord_informatica"
              />
            </div>
          )}

          <div className="mr-field--full">
            <label htmlFor="rol-field-label" className="mr-field-label">Nombre visible</label>
            <input
              id="rol-field-label"
              ref={esNuevo ? undefined : firstInputRef}
              className="s-input s-input--full"
              onChange={e => set("label")(e.target.value)}
              placeholder="Ej: Coordinador de Informática"
            />
          </div>

          {/* Emoji */}
          <div>
            <label className="mr-field-label">Emoji</label>
            <div className="mr-emoji-row">
              {EMOJIS_PRESET.map(e => (
                <button key={e} onClick={() => set("emoji")(e)} className={`mr-emoji-btn${form.emoji === e ? ' mr-emoji-btn--active' : ''}`}>{e}</button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="mr-field-label">Color</label>
            <div className="mr-color-row">
              {COLORES_PRESET.map(c => (
                <button key={c} onClick={() => set("color")(c)} title={c} className={`mr-color-swatch ${roleColorClass(c)}${form.color === c ? ' mr-color-swatch--active' : ''}`} />
              ))}
            </div>
          </div>
        </div>

        {/* Restricción de programa */}
        <label className="mr-restringe-label">
          <input
            type="checkbox"
            checked={form.restringe_programa}
            onChange={e => set("restringe_programa")(e.target.checked)}
            className="mr-restringe-check"
          />
          <div>
            <div className="mr-restringe-title">
              Restringir a un programa
            </div>
            <div className="mr-restringe-desc">
              Los usuarios con este rol solo verán los datos del programa que se les asigne al crearlos.
            </div>
          </div>
        </label>

        {/* Vista previa */}
        <div className="mr-preview-row">
          <span className="mr-preview-label">Vista previa:</span>
          <Badge color={form.color}>{form.emoji} {form.label || "Nombre del rol"}</Badge>
        </div>

        {/* Permisos */}
        <div>
          <div className="mr-permisos-header">
            <h3 className="mr-permisos-title">
              Permisos ({contarPermisos}/{TODOS_LOS_PERMISOS.length})
            </h3>
            <div className="mr-permisos-actions">
              <button
                onClick={() => setForm(f => ({ ...f, permisos: Object.fromEntries(TODOS_LOS_PERMISOS.map(k => [k, true])) }))}
                className="s-btn s-btn--sm"
              >Todos</button>
              <button
                onClick={() => setForm(f => ({ ...f, permisos: Object.fromEntries(TODOS_LOS_PERMISOS.map(k => [k, false])) }))}
                className="s-btn s-btn--sm"
              >Ninguno</button>
            </div>
          </div>

          <div className="mr-grupos-list">
            {GRUPOS_PERMISOS.map(g => (
              <div key={g.grupo} className="mr-grupo">
                <div className="mr-grupo-header">
                  <i className={`ti ${g.icono} mr-grupo-icon`} />
                  <span className="mr-grupo-label">{g.grupo}</span>
                  <span className="mr-grupo-count">
                    {g.items.filter(i => form.permisos[i.key]).length}/{g.items.length}
                  </span>
                </div>
                <div className="mr-items-list">
                  {/* Fix A3/S3 (5/jul/2026): se quitó el <input type="color">
                      libre — form.color ahora solo puede ser uno de los 10
                      COLORES_PRESET (ver arriba), así que este tinte y el
                      accentColor del checkbox ya pueden resolverse con la
                      misma clase fija roleColorClass() que el resto de A3,
                      en vez de quedar como excepción permanente. */}
                  {g.items.map((item, idx) => (
                    <label key={item.key} className={`mr-item${idx > 0 ? ' mr-item--divider' : ''} ${roleColorClass(form.color)}${form.permisos[item.key] ? ' mr-item--checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={!!form.permisos[item.key]}
                        onChange={e => setPerm(item.key)(e.target.checked)}
                        className="mr-item-check"
                      />
                      <div>
                        <div className="mr-item-title">{item.label}</div>
                        <div className="mr-item-desc">{item.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mr-error">{error}</div>
        )}

        <div className="mr-footer">
          <button onClick={onClose} className="s-btn s-btn--cancel" disabled={saving}>
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`mr-btn-save${saving ? ' mr-btn-save--saving' : ''}`}
          >
            {saving && <Spinner />}
            {saving ? "Guardando…" : (esNuevo ? "Crear rol" : "Guardar cambios")}
          </button>
        </div>
      </div>
    </div>
  );
}
