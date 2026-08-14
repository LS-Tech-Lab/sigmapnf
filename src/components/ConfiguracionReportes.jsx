// ConfiguracionReportes.jsx — ADMIN-6 (auditoría 1 ago 2026)
// UX-40 (14 ago): rediseño para móvil — secciones en acordeón, logos en
// fila compacta, texto de ayuda movido a tooltip por ícono (i).
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

// UX-40: ícono (i) con tooltip accesible (title nativo + popover en focus/hover)
// en vez del párrafo de ayuda que antes se repetía debajo de cada logo.
function InfoTip({ texto }) {
  return (
    <span className="cr-info-wrap">
      <button type="button" className="cr-info-btn" aria-label="Más información" title={texto}>
        <i className="ti ti-info-circle" aria-hidden="true" />
      </button>
      <span className="cr-info-tip" role="tooltip">{texto}</span>
    </span>
  );
}

// UX-40: acordeón simple por sección — reduce el scroll inicial dejando que
// el usuario colapse lo que no necesita editar en ese momento.
function Seccion({ id, titulo, icono, abierta, onToggle, children }) {
  return (
    <div className="cr-section">
      <button
        type="button"
        className="cr-section-header"
        onClick={() => onToggle(id)}
        aria-expanded={abierta}
      >
        <span className="cr-section-title">
          <i className={icono} aria-hidden="true" /> {titulo}
        </span>
        <i
          className={`ti ti-chevron-down cr-section-chevron${abierta ? " cr-section-chevron--open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {abierta && <div className="cr-section-body">{children}</div>}
    </div>
  );
}

export default function ConfiguracionReportes({ showToast, logAudit }) {
  const [form, setForm]         = useState(CONFIG_REPORTE_DEFAULT);
  const [original, setOriginal] = useState(CONFIG_REPORTE_DEFAULT);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [abiertas, setAbiertas] = useState({ logos: true, color: true, textos: true });
  const fileInputRef = useRef(null);
  const fileInputCoordinacionRef = useRef(null); // migración 0092 (13 ago)

  const toggleSeccion = (id) => setAbiertas(a => ({ ...a, [id]: !a[id] }));

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("configuracion_reportes")
        .select("nombre_institucion, subtitulo_1, subtitulo_2, pie_texto, firma_label, logo_base64, logo_coordinacion_base64, color_clase")
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

  // Migración 0092 (13 ago): parametrizado por `campo` para reutilizarlo
  // en los 2 logos (institucional y de la coordinación) en vez de
  // duplicar la validación PNG/JPG/WEBP + 1.5MB dos veces.
  const handleLogoChange = (campo) => (e) => {
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
    reader.onload = () => set(campo)(reader.result);
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
        logo_coordinacion_base64: form.logo_coordinacion_base64 || null,
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
  const handleQuitarLogo = (campo) => () => set(campo)(null);

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
          <Seccion id="logos" titulo="Logos" icono="ti ti-photo" abierta={abiertas.logos} onToggle={toggleSeccion}>
            <div className="cr-logos-row">
              {/* Logo institucional */}
              <div className="cr-logo-compact">
                <div className="cr-logo-compact-header">
                  <span className="cr-field-label">Logo institucional</span>
                  <InfoTip texto="PNG, JPG o WEBP, máx. 1.5 MB." />
                </div>
                <div className="cr-logo-preview cr-logo-preview--sm">
                  {form.logo_base64
                    ? <img src={form.logo_base64} alt="Logo actual" className="cr-logo-img" />
                    : <div className="cr-logo-placeholder">{inicial}</div>}
                </div>
                <div className="cr-logo-compact-actions">
                  <button type="button" className="s-btn s-btn--sm" onClick={() => fileInputRef.current?.click()}>
                    {form.logo_base64 ? "Cambiar logo" : "Subir logo"}
                  </button>
                  {form.logo_base64 && (
                    <button type="button" className="cr-link-quitar" onClick={handleQuitarLogo("logo_base64")}>
                      Quitar
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoChange("logo_base64")}
                  className="cr-file-input"
                  aria-label="Subir logo institucional"
                />
              </div>

              {/* Logo de la coordinación (migración 0092, 13 ago) — se muestra
                  junto al ícono de la Planilla de Asistencia por Turno. */}
              <div className="cr-logo-compact">
                <div className="cr-logo-compact-header">
                  <span className="cr-field-label">Logo de la coordinación</span>
                  <InfoTip texto="PNG, JPG o WEBP, máx. 1.5 MB. Opcional — si no se sube, no se muestra nada junto al ícono." />
                </div>
                <div className="cr-logo-preview cr-logo-preview--sm">
                  {form.logo_coordinacion_base64
                    ? <img src={form.logo_coordinacion_base64} alt="Logo de la coordinación actual" className="cr-logo-img" />
                    : <div className="cr-logo-placeholder"><i className="ti ti-flag-2" aria-hidden="true" /></div>}
                </div>
                <div className="cr-logo-compact-actions">
                  <button type="button" className="s-btn s-btn--sm" onClick={() => fileInputCoordinacionRef.current?.click()}>
                    {form.logo_coordinacion_base64 ? "Cambiar logo" : "Subir logo"}
                  </button>
                  {form.logo_coordinacion_base64 && (
                    <button type="button" className="cr-link-quitar" onClick={handleQuitarLogo("logo_coordinacion_base64")}>
                      Quitar
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputCoordinacionRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoChange("logo_coordinacion_base64")}
                  className="cr-file-input"
                  aria-label="Subir logo de la coordinación"
                />
              </div>
            </div>
          </Seccion>

          <Seccion id="color" titulo="Color institucional" icono="ti ti-brush" abierta={abiertas.color} onToggle={toggleSeccion}>
