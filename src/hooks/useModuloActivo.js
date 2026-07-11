/**
 * useModuloActivo.js
 *
 * Gestiona qué módulo está activo: null (selector), "horarios",
 * "asistencias" o "admin" (ADMIN-3).
 *
 * Auto-selección: si el usuario solo tiene acceso a UNO de los tres
 * módulos, el useEffect lo selecciona automáticamente sin pasar por el
 * selector. Si tiene acceso a 2 o más, queda en null y se muestra el
 * ModuleSelector. Si no tiene acceso a ninguno (perfil sin permisos),
 * cae al mismo fallback que existía antes de ADMIN-3: "horarios" —
 * HorariosLayout ya maneja perfiles sin permisos vía sus propios guards.
 *
 * IMPORTANTE: este hook debe llamarse incondicionalmente (Regla de Hooks).
 * App.jsx lo invoca antes de cualquier return condicional.
 */

import { useState, useEffect } from "react";

export default function useModuloActivo({ efectiveProfile, efectivePermisos }) {
  const [moduloActivo, setModuloActivo] = useState(null);

  const tieneHorarios =
    efectivePermisos.puedeVerTodo || efectivePermisos.puedeVerSoloSuPrograma;
  const tieneQR =
    efectivePermisos.puedeGestionarQR || efectivePermisos.puedeVerReporteAsistencias;
  // ADMIN-3: Administración agrupa lo que antes vivía sin filtro de permiso
  // dentro de Horarios (Usuarios y Roles, Registros, Historial). Cualquiera
  // de estos permisos da acceso al módulo.
  const tieneAdmin =
    efectivePermisos.puedeGestionarUsuarios ||
    efectivePermisos.puedeGestionarRoles ||
    efectivePermisos.puedeVerLogs ||
    efectivePermisos.puedeVerAuditoria ||
    efectivePermisos.puedeGestionarTrimestres;

  // Auto-selección cuando el usuario solo tiene acceso a un módulo.
  // Se ejecuta cada vez que cambia el perfil o se resetea moduloActivo a null.
  useEffect(() => {
    if (!efectiveProfile || moduloActivo) return;

    const modulosDisponibles = [
      tieneHorarios && "horarios",
      tieneQR       && "asistencias",
      tieneAdmin    && "admin",
    ].filter(Boolean);

    if (modulosDisponibles.length === 1) {
      setModuloActivo(modulosDisponibles[0]);
    } else if (modulosDisponibles.length === 0) {
      // Mismo fallback que el comportamiento previo a ADMIN-3.
      setModuloActivo("horarios");
    }
    // 2 o más: queda en null → se muestra el ModuleSelector.
  }, [
    efectiveProfile,
    moduloActivo,
    tieneHorarios,
    tieneQR,
    tieneAdmin,
  ]);

  return { moduloActivo, setModuloActivo, tieneHorarios, tieneQR, tieneAdmin };
}
