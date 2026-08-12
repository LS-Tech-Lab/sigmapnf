/**
 * usuarios/index.jsx  (anteriormente UsuariosView.jsx)
 *
 * Orquestador del módulo de Gestión de Usuarios y Roles.
 * Maneja la selección de pestaña y la carga inicial de roles compartidos
 * (necesarios tanto por PestanaUsuarios como por PestanaRoles).
 *
 * Props:
 *   permisos  — objeto de permisos del usuario actual
 *   profile   — perfil del usuario actual: usado para saber si
 *               rol === "admin" (jerarquía fija de SEC-15, ver
 *               PestanaUsuarios/ModalUsuario) y para pasar profile.id
 *               como userId a useSedes() dentro de PestanaUsuarios
 *               (SEDE-18 -- sin esto, el selector de sede del modal de
 *               Nuevo/Editar usuario quedaba siempre vacío)
 *   programas — lista de programas disponibles (catálogo completo, sin
 *               filtrar por sede -- históricamente venía de
 *               `appData.data?.programas`, que nunca se llegó a poblar
 *               desde ningún lado; PROG-4 (12 ago 2026) lo reemplaza acá
 *               mismo por useProgramasActivosPorSede(), que sí carga
 *               contra el catálogo real -- se mantiene la prop como
 *               último fallback por si el hook no trae nada todavía)
 *   logAudit  — función de auditoría
 *   showToast — función de toast global
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { DEFAULT_PROGRAMAS } from "../../constants";
import useProgramasActivosPorSede from "../../hooks/useProgramasActivosPorSede";
import PestanaUsuarios from "./PestanaUsuarios";
import PestanaRoles    from "./PestanaRoles";
import "./index.css";

export default function UsuariosView({ permisos, profile, programas, logAudit, showToast }) {
  // PROG-4: catálogo real de programas + mapa de activos por sede, en
  // vez del prop `programas` (ver nota arriba). `catalogoNombres` ya es
  // "todos los programas activos del catálogo", así que reemplaza al
  // viejo fallback en el mismo orden de prioridad.
  const { catalogoNombres, mapaPorSede } = useProgramasActivosPorSede(profile?.id);
  const programasDisponibles = catalogoNombres.length
    ? catalogoNombres
    : (programas?.length ? programas : DEFAULT_PROGRAMAS);
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
          sedeProgramaActivo={mapaPorSede}
          showToast={showToast}
          logAudit={logAudit}
          userId={profile?.id}
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
