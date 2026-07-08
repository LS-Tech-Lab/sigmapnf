import React from "react";
import { roleColorClass } from "../constants";

/**
 * Menú desplegable de usuario.
 * Usado tanto en HorariosLayout (variant="horarios") como en AsistenciasModulo (variant="asistencias").
 */
export default function UserMenu({
  profile,
  rolLabel,
  rolColor,
  open,
  onToggle,
  onClose,
  onCambiarPassword,
  onLogout,
  sessionStart,       // Date | null — expuesto por useAuth
  // Solo horarios:
  tieneHorarios,
  tieneQR,
  onCambiarModulo,
  // Solo asistencias: no tiene opciones extra actualmente
  variant = "horarios",
}) {
  // Formatear tiempo transcurrido desde el login
  const tiempoSesion = (() => {
    if (!sessionStart) return null;
    const mins = Math.floor((Date.now() - sessionStart.getTime()) / 60000);
    if (mins < 1)  return "Ahora mismo";
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  })();
  return (
    <div className="um-root">
      <button
        onClick={onToggle}
        title="Menú de usuario"
        aria-label="Menú de usuario"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`um-trigger-btn ${open ? "um-trigger-btn--open" : ""}`}
      >
        <div className="um-avatar">
          {profile.nombre?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="um-info">
          <div className="um-name">
            {profile.nombre && profile.nombre !== rolLabel ? profile.nombre : rolLabel}
          </div>
          <div className={`um-role ${roleColorClass(rolColor)}`}>
            {rolLabel}
            {variant === "horarios" && profile.programa ? ` · ${profile.programa.replace("PNF ", "")}` : ""}
          </div>
        </div>
        <i
          className={`ti ti-chevron-down um-chevron ${open ? "um-chevron--open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <>
          <div onClick={onClose} className="um-menu-overlay" />
          <div className="um-menu">
            {/* Info del usuario */}
            <div className="um-menu-header">
              <div className="um-menu-name">
                {profile.nombre && profile.nombre !== rolLabel ? profile.nombre : rolLabel}
              </div>
              <div className="um-menu-email">
                {profile.email}
              </div>
              {tiempoSesion && (
                <div className="um-menu-session">
                  <i className="ti ti-clock um-icon-xs" aria-hidden="true" />
                  Sesión activa: {tiempoSesion}
                </div>
              )}
            </div>

            {/* Cambiar módulo — solo horarios, solo si tiene ambos */}
            {variant === "horarios" && tieneHorarios && tieneQR && (
              <button
                onClick={() => { onCambiarModulo?.(); onClose(); }}
                className="um-item"
              >
                <i className="ti ti-switch-horizontal um-item-icon" aria-hidden="true" />
                Cambiar módulo
              </button>
            )}

            {/* Cambiar contraseña */}
            <button
              onClick={() => { onCambiarPassword(); onClose(); }}
              className="um-item"
            >
              <i className="ti ti-key um-item-icon" aria-hidden="true" />
              Cambiar contraseña
            </button>

            <div className="um-divider" />

            {/* Cerrar sesión */}
            <button
              onClick={() => { onLogout(); onClose(); }}
              className="um-item um-item--danger"
            >
              <i className="ti ti-logout um-item-icon" aria-hidden="true" />
              Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}
