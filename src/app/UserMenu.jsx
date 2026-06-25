import React from "react";

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
  // Solo horarios:
  tieneHorarios,
  tieneQR,
  onCambiarModulo,
  // Solo asistencias: no tiene opciones extra actualmente
  variant = "horarios",
}) {
  return (
    <div style={{ marginLeft: "auto", position: "relative" }}>
      <button
        onClick={onToggle}
        title="Menú de usuario"
        aria-label="Menú de usuario"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
          background: open ? "var(--color-background-tertiary)" : "transparent",
          border: "1px solid " + (open ? "var(--color-border-secondary)" : "var(--color-border-tertiary)"),
          borderRadius: 8, padding: "4px 10px 4px 6px",
          transition: "background .13s, border-color .13s",
        }}
      >
        <div style={{
          width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg,var(--brand-500),var(--color-role-coord))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, color: "#fff",
        }}>
          {profile.nombre?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div style={{ textAlign: "left", lineHeight: 1.3 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
            {profile.nombre && profile.nombre !== rolLabel ? profile.nombre : rolLabel}
          </div>
          <div style={{ fontSize: 10, color: rolColor, fontWeight: 600, whiteSpace: "nowrap" }}>
            {rolLabel}
            {variant === "horarios" && profile.programa ? ` · ${profile.programa.replace("PNF ", "")}` : ""}
          </div>
        </div>
        <i
          className="ti ti-chevron-down"
          style={{
            fontSize: 12, color: "var(--color-text-tertiary)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform .15s",
          }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <>
          <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 398 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 200,
            background: "#fff", border: "1px solid var(--color-border-tertiary)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 399, overflow: "hidden",
            animation: "fadeDown .15s ease",
          }}>
            {/* Info del usuario */}
            <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--color-background-tertiary)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)" }}>
                {profile.nombre && profile.nombre !== rolLabel ? profile.nombre : rolLabel}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                {profile.email}
              </div>
            </div>

            {/* Cambiar módulo — solo horarios, solo si tiene ambos */}
            {variant === "horarios" && tieneHorarios && tieneQR && (
              <button
                onClick={() => { onCambiarModulo?.(); onClose(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 9, width: "100%",
                  padding: "9px 14px", border: "none", background: "transparent",
                  cursor: "pointer", fontSize: 13, color: "var(--navy-700)", textAlign: "left",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--color-background-secondary)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <i className="ti ti-switch-horizontal" style={{ fontSize: 15, color: "var(--color-text-tertiary)" }} aria-hidden="true" />
                Cambiar módulo
              </button>
            )}

            {/* Cambiar contraseña */}
            <button
              onClick={() => { onCambiarPassword(); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 9, width: "100%",
                padding: "9px 14px", border: "none", background: "transparent",
                cursor: "pointer", fontSize: 13, color: "var(--navy-700)", textAlign: "left",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--color-background-secondary)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <i className="ti ti-key" style={{ fontSize: 15, color: "var(--color-text-tertiary)" }} aria-hidden="true" />
              Cambiar contraseña
            </button>

            <div style={{ height: 1, background: "var(--color-background-tertiary)" }} />

            {/* Cerrar sesión */}
            <button
              onClick={() => { onLogout(); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 9, width: "100%",
                padding: "9px 14px", border: "none", background: "transparent",
                cursor: "pointer", fontSize: 13, color: "var(--color-danger-mid)", textAlign: "left",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#FFF5F5"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <i className="ti ti-logout" style={{ fontSize: 15 }} aria-hidden="true" />
              Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}
