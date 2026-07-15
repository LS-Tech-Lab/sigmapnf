/**
 * usuarios/index.jsx  (anteriormente UsuariosView.jsx)
 *
 * Orquestador del módulo de Gestión de Usuarios y Roles.
 * Maneja la selección de pestaña y la carga inicial de roles compartidos
 * (necesarios tanto por PestanaUsuarios como por PestanaRoles).
 *
 * Props:
 *   permisos  — objeto de permisos del usuario actual
 *   profile   — perfil del usuario actual (se usa solo para saber si
 *               rol === "admin" — jerarquía fija de SEC-15, ver
 *               PestanaUsuarios/ModalUsuario)
 *   programas — lista de programas disponibles
 *   logAudit  — función de auditoría
 *   showToast — función de toast global
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { DEFAULT_PROGRAMAS } from "../../constants";
import PestanaUsuarios from "./PestanaUsuarios";
import PestanaRoles    from "./PestanaRoles";
import "./index.css";

export default function UsuariosView({ permisos, profile, programas, logAudit, showToast }) {
  const programasDisponibles = programas?.length ? programas : DEFAULT_PROGRAMAS;
  const puedeUsuarios = permisos.puedeGestionarUsuarios;
  const puedeRoles    = permisos.puedeGestionarRoles;
  // SEC-15 (jerarquía fija del rol admin, migración 0050): el backend ya
  // rechaza que alguien sin rol admin cree/edite/elimine una cuenta admin.
  // esActorAdmin es solo para reflejar esa misma regla en la UI (ocultar
  // la opción "admin" del selector, bloquear las acciones sobre filas
  // admin) y evitar que alguien llegue a un error del servidor que ya
  // sabíamos que iba a pasar.
  const esActorAdmin = profile?.rol === "admin";

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
      <div className="uv-sin-permiso">
        No tienes permiso para acceder a esta sección.
      </div>
    );
  }

  return (
    <div className="uv-root">
      {/* Encabezado */}
      <div className="uv-header">
        <h1 className="uv-title">
          <i className="ti ti-crown uv-title-icon" />
          Gestión de Usuarios y Roles
        </h1>
        <p className="uv-subtitle">
          Administra quién puede acceder al sistema y qué puede hacer.
        </p>
      </div>

      {/* Pestañas (solo si tiene ambos permisos) */}
      {puedeUsuarios && puedeRoles && (
        <div className="uv-tabs">
          {[
            { id: "usuarios", icon: "ti-users",       label: "Usuarios" },
            { id: "roles",    icon: "ti-shield-lock",  label: "Roles y Permisos" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`uv-tab${tab === t.id ? ' uv-tab--active' : ''}`}
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
          esActorAdmin={esActorAdmin}
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
