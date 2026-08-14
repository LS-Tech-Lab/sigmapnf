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
import { logger } from "../utils/logger";

// Valores por defecto: si una clave de permiso no está presente en el
// jsonb del rol (por ejemplo, un rol viejo al que aún no se le agregó
// un permiso nuevo agregado luego), se asume `false` en vez de explotar.
export const PERMISOS_BASE = {
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
  puedeBorrarSesiones:       false,
  puedeBorrarReportes:       false,
  // ADMIN-3 (14 ago): borra audit_logs -- ver migración 0094 y el
  // precedente SEC-8 (0049) sobre por qué esto es una excepción deliberada,
  // no el patrón por defecto.
  puedeBorrarAuditoria:      false,
  // SEDE-1/SEDE-2: acceso a todas las sedes en vez de quedar fijo a una
  // sola. Se asigna por rol (0062), mismo patrón dinámico que el resto.
  puedeVerTodasLasSedes:     false,
};

// ── Permisos derivados del rol cargado desde la BD ───────────────────
export function calcularPermisos(profile) {
  if (!profile || !profile.rol_info) {
    return {
      ...PERMISOS_BASE,
      puedeVerSoloSuPrograma: false,
      programaRestringido:    null,
      programasRestringidos:  [],
      sedeAsignada:           null,
    };
  }

  const rolInfo = profile.rol_info;

  // PROG-3 (fase 2): programasRestringidos es la lista real de un
  // usuario, respaldada por user_profiles_programas (0078/0079) --
  // permite que un coordinador tenga más de un programa a cargo, cosa
  // que la columna escalar programaRestringido nunca pudo representar.
  // Fallback al escalar legado si la tabla nueva no trajo nada (usuario
  // creado antes de PROG-2, o la migración 0079 todavía sin aplicar en
  // este entorno) para no dejar a nadie sin acceso.
  const programasAsignados = (profile.programas_asignados || [])
    .map(p => p.programa).filter(Boolean);
  const programasRestringidos = rolInfo.restringe_programa
    ? (programasAsignados.length > 0 ? programasAsignados : [profile.programa].filter(Boolean))
    : [];

  return {
    ...PERMISOS_BASE,
    ...(rolInfo.permisos || {}),
    puedeVerSoloSuPrograma: !!rolInfo.restringe_programa,
    // programaRestringido (escalar) se conserva por compatibilidad con
    // código que todavía no migró a la lista -- siempre es el primero
    // de programasRestringidos, nunca una fuente independiente de dato.
    programaRestringido:   programasRestringidos[0] || null,
    programasRestringidos,
    // A diferencia de programaRestringido (depende del rol), sedeAsignada
    // depende del usuario: cada perfil trae su propio sede_id (0061), sin
    // importar el rol. Quien tenga puedeVerTodasLasSedes puede no tener
    // sede_id — en ese caso queda en null y el selector le ofrece todas.
    sedeAsignada: profile.sede_id ?? null,
  };
}

// ── Timeout de inactividad (Mejora 1 — auditoría Junio 2026) ─────────
// Cierra sesión automáticamente tras N ms sin actividad del usuario.
// Se cancela y reinicia con cada evento de mouse, teclado o touch.
// onTimeout debe ser estable (useCallback) para evitar re-registros.
//
// Fix SEC-21 (reportado por LS 10-jul-2026): el timer anterior vivía
// solo en memoria del componente. Cerrar la pestaña/navegador y
// reabrirla — aunque hubieran pasado días — reiniciaba el conteo
// desde cero, así que una sesión nunca se veía cerrar sola en ese
// escenario (alguien con acceso físico al equipo podía retomarla
// intacta). Ahora la última actividad se persiste en localStorage: al
// montar, si ya se venció el plazo mientras la pestaña estaba
// cerrada, se cierra sesión de inmediato; si no, el timer arranca con
// el tiempo *restante*, no con el plazo completo de nuevo.
//
// Esto es la capa client-side. Existe una segunda capa server-side
// (pg_cron, migración 0053_limpieza_sesiones_expiradas.sql) que cierra
// la sesión en auth.sessions aunque el cliente tenga JS deshabilitado
// o el localStorage haya sido manipulado — ver esa migración para el
// detalle de por qué hace falta esa capa además de esta.
const IDLE_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
const ACTIVIDAD_KEY = "sigma_ultima_actividad";

// Lee una marca de tiempo persistida y devuelve cuánto ha pasado desde
// entonces (ms), o null si no hay marca o localStorage no está disponible.
// Compartido entre el pre-chequeo de sesión inicial (evita el "flash" de
// login) y los propios hooks de idle-timeout / time-box más abajo, para
// no duplicar la lectura de localStorage en dos sitios distintos.
function tiempoTranscurridoDesde(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const marca = Number(raw);
    return Number.isFinite(marca) ? Date.now() - marca : null;
  } catch {
    return null; // localStorage no disponible (modo privado agresivo, etc.)
  }
}

function useIdleTimeout(timeoutMs, onTimeout, enabled) {
  const timerRef = useRef(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout; // siempre la versión más reciente sin re-registrar
  const ultimaEscrituraRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    // Throttle de la escritura a localStorage: no hace falta persistir
    // en cada mousemove, cada 5s alcanza para el propósito (sobrevivir
    // a un cierre de pestaña, no medir actividad al milisegundo).
    const marcarActividad = () => {
      const ahora = Date.now();
      if (ahora - ultimaEscrituraRef.current > 5000) {
        ultimaEscrituraRef.current = ahora;
        try { localStorage.setItem(ACTIVIDAD_KEY, String(ahora)); } catch { /* no-op: localStorage no disponible */ }
      }
    };

    const reset = () => {
      clearTimeout(timerRef.current);
      marcarActividad();
      timerRef.current = setTimeout(() => onTimeoutRef.current(), timeoutMs);
    };

    IDLE_EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));

    // Al montar (incluye reabrir la pestaña/navegador): comparar contra
    // la última actividad persistida en vez de arrancar el timer a ciegas.
    //
    // Nota: en el caso normal, esto ya NO dispara el logout — el
    // pre-chequeo en el efecto de sesión inicial (más abajo) lo hace
    // antes, mientras `user` sigue en `undefined` (pantalla "Verificando
    // sesión…"), para no mostrar la app ya autenticada y expulsar un
    // instante después (el "micro refresh" reportado por LS 3-ago-2026).
    // Este chequeo se deja como red de respaldo para el caso borde en que
    // el umbral correcto por rol (admin: 30 min) es más corto que el
    // umbral conservador usado en el pre-chequeo (60 min) — un admin
    // inactivo entre 30 y 60 min solo se detecta aquí, una vez que el
    // perfil (y por tanto su rol) ya cargó.
    const transcurrido = tiempoTranscurridoDesde(ACTIVIDAD_KEY);

    if (transcurrido !== null && transcurrido >= timeoutMs) {
      // Ya se venció el plazo mientras la pestaña estaba cerrada o en
      // background: cerrar sesión ya, sin esperar otro ciclo completo.
      onTimeoutRef.current();
    } else {
      ultimaEscrituraRef.current = Date.now();
      try { localStorage.setItem(ACTIVIDAD_KEY, String(Date.now())); } catch { /* no-op */ }
      const restante = transcurrido !== null ? Math.max(timeoutMs - transcurrido, 0) : timeoutMs;
      timerRef.current = setTimeout(() => onTimeoutRef.current(), restante);
    }

    return () => {
      clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach(e => window.removeEventListener(e, reset));
    };
  }, [timeoutMs, enabled]);
}

// ── Time-box absoluto de sesión (Fix SEC-21 — 10-jul-2026) ────────────
// Cierra la sesión a las TIME_BOX_MS desde el login, sin importar
// actividad. Mantener sincronizado con v_time_box en
// 0053_limpieza_sesiones_expiradas.sql (10h — jornada laboral de SIGMA).
// Esta es la capa client-side (UX inmediata); la capa que no se puede
// burlar editando localStorage es la del cron server-side, en esa
// misma migración.
const TIME_BOX_MS = 10 * 60 * 60 * 1000; // 10 horas
const SESSION_START_KEY = "sigma_inicio_sesion";

function useTimeBox(timeBoxMs, onTimeout, enabled) {
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    // Igual que en useIdleTimeout: el caso común (sesión vencida mientras
    // la pestaña estaba cerrada) ya lo intercepta el pre-chequeo del
    // efecto de sesión inicial, antes de mostrar la app. Esto queda como
    // respaldo.
    let transcurrido = tiempoTranscurridoDesde(SESSION_START_KEY);

    // Sin marca de inicio persistida (login nuevo en este navegador):
    // se establece ahora.
    if (transcurrido === null) {
      try { localStorage.setItem(SESSION_START_KEY, String(Date.now())); } catch { /* no-op */ }
      transcurrido = 0;
    }

    if (transcurrido >= timeBoxMs) {
      onTimeoutRef.current();
      return;
    }

    timerRef.current = setTimeout(() => onTimeoutRef.current(), timeBoxMs - transcurrido);
    return () => clearTimeout(timerRef.current);
  }, [timeBoxMs, enabled]);
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
        .select("*, rol_info:roles!user_profiles_rol_fk(nombre, label, emoji, color, restringe_programa, permisos), programas_asignados:user_profiles_programas(programa)")
        .eq("id", authUser.id)
        .single();

      if (error || !data) {
        // Usuario sin perfil: tratar como sin acceso
        logger.warn("⚠️ Usuario sin perfil en user_profiles:", authUser.email);
        setProfile(null);
      } else if (!data.activo) {
        // Cuenta desactivada
        setProfile({ ...data, _desactivado: true });
      } else if (!data.rol_info) {
        // Perfil con un rol que ya no existe en la tabla `roles`
        // (por ejemplo, fue borrado). Tratar como sin acceso.
        logger.warn("⚠️ El rol del usuario no existe en la tabla roles:", data.rol);
        setProfile({ ...data, _rolInvalido: true });
      } else {
        setProfile(data);
      }
    } catch (err) {
      logger.error("Error cargando perfil:", err);
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
    let cancelado = false;

    // Fix "pantalla de carga al volver de otra pestaña" (LS, 12-ago-2026):
    // supabase-js re-emite SIGNED_IN al recuperar la sesión cuando la
    // pestaña vuelve a estar visible (visibilitychange interno de
    // GoTrueClient), aunque sea EXACTAMENTE el mismo usuario ya
    // autenticado -- no es un login nuevo. El código de abajo trataba
    // cualquier SIGNED_IN como login fresco: recargaba el perfil entero
    // (=> <FullScreenSpinner label="Cargando perfil…"/> reemplaza todo el
    // árbol de la app, así que cualquier estado que viviera en un
    // componente hijo -- qué menú/pestaña estaba abierta dentro de
    // Horarios/Sistema, por ejemplo -- se perdía al desmontar y volver a
    // montar) y además reiniciaba el reloj de inactividad/time-box
    // (SEC-21/SEC-12), lo cual es un problema de seguridad aparte: un
    // usuario que alterna pestañas periódicamente nunca llegaría a
    // vencer su sesión por time-box.
    // lastUserId (variable de closure, no useRef -- este efecto corre una
    // sola vez por el ciclo de vida del hook, ver deps [cargarProfile] más
    // abajo) guarda el id del usuario ya autenticado para poder distinguir
    // "login genuino" (id distinto o no había nadie logueado) de
    // "re-emisión del mismo usuario" (mismo id) sin depender del estado
    // `user` de React, que dentro de este closure quedaría obsoleto.
    let lastUserId = null;

    // Fix "micro refresh" en login (LS, 3-ago-2026): antes, cuando la
    // sesión persistida ya había superado el idle-timeout o el time-box
    // (SEC-21) mientras la pestaña estaba cerrada, la app igual pasaba
    // por `setUser(authUser)` con la sesión "viva" — el usuario veía un
    // instante de UI autenticada (o el spinner de perfil) antes de que
    // useIdleTimeout/useTimeBox reaccionaran y forzaran handleLogout(),
    // lo que se percibía como un parpadeo/refresh seguido de vuelta al
    // login. Ahora ese vencimiento se resuelve AQUÍ, antes de exponer
    // ningún estado autenticado: mientras se resuelve, `user` se queda en
    // `undefined` (pantalla "Verificando sesión…"), así que si la sesión
    // ya venció, jamás se llega a pintar la app — se cierra sesión en
    // silencio y se va directo al login, sin flash intermedio.
    //
    // Usa el umbral MÁS LARGO (IDLE_DEFAULT_MS, 60 min) porque el rol
    // (que decide si el umbral real es de 30 o 60 min) todavía no se
    // conoce — el perfil no ha cargado. Esto cubre el caso común (horas
    // o días con la pestaña cerrada) sin falsos positivos. El caso borde
    // de un admin inactivo entre 30 y 60 min lo sigue atrapando
    // useIdleTimeout una vez que el perfil (y su rol) ya están disponibles.
    async function resolverSesionInicial(authUser) {
      if (initialHandled) return;
      initialHandled = true;

      if (authUser) {
        const transcurridoActividad = tiempoTranscurridoDesde(ACTIVIDAD_KEY);
        const transcurridoSesion    = tiempoTranscurridoDesde(SESSION_START_KEY);
        const expirada =
          (transcurridoActividad !== null && transcurridoActividad >= IDLE_DEFAULT_MS) ||
          (transcurridoSesion    !== null && transcurridoSesion    >= TIME_BOX_MS);

        if (expirada) {
          try {
            localStorage.removeItem(ACTIVIDAD_KEY);
            localStorage.removeItem(SESSION_START_KEY);
          } catch { /* no-op */ }
          try { await supabase.auth.signOut(); } catch { /* no-op: igual limpiamos el estado local */ }
          if (!cancelado) {
            setUser(null);
            setProfile(null);
            setLoadingProfile(false);
          }
          return;
        }
      }

      if (!cancelado) {
        lastUserId = authUser?.id ?? null;
        setUser(authUser);
        cargarProfile(authUser);
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      resolverSesionInicial(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const authUser = session?.user ?? null;

        // INITIAL_SESSION llega casi simultáneamente con getSession().
        // Si getSession ya procesó la sesión inicial, ignoramos este evento
        // para no relanzar cargarProfile innecesariamente y evitar pantalla negra.
        if (event === "INITIAL_SESSION") {
          await resolverSesionInicial(authUser);
          return;
        }

        setUser(authUser);
        // Sesión cerrada (SIGNED_OUT u otro evento sin usuario): limpiar
        // lastUserId para que, si el MISMO usuario vuelve a loguearse en
        // esta misma pestaña más tarde, su próximo SIGNED_IN se trate
        // como login genuino y no como re-emisión espuria.
        if (!authUser) lastUserId = null;

        // Ver comentario de lastUserId arriba: un SIGNED_IN para el
        // mismo usuario que ya estaba autenticado (típicamente al volver
        // de otra pestaña) no es un login real -- se ignoran sus efectos
        // (recarga de perfil, reinicio de idle/time-box, log de login)
        // y solo se deja el setUser(authUser) de arriba, que no rompe
        // nada por ser el mismo valor.
        const esMismoUsuarioYaAutenticado =
          event === "SIGNED_IN" && authUser && lastUserId === authUser.id;
        if (event === "SIGNED_IN" && authUser) lastUserId = authUser.id;

        // Fix #18: el log de SIGNED_IN se registra DESPUÉS de que
        // cargarProfile resuelva exitosamente, para evitar huecos en
        // la auditoría cuando el perfil falla (como ocurrió con el
        // error PGRST201 del fix #3). El setTimeout anterior no
        // garantizaba esto — solo añadía un delay arbitrario.
        if (event === "SIGNED_IN" && authUser && !esMismoUsuarioYaAutenticado) {
          // Fix "refresh a los segundos de loguear" (LS, 3-ago-2026):
          // handleLogout() limpia ACTIVIDAD_KEY/SESSION_START_KEY, pero un
          // login nuevo vía LoginScreen (signInWithPassword) llega aquí
          // directo, sin pasar por handleLogout. Si la sesión anterior
          // terminó sin logout explícito (pestaña cerrada, crash), esas
          // marcas quedaban viejas en localStorage — y en cuanto
          // useIdleTimeout se activaba (segundos después, al terminar de
          // cargar el perfil), las leía, las veía vencidas, y cerraba la
          // sesión recién iniciada. Un login fresco siempre debe arrancar
          // el reloj de inactividad/time-box desde cero.
          try {
            localStorage.removeItem(ACTIVIDAD_KEY);
            localStorage.removeItem(SESSION_START_KEY);
          } catch { /* no-op */ }
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
        } else if (esMismoUsuarioYaAutenticado) {
          // SIGNED_IN repetido para el mismo usuario (ver comentario arriba
          // de esMismoUsuarioYaAutenticado): no-op a propósito. Sin esta
          // rama, la condición cae al `else` final de la cadena y vuelve a
          // llamar cargarProfile(authUser), reproduciendo el mismo bug que
          // esta guarda existe para evitar.
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

    return () => {
      cancelado = true;
      subscription.unsubscribe();
    };
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
    // Limpiar las marcas de tiempo persistidas para que el próximo login
    // (mismo usuario u otro, en el mismo navegador) arranque el timeout
    // de inactividad y el time-box desde cero, no desde valores viejos.
    try {
      localStorage.removeItem(ACTIVIDAD_KEY);
      localStorage.removeItem(SESSION_START_KEY);
    } catch { /* no-op */ }
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
      logger.warn("⚠️ No se pudo registrar auditoría:", err.message);
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
  useTimeBox(TIME_BOX_MS, handleLogout, !!user && !loadingProfile);

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
