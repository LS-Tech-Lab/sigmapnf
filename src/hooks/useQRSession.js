/**
 * useQRSession.js
 *
 * Hook que gestiona el ciclo de vida de una sesión QR.
 * IMPORTANTE: debe vivir en App.jsx (o en el componente padre del módulo
 * de asistencias) para que su estado NO se pierda al cambiar de pestaña
 * entre "Panel QR" y "Reporte".
 *
 * Fixes incluidos:
 *  - Estado persistente entre cambios de sub-vista (el hook vive arriba)
 *  - Rotación del token al registrarse un escaneo exitoso, acotada a como
 *    mucho una vez cada ROTACION_ESCANEO_MIN_INTERVALO_MS (throttle con
 *    trailing edge) para no invalidar el QR a mitad de un registro cuando
 *    varios docentes escanean casi al mismo tiempo (hora pico)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fechaHoyVE } from "../utils/time";
// FIX OFF-10 (opción A): caché local de sesiones pre-generadas mientras
// hay red, para poder activarlas sin RPC si el corte llega justo al
// momento de iniciar el turno. Ver src/utils/qrOfflineCache.js.
import { buscarSesionCacheada, guardarSesionCacheada } from "../utils/qrOfflineCache";

// ── Fix OFF-1 / OFF-4: exponer estado de red para que AdminQRPanel y
// QRProyeccion muestren un banner cuando no hay conexión.

// FIX OFF-11: antes una sola constante (TTL_MINUTES = 5) hacía dos trabajos
// distintos a la vez: (1) cada cuánto CAMBIA el valor del token (rotación,
// protección anti-foto-compartida) y (2) cuánto tiempo pasa antes de que el
// servidor considere el token VENCIDO (expires_at, respaldo si la rotación
// no llegó a ejecutarse). Con un corte eléctrico largo, la rotación se
// pausa por completo (ver goOffline más abajo) pero expires_at seguía
// venciendo a los 5 min igual — cualquier escaneo encolado offline después
// de esos primeros 5 min llegaba a sincronizar contra un token ya vencido
// (TOKEN_EXPIRADO en registrar_asistencia), aunque el docente sí escaneó
// dentro de la ventana real del corte.
//
// Se separan en dos constantes independientes:
//  - ROTATION_MINUTES: cadencia real de rotación mientras hay red. Se
//    mantiene en 5 min — esto es lo que protege contra una foto del QR
//    compartida, y NO debe cambiar.
//  - EXPIRY_TTL_MINUTES: valor de p_ttl_min que se envía en cada llamada a
//    crear_qr_session/renovar_qr_token. Ya no tiene que coincidir con la
//    cadencia de rotación — cada rotación exitosa empuja expires_at 6h
//    hacia adelante, así que el ÚLTIMO token capturado antes de un corte
//    sigue siendo válido para sincronizar horas después. No afecta la
//    exposición de una foto mientras hay red (el token igual rota cada 5
//    min); solo extiende cuánto sobrevive un token ya emitido cuando la
//    rotación no puede ejecutarse por falta de red.
const ROTATION_MINUTES   = 5;
const EXPIRY_TTL_MINUTES = 360; // 6 horas — cubre el peor caso reportado (cortes de 5+ h)

// FIX (realtime-fallback-polling-rotacion-qr): si asistencias_diarias no
// está en la publicación supabase_realtime, la rotación automática del
// token al detectar un escaneo (pensada para invalidar fotos compartidas
// del QR) nunca se disparaba. Este poll revisa cada cierto tiempo si hay
// registros nuevos para la sesión activa y, de haberlos, rota el token
// igual que lo haría el evento realtime.
const SCAN_POLL_MS = 7000;

// FIX (throttle-rotacion-por-escaneo): antes, CADA escaneo exitoso rotaba
// el token al instante (vía Realtime o, como respaldo, el poll de arriba).
// En hora pico, con varios docentes escaneando el mismo QR casi a la vez,
// el primer registro exitoso invalidaba el token para todos los que
// todavía estaban a mitad del formulario, obligándolos a reescanear.
//
// Se mantiene el objetivo antifraude (que una foto del QR deje de servir
// pronto), pero se acota la frecuencia de rotación por escaneo a como
// mucho una vez cada ROTACION_ESCANEO_MIN_INTERVALO_MS: es un throttle con
// "trailing edge", no un debounce puro — así una ráfaga continua de
// escaneos no puede posponer la rotación indefinidamente (ver
// `rotarPorEscaneoThrottled` más abajo). La rotación por TTL
// (`iniciarAutoRenovado`) y la manual (`renovarManual`) NO pasan por este
// throttle: deben seguir siendo inmediatas.
const ROTACION_ESCANEO_MIN_INTERVALO_MS = 12000;

export default function useQRSession() {
  const [sessionId,  setSessionId]  = useState(null);
  const [token,      setToken]      = useState(null);
  const [expiresAt,  setExpiresAt]  = useState(null);
  const [segundos,   setSegundos]   = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [activa,     setActiva]     = useState(false);
  // Fix OFF-1: exponer estado de red al exterior
  const [isOffline,  setIsOffline]  = useState(!navigator.onLine);
  // FIX OFF-10: true cuando crearSesion() se llamó sin red y tampoco había
  // una sesión pre-generada en caché para ese contexto — señal para que
  // AdminQRPanel ofrezca el modo de registro manual (opción C) en vez de
  // solo mostrar un error sin salida.
  const [requiereModoManual, setRequiereModoManual] = useState(false);

  const renewTimerRef  = useRef(null);
  const countdownRef   = useRef(null);
  // Ref para sessionId accesible dentro de closures de intervalos
  const sessionIdRef   = useRef(null);
  // FIX (realtime-fallback-polling-rotacion-qr): último conteo de
  // asistencias visto para la sesión activa, para detectar escaneos nuevos
  // por poll cuando el websocket de Realtime no entrega el evento.
  const scanCountRef   = useRef(0);
  const scanPollRef    = useRef(null);

  // FIX (throttle-rotacion-por-escaneo): estado del throttle. Vive en refs
  // porque los callbacks que lo usan (handler de Realtime, poll de
  // respaldo) están dentro de closures de efectos/intervalos y no deben
  // re-crearse en cada render.
  //   - ultimaRotacionEscaneoRef: timestamp (ms) de la última rotación
  //     disparada por un escaneo (no cuenta la rotación por TTL).
  //   - rotacionPendienteRef: handle del setTimeout "trailing" agendado
  //     para atrapar el escaneo que llegó durante la ventana de espera.
  const ultimaRotacionEscaneoRef = useRef(0);
  const rotacionPendienteRef     = useRef(null);

  const limpiarIntervalos = useCallback(() => {
    if (renewTimerRef.current)  clearInterval(renewTimerRef.current);
    if (countdownRef.current)   clearInterval(countdownRef.current);
    if (scanPollRef.current)    clearInterval(scanPollRef.current);
    if (rotacionPendienteRef.current) clearTimeout(rotacionPendienteRef.current);
    renewTimerRef.current    = null;
    countdownRef.current     = null;
    scanPollRef.current      = null;
    rotacionPendienteRef.current = null;
  }, []);

  // FIX OFF-11: el countdown visible (barra bajo el QR) representa "cuánto
  // falta para que este QR rote", no "cuánto falta para que el servidor lo
  // considere vencido" — son cosas distintas desde que expires_at pasó a
  // tener un margen de varias horas. Cuenta regresiva siempre desde
  // ROTATION_MINUTES, sin depender del expires_at real que devuelve el
  // servidor (ese expires_at real se sigue guardando en el estado
  // `expiresAt` por si algún consumidor futuro lo necesita, pero ya no
  // alimenta este countdown).
  const iniciarCountdownRotacion = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const objetivo = Date.now() + ROTATION_MINUTES * 60 * 1000;
    const tick = () => {
      const secsLeft = Math.max(0, Math.round((objetivo - Date.now()) / 1000));
      setSegundos(secsLeft);
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
  }, []);

  const renovarToken = useCallback(async (sid) => {
    const { data, error: rpcErr } = await supabase.rpc("renovar_qr_token", {
      p_session_id: sid,
      // FIX OFF-11: ya no coincide con la cadencia de rotación — ver
      // comentario de EXPIRY_TTL_MINUTES arriba.
      p_ttl_min:    EXPIRY_TTL_MINUTES,
    });
    if (rpcErr || !data?.ok) {
      setError(data?.mensaje || rpcErr?.message || "Error al renovar el token QR.");
      return false;
    }
    setToken(data.token);
    setExpiresAt(data.expires_at);
    iniciarCountdownRotacion();
    return true;
  }, [iniciarCountdownRotacion]);

  // FIX (throttle-rotacion-por-escaneo): punto único por el que deben pasar
  // las DOS fuentes de "rotar porque hubo un escaneo" (Realtime y el poll
  // de respaldo). Manual (`renovarManual`) y por TTL (`iniciarAutoRenovado`)
  // siguen llamando a `renovarToken` directo, sin pasar por aquí.
  //
  // Comportamiento (throttle con trailing edge):
  //   1. Si ya pasó ROTACION_ESCANEO_MIN_INTERVALO_MS desde la última
  //      rotación por escaneo, rota de inmediato (caso normal: un solo
  //      docente escaneando, sin ráfaga).
  //   2. Si no, y todavía no hay una rotación "trailing" agendada, agenda
  //      UNA para el tiempo que falte hasta completar el intervalo. Así,
  //      aunque lleguen 10 escaneos en esos segundos, solo se agenda un
  //      timeout (no uno por escaneo) y la rotación ocurre acotada por
  //      ROTACION_ESCANEO_MIN_INTERVALO_MS desde la última — nunca se
  //      pospone indefinidamente por más escaneos que sigan llegando.
  const rotarPorEscaneoThrottled = useCallback((sid) => {
    const ahora        = Date.now();
    const transcurrido  = ahora - ultimaRotacionEscaneoRef.current;

    if (transcurrido >= ROTACION_ESCANEO_MIN_INTERVALO_MS) {
      ultimaRotacionEscaneoRef.current = ahora;
      renovarToken(sid);
      return;
    }

    if (rotacionPendienteRef.current) return; // ya hay una trailing agendada

    const espera = ROTACION_ESCANEO_MIN_INTERVALO_MS - transcurrido;
    rotacionPendienteRef.current = setTimeout(() => {
      rotacionPendienteRef.current = null;
      ultimaRotacionEscaneoRef.current = Date.now();
      renovarToken(sid);
    }, espera);
  }, [renovarToken]);

  const iniciarAutoRenovado = useCallback((sid) => {
    if (renewTimerRef.current) clearInterval(renewTimerRef.current);
    // FIX OFF-11: antes calculaba el intervalo restando 15s al TTL real de
    // expiración (tenía sentido cuando ambos eran el mismo número). Ahora
    // la cadencia de rotación es fija e independiente del margen de
    // expiración que se manda al backend — rota cada ROTATION_MINUTES,
    // punto, sin importar cuán lejos esté el expires_at real.
    const intervalMs = ROTATION_MINUTES * 60 * 1000;
    renewTimerRef.current = setInterval(() => {
      renovarToken(sid);
    }, intervalMs);
  }, [renovarToken]);

  // ── Suscripción realtime: rota el token cuando llega un nuevo registro ────
  // Esto hace que una foto del QR compartida sea inútil al instante.
  useEffect(() => {
    if (!sessionId) return;
    sessionIdRef.current = sessionId;

    const channel = supabase
      .channel(`qr_rotate_on_scan_${sessionId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "asistencias_diarias",
          filter: `qr_session_id=eq.${sessionId}`,
        },
        () => {
          // FIX (throttle-rotacion-por-escaneo): antes llamaba a
          // renovarToken directo (rotación instantánea por cada escaneo).
          // Ahora pasa por el throttle para no penalizar escaneos
          // concurrentes en hora pico (ver definición arriba).
          rotarPorEscaneoThrottled(sessionIdRef.current);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [sessionId, rotarPorEscaneoThrottled]);

  // FIX (realtime-fallback-polling-rotacion-qr): poll de respaldo. Si la
  // tabla no está en supabase_realtime (ver migración
  // 0010_realtime_asistencias_qr.sql) o se pierde el websocket, esto
  // garantiza que el token igual rote poco después de un escaneo real,
  // en vez de quedarse fijo durante todo el TTL de 5 minutos.
  useEffect(() => {
    if (!sessionId) {
      scanCountRef.current = 0;
      if (scanPollRef.current) clearInterval(scanPollRef.current);
      return;
    }

    let cancelado = false;

    // Línea base: cuántos registros tiene la sesión al momento de activarse.
    supabase
      .from("asistencias_diarias")
      .select("id", { count: "exact", head: true })
      .eq("qr_session_id", sessionId)
      .then(({ count }) => { if (!cancelado) scanCountRef.current = count || 0; });

    scanPollRef.current = setInterval(async () => {
      // Fix OFF-4: no hacer queries si no hay conexión
      if (!navigator.onLine) return;

      const { count } = await supabase
        .from("asistencias_diarias")
        .select("id", { count: "exact", head: true })
        .eq("qr_session_id", sessionIdRef.current);

      if (count != null && count > scanCountRef.current) {
        scanCountRef.current = count;
        // FIX (throttle-rotacion-por-escaneo): mismo throttle que el
        // handler de Realtime — este poll es solo el respaldo por si el
        // websocket no entrega el evento, así que debe rotar con la misma
        // cadencia acotada, no de inmediato.
        rotarPorEscaneoThrottled(sessionIdRef.current);
      }
    }, SCAN_POLL_MS);

    return () => {
      cancelado = true;
      if (scanPollRef.current) clearInterval(scanPollRef.current);
    };
  }, [sessionId, rotarPorEscaneoThrottled]);

  const crearSesion = useCallback(async ({ turno, programa = null, fecha = null, sede_id = null }) => {
    setLoading(true);
    setError(null);
    setRequiereModoManual(false);
    limpiarIntervalos();
    // FIX (throttle-rotacion-por-escaneo): nueva sesión, nueva ventana de
    // throttle — que no arrastre el timestamp de una sesión anterior.
    ultimaRotacionEscaneoRef.current = 0;

    // FIX OFF-10: sin red, ya no bloquear de entrada — si hay una sesión
    // pre-generada en caché para este mismo contexto (turno/programa/
    // fecha/sede) y sigue vigente, se activa localmente sin llamar al RPC.
    // Los permisos/sede de esa sesión ya se validaron en el servidor en
    // el momento en que se preparó (con conexión real) — esto no es un
    // bypass, es usar algo que el servidor ya autorizó de antemano.
    if (!navigator.onLine) {
      const fechaCtx = fecha || fechaHoyVE();
      let cacheada = null;
      try {
        cacheada = await buscarSesionCacheada({ fecha: fechaCtx, turno, programa, sede_id });
      } catch {
        // IndexedDB no disponible — seguir al camino de "sin sesión preparada".
      }

      if (cacheada) {
        setSessionId(cacheada.sessionId);
        sessionIdRef.current = cacheada.sessionId;
        setToken(cacheada.token);
        setExpiresAt(cacheada.expiresAt);
        setActiva(true);
        iniciarCountdownRotacion();
        // Sin red no hay nada que renovar todavía — no se arranca
        // iniciarAutoRenovado acá. El listener de 'online' (más abajo)
        // ya renueva de inmediato y reanuda la auto-renovación en cuanto
        // vuelva la conexión, usando sessionIdRef.current.
        setLoading(false);
        return true;
      }

      setRequiereModoManual(true);
      setError(
        "No hay una sesión preparada para este turno y no hay conexión para crear una nueva. " +
        "Puedes usar el registro manual de respaldo mientras vuelve la red."
      );
      setLoading(false);
      return false;
    }

    // FIX OFF-11: p_ttl_min ya no es la cadencia de rotación — es el margen
    // de expiración de respaldo, deliberadamente holgado.
    const params = { p_turno: turno, p_ttl_min: EXPIRY_TTL_MINUTES };
    if (programa) params.p_programa = programa;
    if (fecha)    params.p_fecha    = fecha;
    // SEDE-3: solo hace falta mandarla cuando el usuario puede elegir
    // sede (AdminQRPanel siempre la manda si sedeActiva existe); si el
    // usuario tiene sede fija, crear_qr_session la resuelve sola del
    // perfil y este parámetro se ignora en el servidor.
    if (sede_id)  params.p_sede_id  = sede_id;

    const { data, error: rpcErr } = await supabase.rpc("crear_qr_session", params);

    if (rpcErr || !data?.ok) {
      setError(data?.mensaje || rpcErr?.message || "No se pudo crear la sesión QR.");
      setLoading(false);
      return false;
    }

    setSessionId(data.session_id);
    sessionIdRef.current = data.session_id;
    setToken(data.token);
    setExpiresAt(data.expires_at);
    setActiva(true);
    iniciarCountdownRotacion();
    iniciarAutoRenovado(data.session_id);
    setLoading(false);
    return true;
  }, [limpiarIntervalos, iniciarCountdownRotacion, iniciarAutoRenovado]);

  // FIX OFF-10 (opción A): llamar mientras HAY red para dejar lista una
  // sesión de un turno que todavía no empieza, por si el corte llega
  // antes de que toque iniciarlo. A diferencia de crearSesion(), esto NO
  // toca el estado de la sesión activa/mostrada en pantalla — solo crea
  // la fila en el servidor (con el mismo RPC, mismos chequeos de
  // permiso/sede de siempre) y la cachea en IndexedDB. Pensado para
  // turnos distintos al que está activo ahora mismo; si se llama para el
  // mismo turno que ya está en pantalla, la sesión vieja se desactiva en
  // el servidor igual que hace crear_qr_session siempre, pero la pantalla
  // no se actualiza sola — conviene restringir en la UI a turnos que
  // todavía no están activos.
  const prepararSesionOffline = useCallback(async ({ turno, programa = null, fecha = null, sede_id = null }) => {
    if (!navigator.onLine) {
      return { ok: false, mensaje: "Necesitas conexión para preparar una sesión offline." };
    }

    const fechaCtx = fecha || fechaHoyVE();
    const params = { p_turno: turno, p_ttl_min: EXPIRY_TTL_MINUTES, p_fecha: fechaCtx };
    if (programa) params.p_programa = programa;
    if (sede_id)  params.p_sede_id  = sede_id;

    const { data, error: rpcErr } = await supabase.rpc("crear_qr_session", params);
    if (rpcErr || !data?.ok) {
      return { ok: false, mensaje: data?.mensaje || rpcErr?.message || "No se pudo preparar la sesión." };
    }

    await guardarSesionCacheada({
      fecha: fechaCtx, turno, programa, sede_id,
      sessionId: data.session_id, token: data.token, expiresAt: data.expires_at,
    });

    return { ok: true, expiresAt: data.expires_at };
  }, []);

  const renovarManual = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    await renovarToken(sessionId);
    setLoading(false);
  }, [sessionId, renovarToken]);

  const cerrarSesion = useCallback(async () => {
    limpiarIntervalos();
    if (sessionId) {
      await supabase.from("qr_sessions").update({ activa: false }).eq("id", sessionId);
    }
    setSessionId(null);
    sessionIdRef.current = null;
    setToken(null);
    setExpiresAt(null);
    setSegundos(0);
    setActiva(false);
  }, [sessionId, limpiarIntervalos]);

  // ── Fix OFF-1: detectar online/offline y gestionar renovación automática ───
  useEffect(() => {
    const goOffline = () => {
      setIsOffline(true);
      // Pausar la renovación automática — no tiene sentido intentar RPC sin red
      if (renewTimerRef.current) {
        clearInterval(renewTimerRef.current);
        renewTimerRef.current = null;
      }
    };

    const goOnline = async () => {
      setIsOffline(false);
      // Reanudar renovación si hay sesión activa
      if (sessionIdRef.current) {
        // Renovar de inmediato para recuperar un token válido
        const ok = await renovarToken(sessionIdRef.current);
        if (ok) iniciarAutoRenovado(sessionIdRef.current);
      }
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online',  goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online',  goOnline);
    };
  }, [renovarToken, iniciarAutoRenovado]);

  useEffect(() => () => limpiarIntervalos(), [limpiarIntervalos]);

  // ── Recuperar sesión activa al montar (ej. tras recargar la página) ───────
  // ARCH-4: con AbortController para poder cancelar esta consulta si el
  // componente se desmonta antes de que responda (o si para entonces ya se
  // creó una sesión manualmente, ver guardia `activa` más abajo).
  useEffect(() => {
    const controller = new AbortController();
    const recuperar = async () => {
      // Solo intentar si no hay sesión en memoria
      if (activa) return;
      try {
        const { data } = await supabase
          .from("qr_sessions")
          .select("id, token, expires_at, turno, programa, fecha")
          .eq("activa", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .abortSignal(controller.signal)
          .maybeSingle();

        // ARCH-4: si se abortó (desmonte) o mientras tanto ya se creó/activó
        // una sesión por otra vía, descartar este resultado para no pisarla.
        if (controller.signal.aborted || activa) return;
        if (!data) return;

        // Verificar que el token aún no haya expirado
        const expira = new Date(data.expires_at);
        if (expira <= new Date()) return;

        setSessionId(data.id);
        sessionIdRef.current = data.id;
        setToken(data.token);
        setExpiresAt(data.expires_at);
        setActiva(true);
        // FIX OFF-11: al recuperar tras recargar la página no sabemos en
        // qué punto del ciclo de rotación real estaba (no se persiste
        // localmente), así que se reinicia el countdown visible desde
        // ROTATION_MINUTES completo — aproximación razonable, es solo un
        // indicador visual de "cuándo cambia el QR", no afecta validez.
        iniciarCountdownRotacion();
        iniciarAutoRenovado(data.id);
      } catch (err) {
        if (controller.signal.aborted || err.name === "AbortError") return;
        /* silencioso */
      }
    };
    recuperar();
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo al montar

  const qrUrl = token ? `${window.location.origin}/scan?token=${token}` : null;

  return {
    sessionId, token, expiresAt,
    segundosRestantes: segundos,
    qrUrl, activa, loading, error,
    isOffline,
    // FIX OFF-10: la UI usa esto para decidir si ofrece el formulario de
    // registro manual (opción C) tras un intento de iniciar sesión fallido
    // por falta de red y sin sesión pre-generada disponible.
    requiereModoManual,
    // FIX OFF-11: la UI (CountdownBar en QRDisplay.jsx) usa esto como
    // "total" del ciclo visible — debe ser la cadencia de rotación, no el
    // margen de expiración de respaldo.
    ttlMinutes: ROTATION_MINUTES,
    crearSesion, renovarManual, cerrarSesion,
    // FIX OFF-10: preparar (pre-generar + cachear) una sesión de un turno
    // que todavía no empieza, mientras hay red.
    prepararSesionOffline,
  };
}
