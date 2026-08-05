/**
 * SedeSelector.jsx
 *
 * Pantalla post-login (SEDE-2), va DESPUÉS de LoginScreen y ANTES de
 * ModuleSelector. Solo la ven perfiles con `puedeVerTodasLasSedes`
 * (admin, coordinador general) — el resto de los roles tiene la sede
 * fija en su perfil (`sedeAsignada`) y nunca pasa por acá, ver
 * useSedeActiva.js.
 *
 * Reutiliza las clases `.module-*` de ModuleSelector.css a propósito
 * (mismo layout de splash: logo, título, grid de tarjetas, logout) —
 * evita duplicar la hoja de estilos para una pantalla que es
 * estructuralmente idéntica, solo con otro contenido. Lo único propio
 * de esta pantalla vive en SedeSelector.css.
 */

import React from "react";
import "./ModuleSelector.css";
import "./SedeSelector.css";

export default function SedeSelector({ profile, sedes, loadingSedes, onSelectSede, onLogout }) {
  return (
    <div className="module-page">
      <div className="module-header">
        <img src="/logo-coordinacion.png" alt="Logo Coordinación" className="module-logo" />
        <h1 className="module-title">SIGMA</h1>
        <p className="module-subtitle">Sistema Integrado de Gestión y Módulos Académicos</p>
        <p className="module-welcome">
          Bienvenido,{" "}
          <span className="module-welcome-name">
            {profile?.nombre || profile?.email || "Usuario"}
          </span>
        </p>
        <p className="module-hint">Selecciona la sede con la que vas a trabajar</p>
      </div>

      {loadingSedes ? (
        <div className="app-spinner-ring" aria-label="Cargando sedes…" />
      ) : (
        <div className="module-grid sede-grid">
          {sedes.map((sede) => (
            <button
              key={sede.id}
              onClick={() => onSelectSede(sede.id)}
              className="module-card sede-card"
            >
              <div className="module-icon">
                <i className="ti ti-building-community" aria-hidden="true" />
              </div>
              <div className="module-card-body">
                <div className="module-title-card">{sede.nombre}</div>
              </div>
              <i className="ti ti-chevron-right module-chevron" aria-hidden="true" />
            </button>
          ))}
          {sedes.length === 0 && (
            <p className="sede-empty">
              No hay sedes activas configuradas. Contacta a soporte.
            </p>
          )}
        </div>
      )}

      <button onClick={onLogout} className="module-logout">
        <i className="ti ti-logout" aria-hidden="true" /> Cerrar sesión
      </button>
    </div>
  );
}
