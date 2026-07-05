/**
 * ModuleSelector.jsx
 *
 * Pantalla post-login que aparece solo para el rol Admin.
 * Permite elegir entre el módulo de Horarios y el módulo de
 * Control de Asistencias Diarias con QR.
 *
 * Para el resto de roles se omite esta pantalla y se entra
 * directamente al módulo de Horarios (comportamiento original).
 */

import React from "react";
import "./ModuleSelector.css";

const MODULES = [
  {
    id: "horarios",
    icon: "ti-calendar-event",
    title: "Gestión de Horarios",
    description: "Administra los horarios académicos del trimestre: docentes, materias, secciones, conflictos y reportes.",
  },
  {
    id: "asistencias",
    icon: "ti-circle-check",
    title: "Control de Asistencias",
    description: "Registro diario de presencia docente mediante código QR rotativo. Reportes y exportación por turno y programa.",
  },
];

export default function ModuleSelector({ profile, onSelectModule, onLogout }) {
  return (
    <div className="module-page">
      {/* Logo / cabecera */}
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
        <p className="module-hint">Selecciona el módulo al que deseas acceder</p>
      </div>

      {/* Tarjetas de módulos */}
      <div className="module-grid">
        {MODULES.map((mod) => (
          <button
            key={mod.id}
            onClick={() => onSelectModule(mod.id)}
            className={`module-card module-card--${mod.id}`}
          >
            {/* Ícono */}
            <div className="module-icon">
              {mod.icon ? <i className={`ti ${mod.icon}`} aria-hidden="true" /> : null}
            </div>

            {/* Título */}
            <div className="module-title-card">{mod.title}</div>

            {/* Descripción */}
            <div className="module-desc">{mod.description}</div>

            {/* Flecha */}
            <div className="module-arrow">
              Entrar <i className="ti ti-arrow-right" aria-hidden="true" />
            </div>
          </button>
        ))}
      </div>

      {/* Footer con logout */}
      <button onClick={onLogout} className="module-logout">
        <i className="ti ti-logout" aria-hidden="true" /> Cerrar sesión
      </button>
    </div>
  );
}
