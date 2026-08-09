// Pestaña "Planilla" del módulo Asistencias QR.
//
// A diferencia del resto del módulo QR (que solo lee asistencias_diarias),
// esta pestaña necesita el horario (tabla `horarios` + nombres de
// docentes/materias) para armar la planilla imprimible. El módulo QR no
// vive dentro de AppDataContext (ese contexto es exclusivo de
// HorariosLayout), así que esta pestaña se autoabastece con su propio
// fetch a Supabase en vez de depender de él.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { suscribirCambiosRemotos } from '../../lib/realtime';
import { getCurrentLapso, formatLapso } from '../../utils/lapso';
import { useReporteConfig } from '../../hooks/useReporteConfig';
import { useSedeContext } from '../../context/SedeContext';
import PlanillaImprimibleBase from './PlanillaImprimibleBase';

const PAGE_SIZE = 500;

export default function PlanillaQR({ permisos = {}, profile }) {
  // PROG-3 (fase 2): permisos.programasRestringidos (0078/0079) es la
  // lista real -- un coordinador puede tener más de un programa a
  // cargo. Fallback a profile.programa (escalar legado) si esa lista
  // viene vacía (perfil sin filas todavía en user_profiles_programas).
  const misProgramas = permisos.puedeVerSoloSuPrograma
    ? (permisos.programasRestringidos?.length > 0
        ? permisos.programasRestringidos
        : (profile?.programa ? [profile.programa] : []))
    : [];
  const restringidoAUnSolo = misProgramas.length === 1 ? misProgramas[0] : null;

  // SEDE-15: esta pestaña se autoabastece con su propio fetch a Supabase
  // (ver comentario de arriba) y por eso quedó fuera de la pasada SEDE-3
  // a SEDE-14 -- nunca leía sedeActiva, así que horarios/docentes/materias
  // de Cabimas (la única sede cargada hoy) se veían sin importar la sede
  // activa elegida. Mismo patrón de filtrado que useDataSync.js/
  // useNombresCache.js: .eq("sede_id", sedeActiva) cuando hay sede activa,
  // y sedeActiva como p_sede_id en la RPC SECURITY DEFINER.
  const { sedeActiva } = useSedeContext();

  const [lapso, setLapso] = useState(getCurrentLapso());
  // ARCH-41 (9 ago): lista real de trimestres para el selector, en vez del
  // cálculo por fecha de getLapsosDisponibles() (ver nota en utils/lapso.js).
  // Arranca vacía -- se llena tras el primer fetch a `trimestres` más abajo.
  const [trimestresDisponibles, setTrimestresDisponibles] = useState([]);
  const [programa, setPrograma] = useState(misProgramas[0] || "todos");
  const [programasDisponibles, setProgramasDisponibles] = useState([]);
  const [data, setData] = useState([]);
  const [docenteNames, setDocenteNames] = useState({});
  const [materiaNames, setMateriaNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // ADMIN-6: branding del membrete impreso — ver useReporteConfig.js.
  const { config: reporteConfig } = useReporteConfig();

  const getDocName = useCallback((raw) => docenteNames[raw] || raw, [docenteNames]);
  const getMateriaName = useCallback((raw) => materiaNames[raw] || raw, [materiaNames]);

  // Lista de nombre_raw conocidos, para el fallback fuzzy de parseClase()
  // cuando una fila de horarios aún no tiene docente_id vinculado.
  const catalogoDocentes = useMemo(() => Object.keys(docenteNames), [docenteNames]);

  // Se incrementa cuando llega un evento remoto de horarios (otro usuario
  // importó/editó el Excel) para forzar el refetch de la tabla horarios.
  const [horariosRefreshKey, setHorariosRefreshKey] = useState(0);

  // ARCH-41 (9 ago): trimestres reales disponibles para el selector.
  // Antes se generaban por cálculo de fecha (getLapsosDisponibles(), ±2
  // trimestres desde hoy) sin tocar la BD -- eso ofrecía trimestres que
  // nunca se crearon (sin fila en `trimestres`, sin datos en `horarios`,
  // p. ej. futuros aún no configurados o años viejos huérfanos) y podía
  // excluir uno real si quedaba fuera del rango ±2. Ahora se consulta
  // `trimestres` filtrando por estado -- 'activo' (el que está en curso)
  // y 'cerrado' (historial con datos reales) -- nunca 'planificado' si a
  // futuro se usa ese estado desde HistorialView antes de activarlo.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data: rows, error: errTrimestres } = await supabase
        .from("trimestres")
        .select("lapso, estado")
        .in("estado", ["activo", "cerrado"])
        .order("anio", { ascending: false })
        .order("numero", { ascending: false });
      if (cancelado) return;

      if (errTrimestres || !rows || rows.length === 0) {
        // Fallback defensivo: si `trimestres` no responde o aún no tiene
        // ninguna fila (ambiente recién creado), no dejamos el selector
        // vacío -- se ofrece el trimestre actual calculado como única
        // opción, igual que el comportamiento previo a este fix.
        setTrimestresDisponibles([getCurrentLapso()]);
        return;
      }

      const lapsos = rows.map(r => r.lapso);
      setTrimestresDisponibles(lapsos);

      // Si el lapso seleccionado (el calculado por fecha al montar el
      // componente) no tiene fila real en `trimestres`, lo corregimos: al
      // activo si existe, o si no, al más reciente de la lista.
      setLapso(prev => {
        if (lapsos.includes(prev)) return prev;
        const activo = rows.find(r => r.estado === "activo");
        return activo ? activo.lapso : lapsos[0];
      });
    })();
    return () => { cancelado = true; };
  }, []);

  // PROG-3 (fase 2): clamp defensivo, mismo criterio que App.jsx --
  // permisos/profile pueden llegar después del primer render (por
  // ejemplo justo al reconectar tras modo offline), así que el useState
  // inicial de `programa` no basta por sí solo.
  useEffect(() => {
    if (misProgramas.length > 0 && !misProgramas.includes(programa)) {
      setPrograma(misProgramas[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permisos.puedeVerSoloSuPrograma, JSON.stringify(misProgramas)]);

  // Lista de programas disponibles para el selector. Si el rol está
  // restringido a más de un programa, se ofrecen solo los suyos -- nunca
  // el catálogo completo ni la opción "todos".
  useEffect(() => {
    if (restringidoAUnSolo) return;
    if (misProgramas.length > 0) { setProgramasDisponibles(misProgramas); return; }
    (async () => {
      let query = supabase
        .from("horarios")
        .select("programa")
        .eq("lapso", lapso)
        .not("programa", "is", null);
      if (sedeActiva) query = query.eq("sede_id", sedeActiva);
      const { data: rows } = await query;
      const unicos = [...new Set((rows || []).map(r => r.programa).filter(Boolean))].sort();
      setProgramasDisponibles(unicos);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lapso, restringidoAUnSolo, sedeActiva, JSON.stringify(misProgramas)]);

  // Nombres de docentes y materias (display name, independiente del lapso).
  const fetchNombres = useCallback(async () => {
    const { data: docentes, error: errDoc } = await supabase.rpc(
      "docentes_con_cedula",
      sedeActiva ? { p_sede_id: sedeActiva } : {}
    );
    if (!errDoc && docentes) {
      setDocenteNames(Object.fromEntries(docentes.map(d => [d.nombre_raw, d.nombre_display])));
    } else {
      let queryDocFallback = supabase.from("docentes").select("nombre_raw, nombre_display");
      if (sedeActiva) queryDocFallback = queryDocFallback.eq("sede_id", sedeActiva);
      const { data: docentesFallback } = await queryDocFallback;
      if (docentesFallback) {
        setDocenteNames(Object.fromEntries(docentesFallback.map(d => [d.nombre_raw, d.nombre_display])));
      }
    }
    let queryMaterias = supabase.from("materias").select("nombre_raw, nombre_display");
    if (sedeActiva) queryMaterias = queryMaterias.eq("sede_id", sedeActiva);
    const { data: materias } = await queryMaterias;
    if (materias) {
      setMateriaNames(Object.fromEntries(materias.map(m => [m.nombre_raw, m.nombre_display])));
    }
  }, [sedeActiva]);

  useEffect(() => { fetchNombres(); }, [fetchNombres]);

  // Suscripción realtime: si alguien renombra/unifica un docente o materia
  // desde el menú de Docentes/Materias mientras esta pestaña está abierta,
  // refrescamos el mapa de nombres sin necesidad de recargar la página.
  // Si el cambio es en horarios (import de Excel), forzamos el refetch
  // del horario vía horariosRefreshKey.
  useEffect(() => {
    let cancelar = () => {};
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      cancelar = suscribirCambiosRemotos({
        lapso,
        onHorariosChange: () => setHorariosRefreshKey(k => k + 1),
        onDocentesChange: fetchNombres,
        onMateriasChange: fetchNombres,
      });
    });
    return () => cancelar();
  }, [lapso, fetchNombres]);

  // Horario del lapso/programa seleccionado, paginado para no chocar con
  // el límite de 1000 filas por consulta de Supabase.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const todasLasFilas = [];
        let cursor = 0;
        let hayMas = true;
        while (hayMas) {
          let query = supabase
            .from("horarios")
            .select("dia, hora, clase, aula, trayecto, sheet, programa, turno, id, docentes(nombre_raw), materias(nombre_raw)")
            .eq("lapso", lapso)
            .gt("id", cursor)
            .order("id", { ascending: true })
            .limit(PAGE_SIZE);
          if (programa !== "todos") query = query.eq("programa", programa);
          if (sedeActiva) query = query.eq("sede_id", sedeActiva);

          const { data: pagina, error: errPagina } = await query;
          if (errPagina) throw errPagina;
          if (cancelado) return;

          todasLasFilas.push(...(pagina || []));
          if (!pagina || pagina.length < PAGE_SIZE) { hayMas = false; }
          else { cursor = pagina[pagina.length - 1].id; }
        }
        if (!cancelado) setData(todasLasFilas);
      } catch (err) {
        if (!cancelado) setError(err.message);
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, [lapso, programa, horariosRefreshKey, sedeActiva]);

  return (
    <div>
      <div className="qr-filters">
        <div>
          <div className="qr-filter-label">Trimestre</div>
          <select
            value={lapso}
            onChange={(e) => setLapso(e.target.value)}
            className="qr-filter-select"
            disabled={trimestresDisponibles.length === 0}
          >
            {trimestresDisponibles.map(l => <option key={l} value={l}>{formatLapso(l)}</option>)}
          </select>
        </div>
        {!restringidoAUnSolo && (
          <div>
            <div className="qr-filter-label">Programa</div>
            <select
              value={programa}
              onChange={(e) => setPrograma(e.target.value)}
              className="qr-filter-select"
            >
              {/* PROG-3 (fase 2): "Todos" solo tiene sentido para quien no
                  tiene restricción de programa -- un coordinador con más
                  de uno elige entre los suyos, nunca ve el resto. */}
              {!permisos.puedeVerSoloSuPrograma && <option value="todos">Todos los programas</option>}
              {programasDisponibles.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="qr-loading">
          <i className="ti ti-loader-2 qr-loading-icon" aria-hidden="true" /> Cargando horario…
        </div>
      ) : error ? (
        <div className="s-card qr-error-card">
          Error al cargar el horario: {error}
        </div>
      ) : (
        <PlanillaImprimibleBase
          data={data}
          getDocName={getDocName}
          getMateriaName={getMateriaName}
          catalogoDocentes={catalogoDocentes}
          lapso={lapso}
          reporteConfig={reporteConfig}
        />
      )}
    </div>
  );
}
