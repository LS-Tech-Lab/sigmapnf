import React from "react";

// Fix ARCH-13 (auditoría 9 de julio): extraído de LogsView.jsx sin cambios
// de lógica. Compartido por TabSesiones y TabAuditoria.

export function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-VE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-VE", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ── Configuraciones de eventos y acciones ─────────────────────────────
export const EVENTO_CONFIG = {
  login:          { label: "Inicio de sesión", icon: "ti-circle-check",    color: "#16A34A", bg: "#F0FDF4" },
  logout:         { label: "Cierre de sesión", icon: "ti-circle-x",        color: "#DC2626", bg: "#FEF2F2" },
  login_fallido:  { label: "Intento fallido",  icon: "ti-alert-triangle",  color: "#D97706", bg: "#FFFBEB" },
};

export const ACCION_CONFIG = {
  IMPORTAR_EXCEL:      { icon: "ti-file-import",   color: "#1D4ED8" },
  BORRAR_HORARIOS:     { icon: "ti-trash",          color: "#DC2626" },
  EDITAR_DOCENTE:      { icon: "ti-pencil",         color: "#0F766E" },
  UNIFICAR_DOCENTE:    { icon: "ti-git-merge",      color: "#0F766E" },
  EDITAR_MATERIA:      { icon: "ti-pencil",         color: "#0F766E" },
  UNIFICAR_MATERIA:    { icon: "ti-git-merge",      color: "#0F766E" },
  CERRAR_TRIMESTRE:    { icon: "ti-lock",           color: "#7C3AED" },
  CREAR_TRIMESTRE:     { icon: "ti-school",         color: "#2563EB" },
  RESTAURAR_BACKUP:    { icon: "ti-restore",        color: "#D97706" },
  EXPORTAR_BACKUP:     { icon: "ti-package-export", color: "#64748B" },
  CREAR_USUARIO:       { icon: "ti-user-plus",      color: "#2563EB" },
  EDITAR_USUARIO:      { icon: "ti-user-edit",      color: "#475569" },
  ACTIVAR_USUARIO:     { icon: "ti-user-check",     color: "#16A34A" },
  DESACTIVAR_USUARIO:  { icon: "ti-user-off",       color: "#DC2626" },
  GESTIONAR_USUARIO:   { icon: "ti-users",          color: "#7C3AED" },
  // M-1: acciones de roles (añadidas con el fix de auditoría de roles)
  CREAR_ROL:           { icon: "ti-shield-plus",    color: "#2563EB" },
  EDITAR_ROL:          { icon: "ti-shield-check",   color: "#0F766E" },
  ELIMINAR_ROL:        { icon: "ti-shield-off",     color: "#DC2626" },
};

// Fix UX-5/SEC-3 (auditoría QA 5/jul/2026, Fase 2): EVENTO_CONFIG/ACCION_CONFIG
// son objetos fijos hardcodeados arriba — no son "dato" en el sentido que
// bloquea CSP. Las clases .lv-c-<evento>/.lv-a-<accion> (ver src/index.css)
// reemplazan el fondo/color que antes se inyectaba vía estilo inline.
export function eventoClass(evento) {
  const key = (evento || "").toLowerCase();
  return EVENTO_CONFIG[key] ? `lv-c-${key}` : "lv-c-default";
}
export function accionClass(accion) {
  const key = (accion || "").toLowerCase();
  return ACCION_CONFIG[accion?.toUpperCase()] ? `lv-a-${key}` : "lv-a-default";
}

export function EventoBadge({ evento }) {
  const cfg = EVENTO_CONFIG[evento] || { label: evento, icon: "ti-info-circle" };
  return (
    <span className={`lv-evento-badge ${eventoClass(evento)}`}>
      <i className={`ti ${cfg.icon} lv-evento-badge-icon`} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}

export function AccionBadge({ accion }) {
  const cfg = ACCION_CONFIG[accion] || { icon: "ti-info-circle" };
  return (
    <span className={`lv-accion-badge ${accionClass(accion)}`}>
      <i className={`ti ${cfg.icon} lv-accion-badge-icon`} aria-hidden="true" />
      {accion.replace(/_/g, " ")}
    </span>
  );
}
