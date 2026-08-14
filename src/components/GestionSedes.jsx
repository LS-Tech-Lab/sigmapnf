// GestionSedes.jsx — SEDE-17 (auditoría 6 ago 2026), ampliado en PROG-4
// (12 ago 2026) a un shell de 3 pestañas dentro de Sistema → Sedes:
//   - "Sedes": alta/edición/activar-desactivar de sedes (sin cambios,
//     ver src/components/gestionSedes/TabSedes.jsx).
//   - "Programas": catálogo de PNF, mismo patrón (TabProgramas.jsx).
//   - "Asignación": qué programas están activos en cada sede
//     (TabAsignacion.jsx), sobre la relación `sedes_programas` (0090).
//
// Se mantiene "GestionSedes" como nombre de archivo/export (en vez de
// renombrar a algo como "GestionSistema") porque AdminModulo.jsx ya lo
// importa así y no hay necesidad de tocar ese import — el contenido
// ahora cubre más que solo sedes, pero el punto de entrada no cambió.
//
// "Programas" y "Asignación" comparten un `refrescarClave` que se
// incrementa cada vez que cambia el catálogo de sedes o de programas
// (alta de una sede/programa nuevo) para que la matriz de Asignación se
// vuelva a cargar sin depender de que el usuario cambie de pestaña y
// vuelva -- si no, quedaría mostrando la matriz vieja tras un alta
// reciente hasta un refresh manual de página.
//
// Nota (13 ago): la pestaña "Plantillas" que vivió acá brevemente (Fase 1
// del editor de plantillas, 12 ago) se mudó a Reportes -- ver
// GestionReportes.jsx -- porque encajaba mejor ahí temáticamente
// (columnas/formato de impresión, no altas de sedes). Este archivo vuelve
// a depender solo de puedeGestionarSedes, sin el filtrado por pestaña que
// hizo falta mientras Plantillas vivió acá con su propio permiso.
import React, { useState, useCallback } from "react";
import TabSedes from "./gestionSedes/TabSedes";
import TabProgramas from "./gestionSedes/TabProgramas";
import TabAsignacion from "./gestionSedes/TabAsignacion";
import "./usuarios/index.css"; // rediseño 14 ago 2026 (pedido LS): reutiliza
// uv-header/uv-title/uv-subtitle/uv-tabs TAL CUAL de Usuarios y Roles, en
// vez de reinventar un header propio -- ver GestionSedes.css para el
// resto (gs-root/gs-tab-panel siguen viviendo ahí).
import "./GestionSedes.css";

const PESTANAS = [
  { id: "sedes",       label: "Sedes",       icono: "ti-building-community" },
  { id: "programas",   label: "Programas",   icono: "ti-school" },
  { id: "asignacion",  label: "Asignación",  icono: "ti-grid-dots" },
];

export default function GestionSedes({ showToast, logAudit }) {
  const [pestanaActiva, setPestanaActiva] = useState("sedes");
  const [refrescarClave, setRefrescarClave] = useState(0);

  const notificarCambioCatalogo = useCallback(() => {
    setRefrescarClave(k => k + 1);
  }, []);

  return (
    <div className="gs-root">
      {/* Encabezado único de página — mismo patrón que uv-header
          (usuarios/index.jsx) y lv-header (LogsView.jsx): un solo título
          arriba de todo, nada de repetirlo dentro de cada pestaña (los
          gs-header por pestaña que había antes en TabSedes/TabProgramas/
          TabAsignacion se quitaron por esto mismo). */}
      <div className="uv-header">
        <h1 className="uv-title">
          <i className="ti ti-building-community uv-title-icon" aria-hidden="true" />
          Sedes y Programas
        </h1>
        <p className="uv-subtitle">
          Administra el catálogo de sedes y programas, y qué programas están activos en cada sede.
        </p>
      </div>

      {/* Pestañas — mismas clases (uv-tabs/uv-tab) que Usuarios y Roles */}
      <div className="uv-tabs" role="tablist" aria-label="Configuración de sedes y programas">
        {PESTANAS.map(p => (
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

      <div className="gs-tab-panel">
        {pestanaActiva === "sedes" && (
          <TabSedes showToast={showToast} logAudit={logAudit} onCambio={notificarCambioCatalogo} />
        )}
        {pestanaActiva === "programas" && (
          <TabProgramas showToast={showToast} logAudit={logAudit} onCambio={notificarCambioCatalogo} />
        )}
        {pestanaActiva === "asignacion" && (
          <TabAsignacion showToast={showToast} logAudit={logAudit} refrescarClave={refrescarClave} />
        )}
      </div>
    </div>
  );
}
