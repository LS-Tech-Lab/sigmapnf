/**
 * usePerfilEfectivo.js
 *
 * Calcula el perfil y permisos efectivos fusionando la sesión de Supabase
 * con el perfil offline (acceso por PIN sin red).
 *
 * Reglas:
 *  - Si hay offlineProfile → usarlo como perfil, con permisos forzados a
 *    solo-lectura (sin importar, editar, gestionar QR ni borrar).
 *  - Si no → usar profile y permisos tal cual vienen de useAuth.
 *  - Al reconectar (user pasa a truthy) se descarta automáticamente el
 *    offlineProfile para forzar la sesión real de Supabase.
 */

import { useState, useEffect } from "react";

const PERMISOS_OFFLINE_BASE = {
  puedeVerTodo:              false,
  puedeImportarExcel:        false,
  puedeEditarHorarios:       false,
  puedeBorrarHorarios:       false,
  puedeEditarDocentes:       false,
  puedeEditarMaterias:       false,
  puedeGestionarTrimestres:  false,
  puedeHacerBackup:          false,
  puedeRestaurarBackup:      false,
  puedeGestionarUsuarios:    false,
  puedeGestionarRoles:       false,
  puedeVerLogs:              false,
  puedeVerAuditoria:         false,
  puedeGestionarQR:          false,
  puedeVerReporteAsistencias: false,
};

function calcularPermisosOffline(offlineProfile) {
  return {
    ...PERMISOS_OFFLINE_BASE,
    ...(offlineProfile.rol_info?.permisos || {}),
    // Forzar readonly sin importar lo que diga rol_info
    puedeImportarExcel:     false,
    puedeEditarHorarios:    false,
    puedeBorrarHorarios:    false,
    puedeGestionarQR:       false,
    puedeVerSoloSuPrograma: !!offlineProfile.rol_info?.restringe_programa,
    programaRestringido:    offlineProfile.rol_info?.restringe_programa
      ? offlineProfile.programa
      : null,
    // PROG-3 (fase 2): el snapshot offline (qrOfflineCache.js, OFF-10)
    // cachea el perfil con la columna escalar `programa`, no la lista de
    // user_profiles_programas -- expandir ese formato de caché queda
    // fuera de este alcance. Un coordinador multi-programa que entra en
    // modo offline-PIN ve solo su programa "principal" cacheado, no la
    // lista completa; es una limitación conocida y aceptable dado que el
    // acceso offline ya es de capacidad reducida en general.
    programasRestringidos: offlineProfile.rol_info?.restringe_programa
      ? [offlineProfile.programa].filter(Boolean)
      : [],
    // SEDE-2: igual que programaRestringido, viene del perfil cacheado,
    // no del rol. El acceso offline-PIN ya es de un solo dispositivo/
    // sede en la práctica, así que no hace falta forzarlo a false.
    sedeAsignada: offlineProfile.sede_id ?? null,
  };
}

export default function usePerfilEfectivo({ user, profile, permisos }) {
  const [offlineProfile, setOfflineProfile] = useState(null);

  // Al reconectar con sesión real de Supabase, descartar el perfil offline.
  useEffect(() => {
    if (user && offlineProfile) setOfflineProfile(null);
  }, [user, offlineProfile]);

  const efectiveProfile  = offlineProfile || profile;
  const efectivePermisos = offlineProfile
    ? calcularPermisosOffline(offlineProfile)
    : permisos;

  return { efectiveProfile, efectivePermisos, offlineProfile, setOfflineProfile };
}
