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

// ── Fix OFF-1 / OFF-4: exponer estado de red para que AdminQRPanel y
// QRProyeccion muestren un banner cuando no hay conexión.

const TTL_MINUTES = 5;

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

  const iniciarCountdown = useCallback((expiresAtStr) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const tick = () => {
      const secsLeft = Math.max(0, Math.round((new Date(expiresAtStr) - Date.now()) / 1000));
      setSegundos(secsLeft);
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
  }, []);

  const renovarToken = useCallback(async (sid) => {
    const { data, error: rpcErr } = await supabase.rpc("renovar_qr_token", {
      p_session_id: sid,
      p_ttl_min:    TTL_MINUTES,
    });
    if (rpcErr || !data?.ok) {
      setError(data?.mensaje || rpcErr?.message || "Error al renovar el token QR.");
      return false;
    }
    setToken(data.token);
    setExpiresAt(data.expires_at);
    iniciarCountdown(data.expires_at);
    return true;
  }, [iniciarCountdown]);

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
    // Renueva 15 s antes de expirar
    const intervalMs = (TTL_MINUTES * 60 - 15) * 1000;
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

  const crearSesion = useCallback(async ({ turno, programa = null, fecha = null }) => {
    setLoading(true);
    setError(null);
    limpiarIntervalos();
    // FIX (throttle-rotacion-por-escaneo): nueva sesión, nueva ventana de
    // throttle — que no arrastre el timestamp de una sesión anterior.
    ultimaRotacionEscaneoRef.current = 0;

    const params = { p_turno: turno, p_ttl_min: TTL_MINUTES };
    if (programa) params.p_programa = programa;
    if (fecha)    params.p_fecha    = fecha;

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
    iniciarCountdown(data.expires_at);
    iniciarAutoRenovado(data.session_id);
    setLoading(false);
    return true;
  }, [limpiarIntervalos, iniciarCountdown, iniciarAutoRenovado]);

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
        iniciarCountdown(data.expires_at);
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
    ttlMinutes: TTL_MINUTES,
    crearSesion, renovarManual, cerrarSesion,
  };
}
