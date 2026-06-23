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

import React, { useState } from "react";

const MODULES = [
  {
    id: "horarios",
    icon: "ti-calendar-event",
    title: "Gestión de Horarios",
    description: "Administra los horarios académicos del trimestre: docentes, materias, secciones, conflictos y reportes.",
    color: "#2563EB",
    bg: "#EFF6FF",
    border: "#BFDBFE",
  },
  {
    id: "asistencias",
    icon: "ti-circle-check",
    title: "Control de Asistencias",
    description: "Registro diario de presencia docente mediante código QR rotativo. Reportes y exportación por turno y programa.",
    color: "#059669",
    bg: "#ECFDF5",
    border: "#A7F3D0",
  },
];

export default function ModuleSelector({ profile, onSelectModule, onLogout }) {
  const [hovered, setHovered] = useState(null);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
      }}
    >
      {/* Logo / cabecera */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <img
          src="/logo-coordinacion.png"
          alt="Logo Coordinación"
          style={{
            width: 80,
            height: 80,
            objectFit: "contain",
            marginBottom: 16,
            filter: "drop-shadow(0 4px 16px rgba(37,99,235,0.35))",
          }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "#F1F5F9",
            letterSpacing: "-0.3px",
          }}
        >
          SIGMA
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748B", letterSpacing: "0.02em" }}>
          Sistema Integrado de Gestión y Módulos Académicos
        </p>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "#94A3B8" }}>
          Bienvenido,{" "}
          <span style={{ color: "#93C5FD", fontWeight: 600 }}>
            {profile?.nombre || "Administrador"}
          </span>
        </p>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#64748B" }}>
          Selecciona el módulo al que deseas acceder
        </p>
      </div>

      {/* Tarjetas de módulos */}
      <div
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 680,
          width: "100%",
        }}
      >
        {MODULES.map((mod) => {
          const isHovered = hovered === mod.id;
          return (
            <button
              key={mod.id}
              onClick={() => onSelectModule(mod.id)}
              onMouseEnter={() => setHovered(mod.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                flex: "1 1 260px",
                maxWidth: 300,
                background: isHovered ? mod.bg : "#1E293B",
                border: `2px solid ${isHovered ? mod.color : "#334155"}`,
                borderRadius: 16,
                padding: "28px 24px",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.18s cubic-bezier(.4,0,.2,1)",
                transform: isHovered ? "translateY(-3px)" : "none",
                boxShadow: isHovered
                  ? `0 12px 32px ${mod.color}22`
                  : "0 2px 8px rgba(0,0,0,0.2)",
              }}
            >
              {/* Ícono */}
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: isHovered ? `${mod.color}18` : "#0F172A",
                  border: `1.5px solid ${isHovered ? mod.border : "#1E3A5F"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  marginBottom: 16,
                  transition: "all 0.18s",
                }}
              >
                {mod.icon ? <i className={`ti ${mod.icon}`} style={{ fontSize: 24 }} aria-hidden="true" /> : null}
              </div>

              {/* Título */}
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: isHovered ? mod.color : "#E2E8F0",
                  marginBottom: 8,
                  transition: "color 0.18s",
                }}
              >
                {mod.title}
              </div>

              {/* Descripción */}
              <div
                style={{
                  fontSize: 13,
                  color: isHovered ? "#334155" : "#94A3B8",
                  lineHeight: 1.55,
                  transition: "color 0.18s",
                }}
              >
                {mod.description}
              </div>

              {/* Flecha */}
              <div
                style={{
                  marginTop: 18,
                  fontSize: 13,
                  fontWeight: 600,
                  color: isHovered ? mod.color : "#475569",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "color 0.18s",
                }}
              >
                Entrar <i className="ti ti-arrow-right" style={{ fontSize: 14 }} aria-hidden="true" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer con logout */}
      <button
        onClick={onLogout}
        style={{
          marginTop: 40,
          background: "none",
          border: "none",
          color: "#475569",
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 8,
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#94A3B8")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#475569")}
      >
        <i className="ti ti-logout" aria-hidden="true" /> Cerrar sesión
      </button>
    </div>
  );
}
