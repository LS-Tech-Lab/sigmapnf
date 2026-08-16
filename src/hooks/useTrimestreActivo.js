/**
 * useTrimestreActivo.js
 *
 * ASIST-1: fuente de verdad única para "cuál es el trimestre activo" y
 * "el lapso seleccionado está en modo consulta (histórico)".
 *
 * Antes de este hook, dos lugares distintos calculaban el trimestre por
 * separado, con dos bugs relacionados:
 *
 *   - App.jsx (Horarios): el `lapso` inicial se calculaba con
 *     getCurrentLapso() -- una heurística por fecha del calendario
 *     (utils/lapso.js: ene-abr → 1, may-ago → 2, sep-dic → 3). Los
 *     trimestres reales NO siguen ese calendario fijo (confirmado por
 *     LS) -- pueden empezar/terminar en cualquier fecha. Si el trimestre
 *     que la heurística calcula ya está 'cerrado' en la tabla real
 *     `trimestres` (puede pasar: cerrar uno no activa automáticamente
 *     el siguiente), la app carga por defecto en modoConsulta = true
 *     sin que el usuario lo note, hasta que pulse "Volver al trimestre
 *     activo" manualmente.
 *   - PlanillaQR.jsx (Asistencias) ya había resuelto esto bien para su
 *     propio selector (ARCH-41, 9 ago): consulta `trimestres` de verdad
 *     en vez de calcular por fecha. Este hook generaliza ese patrón para
 *     que Horarios y el resto de Asistencias lo compartan, en vez de
 *     reimplementarlo cada uno por su lado.
 *
 * getCurrentLapso() se conserva SOLO como fallback defensivo si la tabla
 * `trimestres` no responde o está vacía (documentado también en su
 * propio JSDoc) -- nunca como el valor inicial real.
 *
 * Uso:
 *   const { lapso, setLapso, modoConsulta, trimestreActivo, trimestres,
 *           trimestresDisponibles, volverAlActivo } = useTrimestreActivo();
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { getCurrentLapso } from "../utils/lapso";
import { fechaHoyVE } from "../utils/time";

export default function useTrimestreActivo() {
  const [lapso, setLapsoState] = useState(() => getCurrentLapso());
  // Fila completa (lapso, estado) de trimestres 'activo'/'cerrado', para
  // no repetir el fetch en cada componente que necesite el selector.
  const [trimestres, setTrimestres] = useState([]);
  const [cargando, setCargando] = useState(true);
  const primerFetchHecho = useRef(false);

  const cargarTrimestres = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from("trimestres")
      .select("lapso, estado, fecha_inicio, fecha_fin")
      .in("estado", ["activo", "cerrado"])
      .order("anio", { ascending: false })
      .order("numero", { ascending: false });

    if (error || !rows || rows.length === 0) {
      // Fallback defensivo (ambiente nuevo sin filas en `trimestres`, o
      // error de red puntual): no dejamos nada vacío, se ofrece el
      // cálculo por fecha como única opción, igual que antes de ASIST-1.
      setTrimestres([{ lapso: getCurrentLapso(), estado: "activo", fecha_inicio: null, fecha_fin: null }]);
      return null;
    }

    setTrimestres(rows);
    return rows;
  }, []);

  // Al montar: cargar trimestres reales y corregir el lapso inicial si
  // hace falta -- si el heurístico no tiene fila real, o si tiene fila
  // pero no es el activo, se cae al activo real de la BD -- salvo que hoy
  // no caiga dentro de las fechas del activo (ver ASIST-8 abajo), en cuyo
  // caso se prefiere el último cerrado.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const rows = await cargarTrimestres();
      if (cancelado || !rows) { setCargando(false); return; }

      const activo = rows.find(r => r.estado === "activo");

      // ASIST-8 (caso real detectado 16 ago 2026, ver AUDITORIA_INDICE.md):
      // el `estado = 'activo'` en `trimestres` puede marcarse antes de que
      // el trimestre realmente empiece (fecha_inicio en el futuro) o
      // después de que termine -- deja un "hueco" donde el activo real no
      // tiene datos cargados todavía (horarios/asistencias vacíos) mientras
      // el último cerrado sigue siendo el que la gente necesita ver. Si hoy
      // no cae dentro de las fechas del activo, se prefiere el último
      // trimestre `cerrado` (mayor fecha_fin) como default -- el usuario
      // siempre puede cambiar manualmente vía el selector.
      const hoyISO = fechaHoyVE();
      const activoCubreHoy = !!(
        activo?.fecha_inicio && activo?.fecha_fin &&
        hoyISO >= activo.fecha_inicio && hoyISO <= activo.fecha_fin
      );
      const ultimoCerrado = rows
        .filter(r => r.estado === "cerrado" && r.fecha_fin)
        .sort((a, b) => (a.fecha_fin < b.fecha_fin ? 1 : -1))[0];
      const defaultSinActivoVigente = ultimoCerrado ? ultimoCerrado.lapso : (activo ? activo.lapso : rows[0].lapso);

      setLapsoState(prev => {
        const filaPrev = rows.find(r => r.lapso === prev);
        if (filaPrev?.estado === "activo") return prev;
        if (activo && activoCubreHoy) return activo.lapso;
        return filaPrev ? prev : defaultSinActivoVigente;
      });
      setCargando(false);
      primerFetchHecho.current = true;
    })();
    return () => { cancelado = true; };
  }, [cargarTrimestres]);

  const modoConsulta = (() => {
    const fila = trimestres.find(t => t.lapso === lapso);
    if (!fila) return false; // sin dato aún (cargando) o lapso no reconocido
    return fila.estado === "cerrado" || fila.estado === "archivado";
  })();

  const trimestreActivo = trimestres.find(t => t.estado === "activo")?.lapso || null;

  // ASIST-2: fila completa del trimestre activo (con fechas), para poder
  // avisar en Panel QR cuando "hoy" cae fuera de su rango -- caso real
  // detectado en los datos de prueba: se cierra un trimestre y el
  // siguiente todavía no arrancó (fecha_inicio en el futuro), dejando un
  // vacío donde ningún trimestre cubre la fecha de hoy.
  const trimestreActivoInfo = trimestres.find(t => t.estado === "activo") || null;
  const hoyISO = fechaHoyVE();
  const hoyEnTrimestreActivo = !!(
    trimestreActivoInfo?.fecha_inicio &&
    trimestreActivoInfo?.fecha_fin &&
    hoyISO >= trimestreActivoInfo.fecha_inicio &&
    hoyISO <= trimestreActivoInfo.fecha_fin
  );

  const setLapso = useCallback((nuevo) => {
    setLapsoState(nuevo);
  }, []);

  // Siempre consulta el estado más fresco en `trimestres` en el momento
  // del clic, no el array en memoria -- mismo criterio que ya usaba
  // App.jsx (evita quedar "atrapado" si el activo cambió recién).
  const volverAlActivo = useCallback(async () => {
    const { data } = await supabase
      .from("trimestres")
      .select("lapso")
      .eq("estado", "activo")
      .order("lapso", { ascending: false })
      .limit(1)
      .maybeSingle();
    const destino = data?.lapso || getCurrentLapso();
    setLapsoState(destino);
    return destino;
  }, []);

  return {
    lapso,
    setLapso,
    modoConsulta,
    trimestreActivo,
    trimestreActivoInfo,
    hoyEnTrimestreActivo,
    trimestresDisponibles: trimestres.map(t => t.lapso),
    // ASIST-4: fila completa (lapso, estado, fecha_inicio, fecha_fin) de
    // cada trimestre -- Reporte/Estadísticas la necesitan para poder
    // saltar a "ver todo el trimestre X" (fecha_inicio..fecha_fin) en sus
    // propios filtros de fecha/rango, no solo el lapso seleccionado.
    trimestres,
    cargando,
    volverAlActivo,
  };
}
