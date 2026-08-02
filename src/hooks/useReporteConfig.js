// useReporteConfig.js — ADMIN-6 (auditoría 1 ago 2026)
//
// Carga la fila única de configuracion_reportes (migración 0056) para
// inyectar en el membrete de los 3 documentos imprimibles del sistema. Si
// la carga falla por cualquier motivo (red, fila borrada a mano, etc.) se
// queda en CONFIG_REPORTE_DEFAULT — la generación de un reporte nunca debe
// bloquearse ni quedar sin membrete por un fallo de este fetch secundario.
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { CONFIG_REPORTE_DEFAULT } from "../utils/reportePlantilla";

export function useReporteConfig() {
  const [config, setConfig]   = useState(CONFIG_REPORTE_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from("configuracion_reportes")
        .select("nombre_institucion, subtitulo_1, subtitulo_2, pie_texto, firma_label, logo_base64, color_clase")
        .eq("id", 1)
        .maybeSingle();

      if (err) {
        setError(err.message);
        // Se mantiene el último config conocido (o el default inicial) —
        // no se pisa con null/undefined ante un error transitorio.
      } else if (data) {
        setError(null);
        setConfig(data);
      }
      // Sin error y sin data (fila ausente): se queda con el default, sin
      // marcar error — es un estado válido (nadie configuró nada aún).
    } catch (e) {
      setError(e.message || "No se pudo cargar la configuración de reportes.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  return { config, loading, error, refetch: fetchConfig };
}
