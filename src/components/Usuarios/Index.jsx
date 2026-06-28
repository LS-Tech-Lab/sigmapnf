/**
 * usuarios/index.jsx  (anteriormente UsuariosView.jsx)
 *
 * Orquestador del módulo de Gestión de Usuarios y Roles.
 * Maneja la selección de pestaña y la carga inicial de roles compartidos
 * (necesarios tanto por PestanaUsuarios como por PestanaRoles).
 *
 * Props:
 *   permisos  — objeto de permisos del usuario actual
 *   programas — lista de programas disponibles
 *   logAudit  — función de auditoría
 *   showToast — función de toast global
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { DEFAULT_PROGRAMAS } from "../../constants";
import PestanaUsuarios from "./PestanaUsuarios";
import PestanaRoles    from "./PestanaRoles";

export default function UsuariosView({ permisos, programas, logAudit, showToast }) {
  const programasDisponibles = programas?.length ? programas : DEFAULT_PROGRAMAS;
  const puedeUsuarios = permisos.puedeGestionarUsuarios;
  const puedeRoles    = permisos.puedeGestionarRoles;

  const defaultTab = puedeUsuarios ? "usuarios" : "roles";
  const [tab,   setTab]   = useState(defaultTab);
  const [roles, setRoles] = useState([]);

  // Carga inicial de roles: los necesita PestanaUsuarios aunque no tenga puedeGestionarRoles,
  // porque el formulario de usuario los usa para el selector de rol.
  const cargarRoles = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_get_roles");
      setRoles(data || []);
    } catch { /* sin permisos o red: silencioso */ }
  }, []);

  useEffect(() => { cargarRoles(); }, [cargarRoles]);

  if (!puedeUsuarios && !puedeRoles) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)" }}>
        No tienes permiso para acceder a esta sección.
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto", fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {/* Encabezado */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--color-text-primary)" }}>
          <i className="ti ti-crown" style={{ marginRight: 8, color: "var(--color-role-coord)" }} />
          Gestión de Usuarios y Roles
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-text-tertiary)" }}>
          Administra quién puede acceder al sistema y qué puede hacer.
        </p>
      </div>

      {/* Pestañas (solo si tiene ambos permisos) */}
      {puedeUsuarios && puedeRoles && (
        <div style={{
          display: "flex", gap: 2, marginBottom: 20,
          background: "var(--color-background-tertiary)", borderRadius: 10, padding: 3, width: "fit-content",
        }}>
          {[
            { id: "usuarios", icon: "ti-users",       label: "Usuarios" },
            { id: "roles",    icon: "ti-shield-lock",  label: "Roles y Permisos" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "7px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 600, transition: "all 0.15s",
                background: tab === t.id ? "#fff" : "transparent",
                color: tab === t.id ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <i className={`ti ${t.icon}`} /> {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Contenido */}
      {tab === "usuarios" && puedeUsuarios && (
        <PestanaUsuarios
          permisos={permisos}
          roles={roles}
          programas={programasDisponibles}
          showToast={showToast}
          logAudit={logAudit}
        />
      )}
      {tab === "roles" && puedeRoles && (
        <PestanaRoles
          permisos={permisos}
          onRolesChanged={setRoles}
          showToast={showToast}
          logAudit={logAudit}
        />
      )}
    </div>
  );
}
