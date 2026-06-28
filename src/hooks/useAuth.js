/**
 * useAuth.js
 *
 * Hook central de autenticación y autorización.
 * Provee:
 *   - user: sesión de Supabase Auth
 *   - profile: perfil extendido con rol, programa, y la info del rol
 *     (label/emoji/color/restringe_programa) embebida en `profile.rol_info`
 *   - permisos: objeto calculado a partir de los permisos del rol del
 *     usuario, leídos en vivo desde la tabla `roles` (editable desde el
 *     panel de Gestión de Usuarios → Roles, sin necesidad de tocar código)
 *   - handleLogout
 *   - logAudit: registrar acción de auditoría
 *
 * Los roles dejaron de ser una lista fija en este archivo: viven en la
 * tabla `roles` (ver supabase/migrations/0013_*.sql) y se pueden crear,
 * editar o borrar desde la app. Este hook solo sabe leer el mapa de
 * permisos del rol que tenga el usuario logueado.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { limpiarCache } from "../utils/cache";

// Valores por defecto: si una clave de permiso no está presente en el
// jsonb del rol (por ejemplo, un rol viejo al que aún no se le agregó
// un permiso nuevo agregado luego), se asume `false` en vez de explotar.
const PERMISOS_BASE = {
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

// ── Permisos derivados del rol cargado desde la BD ───────────────────
function calcularPermisos(profile) {
  if (!profile || !profile.rol_info) {
    return {
      ...PERMISOS_BASE,
      puedeVerSoloSuPrograma: false,
      programaRestringido:    null,
    };
  }

  const rolInfo = profile.rol_info;

  return {
    ...PERMISOS_BASE,
    ...(rolInfo.permisos || {}),
    puedeVerSoloSuPrograma: !!rolInfo.restringe_programa,
    programaRestringido:    rolInfo.restringe_programa ? profile.programa : null,
  };
}

// ── Timeout de inactividad (Mejora 1 — auditoría Junio 2026) ─────────
// Cierra sesión automáticamente tras N ms sin actividad del usuario.
// Se cancela y reinicia con cada evento de mouse, teclado o touch.
// onTimeout debe ser estable (useCallback) para evitar re-registros.
const IDLE_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];

function useIdleTimeout(timeoutMs, onTimeout, enabled) {
  const timerRef = useRef(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout; // siempre la versión más reciente sin re-registrar

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onTimeoutRef.current(), timeoutMs);
    };

    IDLE_EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset(); // arrancar el timer inmediatamente al montar

    return () => {
      clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach(e => window.removeEventListener(e, reset));
    };
  }, [timeoutMs, enabled]);
}

// Tiempos de inactividad por rol (en ms). Cualquier rol no listado usa IDLE_DEFAULT.
const IDLE_ADMIN_MS   = 30 * 60 * 1000; // 30 min — roles administrativos
const IDLE_DEFAULT_MS = 60 * 60 * 1000; // 60 min — docentes y otros
const ROLES_ADMIN = ["admin", "coordinador", "coord"]; // ajustar según tabla roles

// ── Hook principal ──────────────────────────────────────────────────
export default function useAuth() {
  const [user,         setUser]         = useState(undefined); // undefined = cargando
  const [profile,      setProfile]      = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true); // true hasta que getSession resuelva
  const [sessionStart, setSessionStart] = useState(null);    // timestamp del login actual

  // Cargar perfil extendido desde user_profiles, con el rol embebido
  // (label/emoji/color/permisos/restringe_programa) para no necesitar
  // una segunda consulta cada vez que se calculan permisos.
  const cargarProfile = useCallback(async (authUser) => {
    if (!authUser) { setProfile(null); return; }
    setLoadingProfile(true);
    try {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*, rol_info:roles!user_profiles_rol_fk(nombre, label, emoji, color, restringe_programa, permisos)")
        .eq("id", authUser.id)
        .single();

      if (error || !data) {
        // Usuario sin perfil: tratar como sin acceso
        console.warn("⚠️ Usuario sin perfil en user_profiles:", authUser.email);
        setProfile(null);
      } else if (!data.activo) {
        // Cuenta desactivada
        setProfile({ ...data, _desactivado: true });
      } else if (!data.rol_info) {
        // Perfil con un rol que ya no existe en la tabla `roles`
        // (por ejemplo, fue borrado). Tratar como sin acceso.
        console.warn("⚠️ El rol del usuario no existe en la tabla roles:", data.rol);
        setProfile({ ...data, _rolInvalido: true });
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
    // Flag para evitar doble carga: onAuthStateChange dispara INITIAL_SESSION
    // casi simultáneamente con getSession(). En móvil (mayor latencia), la
    // duplicación causaba el ciclo undefined→null→user que dejaba pantalla negra.
    let initialHandled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialHandled) {
        initialHandled = true;
        setUser(session?.user ?? null);
        cargarProfile(session?.user ?? null);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const authUser = session?.user ?? null;

        // INITIAL_SESSION llega casi simultáneamente con getSession().
        // Si getSession ya procesó la sesión inicial, ignoramos este evento
        // para no relanzar cargarProfile innecesariamente y evitar pantalla negra.
        if (event === "INITIAL_SESSION") {
          if (!initialHandled) {
            initialHandled = true;
            setUser(authUser);
            cargarProfile(authUser);
          }
          return;
        }

        setUser(authUser);

        // Fix #18: el log de SIGNED_IN se registra DESPUÉS de que
        // cargarProfile resuelva exitosamente, para evitar huecos en
        // la auditoría cuando el perfil falla (como ocurrió con el
        // error PGRST201 del fix #3). El setTimeout anterior no
        // garantizaba esto — solo añadía un delay arbitrario.
        if (event === "SIGNED_IN" && authUser) {
          setSessionStart(new Date());
          cargarProfile(authUser).then(() => {
            (async () => {
              try {
                await supabase.rpc("log_session_event", {
                  p_evento:     "login",
                  p_user_agent: navigator.userAgent,
                  p_detalles:   {},
                });
              } catch (_) { /* no-op: los logs no deben bloquear */ }
            })();
          });
        } else if (event === "TOKEN_REFRESHED" && authUser) {
          // Mejora 2 (auditoría Junio 2026): registrar primera renovación del día.
          // No recargamos profile — el token se renovó, el usuario no cambió.
          // Solo logueamos si es la primera renovación de la fecha actual para
          // no saturar session_logs con una entrada por hora.
          (async () => {
            try {
              const hoy = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
              const lastKey = `sigma_token_refresh_${authUser.id}_${hoy}`;
              if (!sessionStorage.getItem(lastKey)) {
                sessionStorage.setItem(lastKey, "1");
                await supabase.rpc("log_session_event", {
                  p_evento:   "token_renovado",
                  p_detalles: { fecha: hoy },
                });
              }
            } catch { /* no-op */ }
          })();
        } else if (event === "USER_UPDATED" && authUser) {
          // Mejora 3 (auditoría Junio 2026): registrar cambios de credenciales.
          // Disparado por supabase.auth.updateUser() en ModalCambiarPassword.
          (async () => {
            try {
              await supabase.rpc("log_session_event", {
                p_evento:   "user_actualizado",
                p_detalles: { email: authUser.email },
              });
            } catch { /* no-op */ }
          })();
          cargarProfile(authUser); // recargar por si cambió email
        } else {
          cargarProfile(authUser);
        }

        // Fix A (auditoría Junio 2026): NO registrar logout aquí.
        // handleLogout() ya llama log_session_event('logout') ANTES de
        // signOut(), por lo que registrarlo aquí también generaba una
        // segunda fila duplicada con timestamps casi idénticos.
        // Si la sesión se cierra por revocación externa (Dashboard de
        // Supabase), ese evento quedará sin log — aceptable vs. el ruido
        // de duplicados que contaminaba la auditoría.
      }
    );

    return () => subscription.unsubscribe();
  }, [cargarProfile]);

  // Fix B (auditoría Junio 2026): handleLogin() eliminado — era código muerto.
  // LoginScreen.jsx llama directamente a supabase.auth.signInWithPassword y
  // registra los intentos fallidos en login_attempts vía log_login_fallido().
  // handleLogin duplicaba ese registro en session_logs creando inconsistencias
  // entre tablas. Fuente única de verdad: login_attempts + log_login_fallido.

  // Logout
  const handleLogout = useCallback(async () => {
    // Limpiar caché ANTES de signOut: si signOut falla, el caché
    // ya fue borrado y el próximo usuario no verá datos de este.
    limpiarCache(user?.id);
    setSessionStart(null);
    try {
      await supabase.rpc("log_session_event", { p_evento: "logout", p_detalles: {} });
    } catch { /* no-op */ }
    await supabase.auth.signOut();
  }, [user]);

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

  // D-5 fix (auditoría Junio 2026): suscripción Realtime a user_profiles.
  // Si un admin cambia el rol del usuario con sesión abierta, la sesión
  // seguía usando los permisos viejos hasta el próximo refresh de token JWT.
  // Ahora: cualquier UPDATE en el propio user_profiles recarga el perfil
  // inmediatamente, propagando los nuevos permisos sin esperar al JWT.
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`profile-changes-${user.id}`)
      .on(
        "postgres_changes",
        {
          event:  "UPDATE",
          schema: "public",
          table:  "user_profiles",
          filter: `id=eq.${user.id}`,
        },
        () => {
          // Recargar perfil completo (con rol_info embebido) para que
          // calcularPermisos() reciba los permisos actualizados.
          cargarProfile(user);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, cargarProfile]);

  // Timeout de inactividad — activo solo cuando hay sesión válida
  const idleMs = profile?.rol_info?.nombre && ROLES_ADMIN.includes(profile.rol_info.nombre)
    ? IDLE_ADMIN_MS
    : IDLE_DEFAULT_MS;
  useIdleTimeout(idleMs, handleLogout, !!user && !loadingProfile);

  return {
    user,
    profile,
    permisos,
    loadingProfile,
    sessionStart,
    handleLogout,
    logAudit,
    recargarProfile: () => cargarProfile(user),
  };
}
