/**
 * useAuth.js
 *
 * Hook central de autenticación y autorización.
 * Provee:
 *   - user: sesión de Supabase Auth
 *   - profile: perfil extendido con rol y programa
 *   - permisos: objeto calculado con flags de acceso
 *   - handleLogin / handleLogout
 *   - logAudit: registrar acción de auditoría
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

// ── Constantes de roles ─────────────────────────────────────────────
export const ROLES = {
  ADMIN:          "admin",
  COORDINADOR:    "coordinador",
  SECRETARIO:     "secretario",
  ADMINISTRATIVO: "administrativo",
  OPERADOR_QR:    "operador_qr",
};

// ── Permisos derivados del rol ───────────────────────────────────────
function calcularPermisos(profile) {
  if (!profile) return {
    puedeVerTodo:          false,
    puedeEditarHorarios:   false,
    puedeImportarExcel:    false,
    puedeBorrarHorarios:   false,
    puedeEditarDocentes:   false,
    puedeEditarMaterias:   false,
    puedeGestionarTrimestres: false,
    puedeHacerBackup:      false,
    puedeGestionarUsuarios: false,
    puedeVerLogs:          false,
    puedeVerSoloSuPrograma: false,
    esAdmin:               false,
    esCoordinador:         false,
    esSecretario:          false,
    esAdministrativo:      false,
    esOperadorQR:          false,
    programaRestringido:   null,
  };

  const rol = profile.rol;
  const esAdmin          = rol === ROLES.ADMIN;
  const esCoordinador    = rol === ROLES.COORDINADOR;
  const esSecretario     = rol === ROLES.SECRETARIO;
  const esAdministrativo = rol === ROLES.ADMINISTRATIVO;
  const esOperadorQR     = rol === ROLES.OPERADOR_QR;

  return {
    // Vista y datos
    puedeVerTodo:           esAdmin || esCoordinador,
    puedeVerSoloSuPrograma: esSecretario,
    programaRestringido:    esSecretario ? profile.programa : null,

    // Operaciones de escritura
    puedeEditarHorarios:      esAdmin || esCoordinador || esSecretario,
    puedeImportarExcel:       esAdmin || esCoordinador || esSecretario,
    puedeBorrarHorarios:      esAdmin || esCoordinador,
    puedeEditarDocentes:      esAdmin || esCoordinador || esSecretario,
    puedeEditarMaterias:      esAdmin || esCoordinador || esSecretario,
    puedeGestionarTrimestres: esAdmin || esCoordinador,
    puedeHacerBackup:         esAdmin || esCoordinador,
    puedeRestaurarBackup:     esAdmin,

    // Administración
    puedeGestionarUsuarios:   esAdmin,
    puedeVerLogs:             esAdmin || esCoordinador,
    puedeVerAuditoria:        esAdmin || esCoordinador || esSecretario,

    // Flags de rol
    esAdmin, esCoordinador, esSecretario, esAdministrativo, esOperadorQR,
  };
}

// ── Hook principal ──────────────────────────────────────────────────
export default function useAuth() {
  const [user,    setUser]    = useState(undefined); // undefined = cargando
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Cargar perfil extendido desde user_profiles
  const cargarProfile = useCallback(async (authUser) => {
    if (!authUser) { setProfile(null); return; }
    setLoadingProfile(true);
    try {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", authUser.id)
        .single();

      if (error || !data) {
        // Usuario sin perfil: tratar como sin acceso
        console.warn("⚠️ Usuario sin perfil en user_profiles:", authUser.email);
        setProfile(null);
      } else if (!data.activo) {
        // Cuenta desactivada
        setProfile({ ...data, _desactivado: true });
      } else {
        setProfile(data);
      }
    } catch (err) {
      console.error("Error cargando perfil:", err);
      setProfile(null);
    }
    setLoadingProfile(false);
  }, []);

  // Suscribirse a cambios de Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      cargarProfile(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const authUser = session?.user ?? null;
        setUser(authUser);
        cargarProfile(authUser);

        // Registrar eventos de sesión
        if (event === "SIGNED_IN" && authUser) {
          // Pequeño delay para que el perfil ya esté cargado
          setTimeout(async () => {
            try {
              await supabase.rpc("log_session_event", {
                p_evento:     "login",
                p_user_agent: navigator.userAgent,
                p_detalles:   {},
              });
            } catch { /* no-op: los logs no deben bloquear */ }
          }, 800);
        }

        if (event === "SIGNED_OUT") {
          // El profile ya no existe en este punto, pero intentamos loggear
          try {
            await supabase.rpc("log_session_event", {
              p_evento:   "logout",
              p_detalles: {},
            });
          } catch { /* no-op */ }
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [cargarProfile]);

  // Login
  const handleLogin = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Intentar registrar login fallido (sin sesión activa, puede fallar)
      try {
        await supabase.rpc("log_session_event", {
          p_evento:   "login_fallido",
          p_detalles: { email, motivo: error.message },
        });
      } catch { /* no-op */ }
      return { error };
    }
    return { error: null };
  }, []);

  // Logout
  const handleLogout = useCallback(async () => {
    try {
      await supabase.rpc("log_session_event", { p_evento: "logout", p_detalles: {} });
    } catch { /* no-op */ }
    await supabase.auth.signOut();
  }, []);

  // Registrar acción de auditoría
  const logAudit = useCallback(async ({
    accion,
    entidad          = null,
    entidad_id       = null,
    lapso            = null,
    programa_afectado = null,
    resumen          = null,
    datos_antes      = null,
    datos_despues    = null,
  }) => {
    try {
      await supabase.rpc("log_audit_event", {
        p_accion:            accion,
        p_entidad:           entidad,
        p_entidad_id:        entidad_id ? String(entidad_id) : null,
        p_lapso:             lapso,
        p_programa_afectado: programa_afectado,
        p_resumen:           resumen,
        p_datos_antes:       datos_antes,
        p_datos_despues:     datos_despues,
      });
    } catch (err) {
      // Los logs no deben romper la operación principal
      console.warn("⚠️ No se pudo registrar auditoría:", err.message);
    }
  }, []);

  const permisos = calcularPermisos(profile);

  return {
    user,
    profile,
    permisos,
    loadingProfile,
    handleLogin,
    handleLogout,
    logAudit,
    recargarProfile: () => cargarProfile(user),
  };
}
