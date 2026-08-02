// ConfiguracionReportes.jsx — ADMIN-6 (auditoría 1 ago 2026)
//
// Pantalla admin-only (permiso puedeConfigurarReportes) para personalizar
// el membrete de los 3 documentos imprimibles del sistema (Reporte Diario,
// Reporte por Rango, Planilla Imprimible): logo, color institucional y
// textos. Vive dentro de AdminModulo.jsx ("Sistema").
//
// La vista previa NO reutiliza reportePlantilla.js/reporte-print.css
// directamente (esa plantilla es HTML crudo para una ventana de impresión
// aislada, pensada para tamaño A4) — se re-implementa como JSX simple con
// las clases de ConfiguracionReportes.css, misma idea visual (membrete con
// logo + nombre + color), sin necesidad de un <iframe>.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { CONFIG_REPORTE_DEFAULT } from "../utils/reportePlantilla";
import "./ConfiguracionReportes.css";

const COLORES_REPORTE = [
  { clase: "rp-color--azul",   label: "Azul" },
  { clase: "rp-color--verde",  label: "Verde" },
  { clase: "rp-color--teal",   label: "Teal" },
  { clase: "rp-color--morado", label: "Morado" },
  { clase: "rp-color--rojo",   label: "Rojo" },
  { clase: "rp-color--ambar",  label: "Ámbar" },
];
const colorSuffix = (claseCompleta) => (claseCompleta || "").replace("rp-color--", "") || "azul";

const LOGO_TIPOS_VALIDOS = ["image/png", "image/jpeg", "image/webp"];
// Mismo límite que el CHECK logo_tamano_maximo de la migración 0056
// (2.000.000 caracteres en base64 ≈ 1.5MB binario) — se valida también acá
// para dar feedback inmediato en vez de esperar el rechazo del INSERT/UPDATE.
const LOGO_TAMANO_MAXIMO_BINARIO = 1_500_000;

const CAMPOS_TEXTO = [
  { key: "nombre_institucion", label: "Nombre de la institución", maxLength: 80 },
  { key: "subtitulo_1",        label: "Subtítulo 1",              maxLength: 100 },
  { key: "subtitulo_2",        label: "Subtítulo 2",              maxLength: 100 },
  { key: "pie_texto",          label: "Texto de pie de página",   maxLength: 150 },
  { key: "firma_label",        label: "Etiqueta de la firma",     maxLength: 80 },
];

export default function ConfiguracionReportes({ showToast, logAudit }) {
  const [form, setForm]         = useState(CONFIG_REPORTE_DEFAULT);
  const [original, setOriginal] = useState(CONFIG_REPORTE_DEFAULT);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const fileInputRef = useRef(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("configuracion_reportes")
        .select("nombre_institucion, subtitulo_1, subtitulo_2, pie_texto, firma_label, logo_base64, color_clase")
        .eq("id", 1)
        .maybeSingle();
      if (err) { setError(err.message); }
      else if (data) { setForm(data); setOriginal(data); }
      // Sin fila (data null, sin error): se queda con el default — no
      // debería pasar (la migración 0056 siembra la fila), pero no rompe
      // la pantalla si pasara.
    } catch (e) {
      setError(e.message || "No se pudo cargar la configuración.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo después
    if (!file) return;

    if (!LOGO_TIPOS_VALIDOS.includes(file.type)) {
      showToast?.("Formato no soportado. Usa PNG, JPG o WEBP.", "error");
      return;
    }
    if (file.size > LOGO_TAMANO_MAXIMO_BINARIO) {
      showToast?.("El logo no puede pesar más de 1.5 MB.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => set("logo_base64")(reader.result);
    reader.onerror = () => showToast?.("No se pudo leer el archivo.", "error");
    reader.readAsDataURL(file);
  };

  const hayCambios = JSON.stringify(form) !== JSON.stringify(original);

  const handleGuardar = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        nombre_institucion: (form.nombre_institucion || "").trim() || CONFIG_REPORTE_DEFAULT.nombre_institucion,
        subtitulo_1:         (form.subtitulo_1 || "").trim(),
        subtitulo_2:         (form.subtitulo_2 || "").trim(),
        pie_texto:           (form.pie_texto || "").trim(),
        firma_label:         (form.firma_label || "").trim(),
        logo_base64:         form.logo_base64 || null,
        color_clase:         form.color_clase,
        updated_at:          new Date().toISOString(),
        updated_by:          userData?.user?.id || null,
      };

      const { error: err } = await supabase
        .from("configuracion_reportes")
        .update(payload)
        .eq("id", 1);
      if (err) throw err;

      await logAudit?.({
        accion:        "CONFIGURAR_REPORTES",
        entidad:       "configuracion_reportes",
        entidad_id:    "1",
        resumen:       "Se actualizó la configuración de branding de los reportes.",
        datos_antes:   original,
        datos_despues: payload,
      });

      const nuevaConfig = { ...form, ...payload };
      setForm(nuevaConfig);
      setOriginal(nuevaConfig);
      showToast?.("Configuración de reportes guardada.", "success");
    } catch (e) {
      const msg = e.message || "No se pudo guardar la configuración.";
      setError(msg);
      showToast?.(msg, "error");
    }
    setSaving(false);
  };

  const handleDescartar = () => setForm(original);
  const handleQuitarLogo = () => set("logo_base64")(null);

  if (loading) {
    return (
      <div className="cr-loading">
        <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" /> Cargando configuración…
      </div>
    );
  }

  const suffix = colorSuffix(form.color_clase);
  const inicial = (form.nombre_institucion || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="cr-root">
      <div className="cr-header">
        <h2 className="cr-title">
          <i className="ti ti-palette" aria-hidden="true" /> Configuración de Reportes
        </h2>
        <p className="cr-subtitle">
          Logo, color y textos del membrete de los reportes imprimibles (Reporte Diario, Reporte por Rango y Planilla Imprimible).
        </p>
      </div>

      <div className="cr-layout">
        {/* Formulario */}
        <div className="cr-form s-card">
          {/* Logo */}
          <div className="cr-field">
            <label className="cr-field-label">Logo institucional</label>
            <div className="cr-logo-row">
              <div className="cr-logo-preview">
                {form.logo_base64
                  ? <img src={form.logo_base64} alt="Logo actual" className="cr-logo-img" />
                  : <div className="cr-logo-placeholder">{inicial}</div>}
              </div>
              <div className="cr-logo-actions">
                <div className="cr-logo-actions-row">
                  <button type="button" className="s-btn s-btn--sm" onClick={() => fileInputRef.current?.click()}>
                    {form.logo_base64 ? "Cambiar logo" : "Subir logo"}
                  </button>
                  {form.logo_base64 && (
                    <button type="button" className="s-btn s-btn--sm s-btn--cancel" onClick={handleQuitarLogo}>
                      Quitar
                    </button>
                  )}
                </div>
                <p className="cr-field-hint">PNG, JPG o WEBP, máx. 1.5 MB.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoChange}
                  className="cr-file-input"
                  aria-label="Subir logo institucional"
                />
              </div>
            </div>
          </div>

          {/* Color */}
          <div className="cr-field">
            <label className="cr-field-label">Color institucional</label>
            <div className="cr-color-row">
              {COLORES_REPORTE.map(c => (
                <button
                  key={c.clase}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  onClick={() => set("color_clase")(c.clase)}
                  className={`cr-color-swatch cr-swatch--${colorSuffix(c.clase)}${form.color_clase === c.clase ? " cr-color-swatch--active" : ""}`}
                >
                  {form.color_clase === c.clase && <i className="ti ti-check" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>

          {/* Textos */}
          {CAMPOS_TEXTO.map(campo => (
            <div className="cr-field" key={campo.key}>
              <label htmlFor={`cr-${campo.key}`} className="cr-field-label">{campo.label}</label>
              <input
                id={`cr-${campo.key}`}
                className="s-input s-input--full"
                value={form[campo.key] || ""}
                maxLength={campo.maxLength}
                onChange={e => set(campo.key)(e.target.value)}
              />
            </div>
          ))}

          {error && <div className="cr-error">{error}</div>}

          <div className="cr-footer">
            <button
              type="button"
              className="s-btn s-btn--cancel"
              onClick={handleDescartar}
              disabled={!hayCambios || saving}
            >
              Descartar cambios
            </button>
            <button
              type="button"
              className="cr-btn-guardar"
              onClick={handleGuardar}
              disabled={!hayCambios || saving}
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>

        {/* Vista previa */}
        <div className="cr-preview">
          <p className="cr-preview-label">Vista previa</p>
          <div className={`cr-preview-card s-card cr-swatch--${suffix}`}>
            <div className="cr-preview-membrete">
              <div className="cr-preview-logo">
                {form.logo_base64
                  ? <img src={form.logo_base64} alt="Logo" />
                  : inicial}
              </div>
              <div>
                <div className="cr-preview-nombre">{form.nombre_institucion || "—"}</div>
                <div className="cr-preview-sub">{form.subtitulo_1 || "—"}</div>
                <div className="cr-preview-sub">{form.subtitulo_2 || "—"}</div>
              </div>
            </div>
            <div className="cr-preview-pie">{form.pie_texto || "—"}</div>
            <div className="cr-preview-pie">{form.firma_label || "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
