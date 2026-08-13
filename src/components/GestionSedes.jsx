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
import React, { useState, useCallback } from "react";
import TabSedes from "./gestionSedes/TabSedes";
import TabProgramas from "./gestionSedes/TabProgramas";
import TabAsignacion from "./gestionSedes/TabAsignacion";
import TabPlantillas from "./gestionSedes/TabPlantillas";
import "./GestionSedes.css";

// TabPlantillas (Fase 1 del editor de plantillas, 12 ago 2026): a
// diferencia de las otras 3, no depende de `refrescarClave` -- gestiona
// su propio catálogo (plantillas_impresion / sede_plantillas, migración
// 0091), sin relación con altas de sedes o programas. Vive detrás de su
// propio permiso (puedeGestionarPlantillas) en vez de puedeGestionarSedes
// -- alguien con solo ese permiso llega a este panel (ver AdminModulo.jsx)
// pero solo ve esta pestaña, no las otras 3.
const PESTANAS = [
  { id: "sedes",       label: "Sedes",       icono: "ti-building-community", permiso: "puedeGestionarSedes" },
  { id: "programas",   label: "Programas",   icono: "ti-school",             permiso: "puedeGestionarSedes" },
  { id: "asignacion",  label: "Asignación",  icono: "ti-grid-dots",          permiso: "puedeGestionarSedes" },
  { id: "plantillas",  label: "Plantillas",  icono: "ti-layout-grid",        permiso: "puedeGestionarPlantillas" },
];

export default function GestionSedes({ showToast, logAudit, permisos = {} }) {
  const pestanasVisibles = PESTANAS.filter(p => permisos[p.permiso]);
  const [pestanaActiva, setPestanaActiva] = useState(pestanasVisibles[0]?.id || "sedes");
  const [refrescarClave, setRefrescarClave] = useState(0);

  const notificarCambioCatalogo = useCallback(() => {
    setRefrescarClave(k => k + 1);
  }, []);

  return (
    <div className="gs-root">
      <div className="gs-tabs" role="tablist" aria-label="Configuración de sedes y programas">
        {pestanasVisibles.map(p => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pestanaActiva === p.id}
            className={`gs-tab ${pestanaActiva === p.id ? "gs-tab--activa" : ""}`}
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
        {pestanaActiva === "plantillas" && (
          <TabPlantillas showToast={showToast} logAudit={logAudit} />
        )}
      </div>
    </div>
  );
}
