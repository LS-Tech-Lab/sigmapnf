// Hook que escucha el evento `online` y vacía la cola de asistencias
// pendientes guardadas en IndexedDB durante períodos sin conexión.
// Montar una sola vez en App.jsx.
//
// Fix OFF-2: los registros irrecuperables se eliminan de IDB en lugar de
// reintentar indefinidamente. Se purgan también entradas con TTL > 48 h.
//
// UX-4: el hook ahora expone `pendientesCount` (número de registros en cola)
// para que el layout principal pueda mostrar un badge persistente mientras
// haya datos pendientes de sincronizar.

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  obtenerPendientes,
  eliminarPendiente,
  purgarExpirados,
  contarPendientes,
} from '../utils/offlineQueue';
// FIX OFF-10: cola separada para registros manuales (opción C — sin
// token/sesión QR). Ver comentario al inicio de manualAttendanceQueue.js
// sobre por qué no comparte store con la cola normal.
import {
  obtenerPendientesManuales,
  eliminarPendienteManual,
  purgarExpiradosManuales,
  contarPendientesManuales,
} from '../utils/manualAttendanceQueue';

// Códigos que la RPC registrar_asistencia() devuelve cuando el registro
// nunca podrá sincronizarse — eliminar de IDB sin reintentar.
// TOKEN_EXPIRADO      → el token QR venció (código real de la RPC en 0039)
// SESION_INACTIVA     → la sesión fue cerrada por el admin
// SESION_FECHA_INVALIDA → la sesión era de otro día
const CODIGOS_IRRECUPERABLES = new Set([
  'TOKEN_EXPIRADO',
  'SESION_INACTIVA',
  'SESION_FECHA_INVALIDA',
  'TOKEN_INVALIDO',
]);

// Códigos de éxito idempotente: el registro ya está en BD
const CODIGOS_YA_REGISTRADO = new Set([
  'YA_REGISTRADO',
  'YA_REGISTRADO_SALIDA',
]);

// FIX OFF-10: códigos de registrar_asistencia_manual (migración 0071) que
// nunca van a arreglarse reintentando — son problemas de forma del dato
// mismo, no de red ni de estado del servidor. SIN_ENTRADA_PREVIA queda
// afuera a propósito: si el admin encoló ENTRADA y SALIDA del mismo
// docente en la misma sesión offline, un ciclo de sync puede sincronizar
// la ENTRADA antes que la SALIDA — reintentar en el próximo ciclo puede
// resolverlo solo. SIN_PERMISO/SIN_SEDE/SEDE_REQUERIDA también quedan
// afuera: son fallas de permiso, no de dato — mejor que sigan
// reintentando (y avisando por toast) a que se descarten en silencio un
// registro de asistencia real por un problema que amerita que alguien lo
// revise.
const CODIGOS_IRRECUPERABLES_MANUAL = new Set([
  'TIPO_INVALIDO',
  'TURNO_INVALIDO',
  'FECHA_INVALIDA',
]);

export default function useSyncPendientes(showToast) {
  // UX-4: contador de registros pendientes en IDB
  const [pendientesCount, setPendientesCount] = useState(0);

  // UX-4 + FIX OFF-10: contador combinado — desde la UI ambas colas son
  // "registros de asistencia pendientes de sincronizar", sin distinción.
  const refreshCount = useCallback(async () => {
    try {
      const [n, nManual] = await Promise.all([
        contarPendientes().catch(() => 0),
        contarPendientesManuales().catch(() => 0),
      ]);
      setPendientesCount(n + nManual);
    } catch {
      // IDB no disponible — dejar el estado anterior
    }
  }, []);

  const sync = useCallback(async () => {
    // Fix OFF-2: purgar entradas expiradas (>48 h) antes de intentar sync
    try { await purgarExpirados(); } catch { /* silencioso */ }

    let pendientes;
    try {
      pendientes = await obtenerPendientes();
    } catch {
      return; // IndexedDB no disponible — ignorar
    }

    if (!pendientes?.length) {
      setPendientesCount(0);
      return;
    }

    let sincronizados  = 0;
    let fallidos       = 0;
    let irrecuperables = 0;

    for (const item of pendientes) {
      const { id, creadoEn, ...payload } = item;
      try {
        const { data } = await supabase.rpc('registrar_asistencia', payload);

        if (data?.ok || CODIGOS_YA_REGISTRADO.has(data?.codigo)) {
          // Registrado correctamente o ya estaba en BD (idempotente)
          await eliminarPendiente(id);
          sincronizados++;
        } else if (CODIGOS_IRRECUPERABLES.has(data?.codigo)) {
          // Fix OFF-2: el registro nunca podrá sincronizarse → purgar de IDB
          await eliminarPendiente(id);
          irrecuperables++;
        } else {
          // Error transitorio (red, Supabase caído, etc.) → reintentar luego
          fallidos++;
        }
      } catch {
        fallidos++;
      }
    }

    // UX-4: refrescar contador tras sincronizar
    await refreshCount();

    if (sincronizados > 0) {
      showToast?.(
        `✅ ${sincronizados} registro${sincronizados > 1 ? 's' : ''} offline sincronizado${sincronizados > 1 ? 's' : ''} con éxito.`,
        'success'
      );
    }
    if (irrecuperables > 0) {
      showToast?.(
        `⚠️ ${irrecuperables} registro${irrecuperables > 1 ? 's' : ''} offline no pudieron sincronizarse: el código QR ya había expirado o la sesión fue cerrada. Comuníquelo al coordinador para registrarlo manualmente.`,
        'warning'
      );
    }
    if (fallidos > 0) {
      showToast?.(
        `⚠️ ${fallidos} registro${fallidos > 1 ? 's' : ''} no pudieron sincronizarse. Se reintentará al reconectar.`,
        'warning'
      );
    }
  }, [showToast, refreshCount]);

  // FIX OFF-10: mismo patrón que sync() de arriba, pero contra
  // registrar_asistencia_manual — sin token, con p_fecha/p_turno/p_sede_id
  // explícitos porque no hay sesión QR de la que heredarlos.
  const syncManuales = useCallback(async () => {
    try { await purgarExpiradosManuales(); } catch { /* silencioso */ }

    let pendientes;
    try {
      pendientes = await obtenerPendientesManuales();
    } catch {
      return;
    }

    if (!pendientes?.length) return;

    let sincronizados  = 0;
    let fallidos       = 0;
    let irrecuperables = 0;

    for (const item of pendientes) {
      const { id, creadoEn, cedula, nombre, tipo, turno, programa, fecha, sede_id } = item;
      try {
        const { data } = await supabase.rpc('registrar_asistencia_manual', {
          p_cedula_docente: cedula,
          p_nombre_docente: nombre,
          p_fecha:          fecha,
          p_turno:          turno,
          p_tipo:           tipo,
          p_programa:       programa || null,
          p_sede_id:        sede_id || null,
        });

        if (data?.ok || CODIGOS_YA_REGISTRADO.has(data?.codigo)) {
          await eliminarPendienteManual(id);
          sincronizados++;
        } else if (CODIGOS_IRRECUPERABLES_MANUAL.has(data?.codigo)) {
          await eliminarPendienteManual(id);
          irrecuperables++;
        } else {
          fallidos++;
        }
      } catch {
        fallidos++;
      }
    }

    await refreshCount();

    if (sincronizados > 0) {
      showToast?.(
        `✅ ${sincronizados} registro${sincronizados > 1 ? 's' : ''} manual${sincronizados > 1 ? 'es' : ''} de asistencia sincronizado${sincronizados > 1 ? 's' : ''}.`,
        'success'
      );
    }
    if (irrecuperables > 0) {
      showToast?.(
        `⚠️ ${irrecuperables} registro${irrecuperables > 1 ? 's' : ''} manual${irrecuperables > 1 ? 'es' : ''} no se pudo sincronizar por datos inválidos. Revísalo con el coordinador.`,
        'warning'
      );
    }
    if (fallidos > 0) {
      showToast?.(
        `⚠️ ${fallidos} registro${fallidos > 1 ? 's' : ''} manual${fallidos > 1 ? 'es' : ''} no se pudo sincronizar todavía. Se reintentará al reconectar.`,
        'warning'
      );
    }
  }, [showToast, refreshCount]);

  useEffect(() => {
    // Leer el contador al montar (por si hay pendientes de una sesión anterior)
    refreshCount();

    // Intentar sincronizar al montar (por si venimos de recargar con red)
    if (navigator.onLine) { sync(); syncManuales(); }

    const handleOnline = () => { sync(); syncManuales(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [sync, syncManuales, refreshCount]);

  return { pendientesCount, refreshCount };
}
