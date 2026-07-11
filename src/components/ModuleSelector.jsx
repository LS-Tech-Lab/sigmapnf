/**
 * ModuleSelector.jsx
 *
 * Pantalla post-login que aparece cuando el usuario tiene acceso a 2 o
 * más módulos: Horarios, Control de Asistencias y/o Administración
 * (ADMIN-3). Si solo tiene acceso a uno, useModuloActivo lo selecciona
 * automáticamente y esta pantalla nunca se muestra.
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
  {
    id: "admin",
    icon: "ti-shield-cog",
    title: "Sistema",
    description: "Usuarios y roles, registros de sesión y auditoría, historial de trimestres cerrados.",
  },
];

export default function ModuleSelector({ profile, tieneHorarios, tieneQR, tieneAdmin, onSelectModule, onLogout }) {
  const acceso = { horarios: tieneHorarios, asistencias: tieneQR, admin: tieneAdmin };
  const modulosVisibles = MODULES.filter((mod) => acceso[mod.id]);

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
        {modulosVisibles.map((mod) => (
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
