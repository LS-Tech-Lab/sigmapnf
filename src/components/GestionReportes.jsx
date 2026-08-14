// GestionReportes.jsx — shell de pestañas de Sistema → Reportes (13 ago
// 2026, pedido de LS).
//
// Mismo patrón que GestionSedes.jsx: una barra de pills, cada una
// gateada por su propio permiso puntual, y el panel de abajo renderiza
// el componente de la pestaña activa. Los dos componentes de contenido
// (ConfiguracionReportes, TabPlantillas) NO se tocaron por dentro -- ya
// eran autocontenidos con su propio encabezado (.cr-header/.gs-header),
// este shell solo decide cuál mostrar.
//
//   - "Membrete": logo/color/textos del membrete de los 3 documentos
//     imprimibles (ConfiguracionReportes.jsx, sin cambios). Permiso
//     puedeConfigurarReportes.
//   - "Plantillas": columnas/formato de la Planilla de Asistencia por
//     Turno (TabPlantillas.jsx, mudado acá desde Sistema → Sedes).
//     Permiso puedeGestionarPlantillas.
//
// Alguien con solo uno de los dos permisos llega a este panel igual (ver
// el OR en AdminModulo.jsx) pero solo ve su propia pestaña -- mismo
// criterio que se usó brevemente en GestionSedes.jsx mientras Plantillas
// vivió ahí.
import React, { useState } from "react";
import ConfiguracionReportes from "./ConfiguracionReportes";
import TabPlantillas from "./gestionReportes/TabPlantillas";
import "./usuarios/index.css"; // rediseño 14 ago 2026 (pedido LS): mismo
// header + pestañas tipo pill que Usuarios y Roles/Registros — ver
// GestionSedes.jsx para el mismo criterio aplicado a Sedes.
import "./GestionSedes.css";

const PESTANAS = [
  { id: "membrete",   label: "Membrete",   icono: "ti-palette",      permiso: "puedeConfigurarReportes" },
  { id: "plantillas", label: "Plantillas", icono: "ti-layout-grid",  permiso: "puedeGestionarPlantillas" },
];

export default function GestionReportes({ showToast, logAudit, permisos = {} }) {
  const pestanasVisibles = PESTANAS.filter(p => permisos[p.permiso]);
  const [pestanaActiva, setPestanaActiva] = useState(pestanasVisibles[0]?.id || "membrete");

  return (
    <div className="gs-root">
      <div className="uv-header">
        <h1 className="uv-title">
          <i className="ti ti-palette uv-title-icon" aria-hidden="true" />
          Reportes
        </h1>
        <p className="uv-subtitle">
          Personaliza el membrete de los documentos imprimibles y las plantillas de planillas por sede.
        </p>
      </div>

      {pestanasVisibles.length > 1 && (
        <div className="uv-tabs" role="tablist" aria-label="Configuración de reportes">
          {pestanasVisibles.map(p => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pestanaActiva === p.id}
              className={`uv-tab${pestanaActiva === p.id ? " uv-tab--active" : ""}`}
              onClick={() => setPestanaActiva(p.id)}
            >
              <i className={`ti ${p.icono}`} aria-hidden="true" /> {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="gs-tab-panel">
        {pestanaActiva === "membrete" && (
          <ConfiguracionReportes showToast={showToast} logAudit={logAudit} />
        )}
        {pestanaActiva === "plantillas" && (
          <TabPlantillas showToast={showToast} logAudit={logAudit} />
        )}
      </div>
    </div>
  );
}
