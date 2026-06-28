// Hook que escucha el evento `online` y vacía la cola de asistencias
// pendientes guardadas en IndexedDB durante períodos sin conexión.
// Montar una sola vez en App.jsx.

import { useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { obtenerPendientes, eliminarPendiente, contarPendientes } from '../utils/offlineQueue';

export default function useSyncPendientes(showToast) {
  const sync = useCallback(async () => {
    let pendientes;
    try {
      pendientes = await obtenerPendientes();
    } catch {
      return; // IndexedDB no disponible — ignorar
    }

    if (!pendientes?.length) return;

    let sincronizados = 0;
    let fallidos = 0;

    for (const item of pendientes) {
      const { id, creadoEn, ...payload } = item;
      try {
        const { data } = await supabase.rpc('registrar_asistencia', payload);
        // Consideramos éxito si ok=true o si ya estaba registrado (idempotente)
        if (data?.ok || data?.codigo === 'YA_REGISTRADO') {
          await eliminarPendiente(id);
          sincronizados++;
        } else {
          fallidos++;
        }
      } catch {
        fallidos++;
      }
    }

    if (sincronizados > 0) {
      showToast?.(
        `✅ ${sincronizados} registro${sincronizados > 1 ? 's' : ''} offline sincronizado${sincronizados > 1 ? 's' : ''} con éxito.`,
        'success'
      );
    }
    if (fallidos > 0) {
      showToast?.(
        `⚠️ ${fallidos} registro${fallidos > 1 ? 's' : ''} no pudieron sincronizarse. Se reintentará al reconectar.`,
        'warning'
      );
    }
  }, [showToast]);

  useEffect(() => {
    // Intentar sincronizar al montar (por si venimos de recargar con red)
    if (navigator.onLine) sync();

    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [sync]);
}
