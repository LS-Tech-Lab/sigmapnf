// =====================================================================
// Realtime: invalidación de caché en vivo (Prioridad 8 del análisis)
//
// Antes: el caché en localStorage solo se refrescaba al recargar la
// página, al volver del modo offline, o tras una acción local del
// propio usuario. Si dos administradores trabajaban a la vez, cada uno
// veía datos potencialmente desactualizados hasta su próximo fetch.
//
// Ahora: nos suscribimos a los canales de Postgres Changes de Supabase
// para las tablas "horarios", "docentes" y "materias". Cuando otro
// cliente inserta/actualiza/borra una fila, se invoca un callback que
// el hook de datos usa para refrescar (limpiando primero el caché de
// esa entidad).
//
// Notas:
// - Se filtra por "lapso" cuando aplica para no recargar la app entera
//   cuando alguien edita un trimestre distinto al que se está viendo.
// - Los cambios se "debounce" levemente para evitar refrescos en
//   cascada cuando una importación masiva inserta muchas filas.
// =====================================================================

import { supabase } from "./supabase";
import { logger } from "../utils/logger";

const DEBOUNCE_MS = 800;

/**
 * Suscribe a cambios en horarios/docentes/materias y agrupa eventos
 * cercanos en el tiempo con un debounce antes de invocar los callbacks.
 *
 * @param {Object} opts
 * @param {string|null} opts.lapso - lapso actualmente activo en la UI.
 *   Si se provee, los cambios en "horarios" de otros lapsos se ignoran.
 * @param {() => void} opts.onHorariosChange
 * @param {() => void} opts.onDocentesChange
 * @param {() => void} opts.onMateriasChange
 * @returns {() => void} función para cancelar la suscripción
 */
export function suscribirCambiosRemotos({ lapso, onHorariosChange, onDocentesChange, onMateriasChange }) {
  const debounced = (timerRef, fn) => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fn, DEBOUNCE_MS);
    };
  };

  // Usamos objetos mutables para poder limpiar los timers en cleanup
  const horariosTimerRef = { current: null };
  const docentesTimerRef = { current: null };
  const materiasTimerRef = { current: null };

  const triggerHorarios = debounced(horariosTimerRef, () => onHorariosChange?.());
  const triggerDocentes = debounced(docentesTimerRef, () => onDocentesChange?.());
  const triggerMaterias = debounced(materiasTimerRef, () => onMateriasChange?.());

  const RECONNECT_DELAY_MS  = 3_000;  // espera antes del primer reintento
  const RECONNECT_MAX_DELAY = 30_000; // techo exponencial
  let reconnectTimer   = null;
  let reconnectAttempt = 0;
  let cancelled        = false;

  let channel;

  const conectar = () => {
    channel = supabase
      .channel(`horarios-sync-${lapso || "todos"}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "horarios" },
        (payload) => {
          const lapsoFila = payload.new?.lapso ?? payload.old?.lapso;
          if (lapso && lapsoFila !== undefined && lapsoFila !== null && lapsoFila !== lapso) {
            return;
          }
          triggerHorarios();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "docentes" },
        () => triggerDocentes()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "materias" },
        () => triggerMaterias()
      )
      .subscribe((status) => {
        // Fix #15: reconexión automática en redes inestables.
        // Supabase emite CHANNEL_ERROR o CLOSED cuando el WebSocket cae.
        // Reintentamos con backoff exponencial hasta que el componente
        // se desmonte (cancelled = true).
        if (status === "CHANNEL_ERROR" || status === "CLOSED") {
          if (cancelled) return;
          supabase.removeChannel(channel);
          const delay = Math.min(
            RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt),
            RECONNECT_MAX_DELAY
          );
          reconnectAttempt += 1;
          logger.warn(`[realtime] Canal caído (${status}). Reintento ${reconnectAttempt} en ${delay}ms…`);
          reconnectTimer = setTimeout(() => {
            if (!cancelled) conectar();
          }, delay);
        } else if (status === "SUBSCRIBED") {
          // Reconexión exitosa — reiniciar el contador
          reconnectAttempt = 0;
        }
      });
  };

  conectar();

  return () => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (horariosTimerRef.current) clearTimeout(horariosTimerRef.current);
    if (docentesTimerRef.current) clearTimeout(docentesTimerRef.current);
    if (materiasTimerRef.current) clearTimeout(materiasTimerRef.current);
    if (channel) supabase.removeChannel(channel);
  };
}
