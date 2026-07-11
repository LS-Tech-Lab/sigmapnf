/**
 * LogsView.jsx
 *
 * Vista de logs visible para Admin y Coordinador.
 * Dos pestañas:
 *   - Sesiones: logins, logouts, intentos fallidos
 *   - Auditoría: cambios realizados en el sistema
 */

import React, { useState } from "react";
import TabSesiones from "./logs/TabSesiones";
import TabAuditoria from "./logs/TabAuditoria";
import "./LogsView.css";

// Fix ARCH-10 (auditoría 9 de julio): TabSesiones, TabAuditoria y las
// utilidades compartidas (fmtDateTime/EVENTO_CONFIG/ACCION_CONFIG/badges)
// se extrajeron a src/components/logs/ — mismo patrón que ARCH-8. Este
// archivo queda solo como orquestador de pestañas.

// ── Componente principal ──────────────────────────────────────────────
export default function LogsView({ permisos, showToast }) {
  // D-1 fix: las pestañas se construyen según permisos individuales.
  // puedeVerLogs → "Registros de sesión"
  // puedeVerAuditoria → "Auditoría de cambios"
  // Antes: ambas pestañas visibles a cualquier usuario con puedeVerLogs.
  const TABS = [
    ...(permisos.puedeVerLogs
      ? [{ id: "sesiones",  icon: "ti-key",         label: "Registros de sesión" }]
      : []),
    ...(permisos.puedeVerAuditoria
      ? [{ id: "auditoria", icon: "ti-list-details", label: "Auditoría de cambios" }]
      : []),
  ];

  const initialTab = permisos.puedeVerLogs ? "sesiones" : "auditoria";
  const [tab, setTab] = useState(initialTab);

  if (TABS.length === 0) {
    return (
      <div className="lv-no-access">
        <i className="ti ti-lock lv-no-access-icon" aria-hidden="true" />
        <div className="lv-no-access-text">No tienes permiso para ver los registros del sistema.</div>
      </div>
    );
  }

  return (
    <div className="lv-root">
      {/* Encabezado */}
      <div className="lv-header">
        <h1 className="lv-title">
          Registros del Sistema
        </h1>
        <p className="lv-subtitle">
          Historial de sesiones y auditoría de cambios
        </p>
      </div>

      {/* Tabs — solo las permitidas por permisos */}
      {TABS.length > 1 && (
        <div className="lv-tabs">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`lv-tab-btn${tab === t.id ? ' lv-tab-btn--active' : ''}`}>
              <i className={`ti ${t.icon} lv-tab-icon`} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "sesiones"  && permisos.puedeVerLogs      && <TabSesiones  permisos={permisos} showToast={showToast} />}
      {tab === "auditoria" && permisos.puedeVerAuditoria  && <TabAuditoria permisos={permisos} />}
    </div>
  );
}
