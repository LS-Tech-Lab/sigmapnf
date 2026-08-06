/**
 * ModuleSelector.jsx
 *
 * Pantalla post-login que aparece cuando el usuario tiene acceso a 2 o
 * más módulos: Horarios, Control de Asistencias y/o Administración
 * (ADMIN-3). Si solo tiene acceso a uno, useModuloActivo lo selecciona
 * automáticamente y esta pantalla nunca se muestra.
 */

import React, { useState, useRef, useEffect } from "react";
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

export default function ModuleSelector({
  profile, tieneHorarios, tieneQR, tieneAdmin, onSelectModule, onLogout,
  puedeElegirSede, sedes = [], sedeActiva, onSelectSede,
}) {
  const acceso = { horarios: tieneHorarios, asistencias: tieneQR, admin: tieneAdmin };
  const modulosVisibles = MODULES.filter((mod) => acceso[mod.id]);

  // UX-31: el badge de sede antes navegaba a una pantalla completa
  // (<SedeSelector/>) para elegir sede. Ahora es un dropdown real: se
  // abre/cierra in-place y la selección llama a onSelectSede directo,
  // sin salir de esta pantalla. Mismo patrón de cierre por click-afuera
  // que GlobalSearch.jsx (ref + listener de "mousedown" en el documento).
  const [sedeMenuOpen, setSedeMenuOpen] = useState(false);
  const sedeMenuRef = useRef(null);
  const sedeActivaNombre = sedes.find((s) => s.id === sedeActiva)?.nombre || sedeActiva;

  useEffect(() => {
    const handler = (e) => {
      if (sedeMenuRef.current && !sedeMenuRef.current.contains(e.target)) setSedeMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelectSede = (id) => {
    setSedeMenuOpen(false);
    if (id !== sedeActiva) onSelectSede(id);
  };

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
        {/* SEDE-6: visible solo para roles con puedeVerTodasLasSedes —
            la sede fija del resto de los roles nunca cambia, así que no
            tiene sentido mostrarles un botón para "cambiarla". Sin este
            indicador, la única forma de saber en qué sede está trabajando
            un admin era abrir un módulo y fijarse en los datos cargados. */}
        {puedeElegirSede && (
          <div className="module-sede-wrap" ref={sedeMenuRef}>
            <button
              type="button"
              onClick={() => setSedeMenuOpen((v) => !v)}
              className="module-sede-badge"
              title="Cambiar de sede"
              aria-expanded={sedeMenuOpen}
              aria-haspopup="listbox"
            >
              <i className="ti ti-building-community" aria-hidden="true" />
              <span>{sedeActivaNombre || "Sin sede"}</span>
              <i className={`ti ti-chevron-down module-sede-chevron${sedeMenuOpen ? " module-sede-chevron--open" : ""}`} aria-hidden="true" />
            </button>
            {sedeMenuOpen && (
              <ul className="module-sede-menu" role="listbox">
                {sedes.length === 0 && (
                  <li className="module-sede-menu-empty">No hay sedes activas configuradas.</li>
                )}
                {sedes.map((sede) => (
                  <li key={sede.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={sede.id === sedeActiva}
                      className={`module-sede-menu-item${sede.id === sedeActiva ? " module-sede-menu-item--active" : ""}`}
                      onClick={() => handleSelectSede(sede.id)}
                    >
                      <span>{sede.nombre}</span>
                      {sede.id === sedeActiva && <i className="ti ti-check" aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="module-hint">Selecciona el módulo al que deseas acceder</p>
      </div>

      {/* Tarjetas de módulos.
          Compactación (12 de julio, pedido directo del usuario): layout
          horizontal (ícono | texto | chevron) en vez de vertical
          (ícono arriba, título, descripción, "Entrar" al final) — reduce
          la altura de cada tarjeta de forma notoria, más parecido a una
          fila de lista que a una tarjeta grande. Ver ModuleSelector.css. */}
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

            {/* Título + descripción */}
            <div className="module-card-body">
              <div className="module-title-card">{mod.title}</div>
              <div className="module-desc">{mod.description}</div>
            </div>

            {/* Chevron (reemplaza el texto "Entrar" — más minimalista) */}
            <i className="ti ti-chevron-right module-chevron" aria-hidden="true" />
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
