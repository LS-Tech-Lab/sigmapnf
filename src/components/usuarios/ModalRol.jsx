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
  hex2rgba,
  Badge,
  Spinner,
} from "./shared";
import useFocusTrap from "../../hooks/useFocusTrap";

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
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        zIndex: 1000, padding: 16, overflowY: "auto",
      }}
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        style={{
          background: "#fff", borderRadius: 14, padding: 28, maxWidth: 620, width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)", margin: "auto",
          display: "flex", flexDirection: "column", gap: 20,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-rol-titulo"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="modal-rol-titulo" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {esNuevo ? "Nuevo rol" : `Editar rol: ${rol.label}`}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 20, color: "var(--color-text-tertiary)",
          }}>✕</button>
        </div>

        {/* Campos básicos */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          {esNuevo && (
            <div style={{ gridColumn: "1/-1" }}>
              <label htmlFor="rol-field-nombre" style={{
                fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
                textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5,
              }}>
                Identificador (slug){" "}
                <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>— no se puede cambiar luego</span>
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

          <div style={{ gridColumn: "1/-1" }}>
            <label htmlFor="rol-field-label" style={{
              fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
              textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5,
            }}>Nombre visible</label>
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
            <label style={{
              fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
              textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5,
            }}>Emoji</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EMOJIS_PRESET.map(e => (
                <button key={e} onClick={() => set("emoji")(e)} style={{
                  fontSize: 18, cursor: "pointer",
                  background: form.emoji === e ? "var(--color-background-info)" : "var(--color-background-secondary)",
                  border: `2px solid ${form.emoji === e ? "var(--brand-500)" : "var(--color-border-tertiary)"}`,
                  borderRadius: 8, padding: "4px 8px", lineHeight: 1,
                }}>{e}</button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label style={{
              fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
              textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5,
            }}>Color</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {COLORES_PRESET.map(c => (
                <button key={c} onClick={() => set("color")(c)} title={c} style={{
                  width: 24, height: 24, borderRadius: 6, background: c, cursor: "pointer",
                  border: `3px solid ${form.color === c ? "var(--color-text-primary)" : "transparent"}`,
                  boxSizing: "border-box",
                }} />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={e => set("color")(e.target.value)}
                style={{ width: 28, height: 28, border: "none", cursor: "pointer", borderRadius: 6, padding: 0 }}
                title="Color personalizado"
              />
            </div>
          </div>
        </div>

        {/* Restricción de programa */}
        <label style={{
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          background: "var(--color-background-secondary)",
          border: "1px solid var(--color-border-tertiary)", borderRadius: 10, padding: "12px 14px",
        }}>
          <input
            type="checkbox"
            checked={form.restringe_programa}
            onChange={e => set("restringe_programa")(e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--brand-500)" }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
              Restringir a un programa
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>
              Los usuarios con este rol solo verán los datos del programa que se les asigne al crearlos.
            </div>
          </div>
        </label>

        {/* Vista previa */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Vista previa:</span>
          <Badge color={form.color}>{form.emoji} {form.label || "Nombre del rol"}</Badge>
        </div>

        {/* Permisos */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
              Permisos ({contarPermisos}/{TODOS_LOS_PERMISOS.length})
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
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

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {GRUPOS_PERMISOS.map(g => (
              <div key={g.grupo} style={{
                background: "var(--color-background-secondary)",
                border: "1px solid var(--color-border-tertiary)",
                borderRadius: 10, overflow: "hidden",
              }}>
                <div style={{
                  padding: "10px 14px", borderBottom: "1px solid var(--color-border-tertiary)",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <i className={`ti ${g.icono}`} style={{ color: "var(--color-text-tertiary)", fontSize: 14 }} />
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>{g.grupo}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                    {g.items.filter(i => form.permisos[i.key]).length}/{g.items.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {g.items.map((item, idx) => (
                    <label key={item.key} style={{
                      display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px",
                      cursor: "pointer",
                      borderTop: idx > 0 ? "1px solid var(--color-background-tertiary)" : "none",
                      background: form.permisos[item.key] ? hex2rgba(form.color, 0.05) : "transparent",
                      transition: "background 0.1s",
                    }}>
                      <input
                        type="checkbox"
                        checked={!!form.permisos[item.key]}
                        onChange={e => setPerm(item.key)(e.target.checked)}
                        style={{ width: 15, height: 15, marginTop: 1, cursor: "pointer",
                          accentColor: form.color, flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 1 }}>{item.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div style={{
            background: "var(--color-danger-bg)", border: "1px solid var(--color-danger-light)",
            borderRadius: 8, padding: "10px 14px", color: "var(--color-danger)", fontSize: 13,
          }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} className="s-btn s-btn--cancel" disabled={saving}>
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
            {saving ? "Guardando…" : (esNuevo ? "Crear rol" : "Guardar cambios")}
          </button>
        </div>
      </div>
    </div>
  );
}
