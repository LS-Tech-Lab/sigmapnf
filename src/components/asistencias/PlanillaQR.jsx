// Pestaña "Planilla" del módulo Asistencias QR.
//
// A diferencia del resto del módulo QR (que solo lee asistencias_diarias),
// esta pestaña necesita el horario (tabla `horarios` + nombres de
// docentes/materias) para armar la planilla imprimible. El módulo QR no
// vive dentro de AppDataContext (ese contexto es exclusivo de
// HorariosLayout), así que esta pestaña se autoabastece con su propio
// fetch a Supabase en vez de depender de él.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { suscribirCambiosRemotos } from '../../lib/realtime';
import { getCurrentLapso, getLapsosDisponibles, formatLapso } from '../../utils/lapso';
import PlanillaImprimibleBase from './PlanillaImprimibleBase';

const PAGE_SIZE = 500;

export default function PlanillaQR({ permisos = {}, profile }) {
  const restringidoAPrograma = permisos.puedeVerSoloSuPrograma ? profile?.programa : null;

  const [lapso, setLapso] = useState(getCurrentLapso());
  const [programa, setPrograma] = useState(restringidoAPrograma || "todos");
  const [programasDisponibles, setProgramasDisponibles] = useState([]);
  const [data, setData] = useState([]);
  const [docenteNames, setDocenteNames] = useState({});
  const [materiaNames, setMateriaNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const getDocName = useCallback((raw) => docenteNames[raw] || raw, [docenteNames]);
  const getMateriaName = useCallback((raw) => materiaNames[raw] || raw, [materiaNames]);

  // Lista de nombre_raw conocidos, para el fallback fuzzy de parseClase()
  // cuando una fila de horarios aún no tiene docente_id vinculado.
  const catalogoDocentes = Object.keys(docenteNames);

  // Se incrementa cuando llega un evento remoto de horarios (otro usuario
  // importó/editó el Excel) para forzar el refetch de la tabla horarios.
  const [horariosRefreshKey, setHorariosRefreshKey] = useState(0);

  // Lista de programas disponibles para el selector (solo si el rol no
  // está restringido a un único programa).
  useEffect(() => {
    if (restringidoAPrograma) return;
    (async () => {
      const { data: rows } = await supabase
        .from("horarios")
        .select("programa")
        .eq("lapso", lapso)
        .not("programa", "is", null);
      const unicos = [...new Set((rows || []).map(r => r.programa).filter(Boolean))].sort();
      setProgramasDisponibles(unicos);
    })();
  }, [lapso, restringidoAPrograma]);

  // Nombres de docentes y materias (display name, independiente del lapso).
  const fetchNombres = useCallback(async () => {
    const { data: docentes, error: errDoc } = await supabase.rpc("docentes_con_cedula");
    if (!errDoc && docentes) {
      setDocenteNames(Object.fromEntries(docentes.map(d => [d.nombre_raw, d.nombre_display])));
    } else {
      const { data: docentesFallback } = await supabase.from("docentes").select("nombre_raw, nombre_display");
      if (docentesFallback) {
        setDocenteNames(Object.fromEntries(docentesFallback.map(d => [d.nombre_raw, d.nombre_display])));
      }
    }
    const { data: materias } = await supabase.from("materias").select("nombre_raw, nombre_display");
    if (materias) {
      setMateriaNames(Object.fromEntries(materias.map(m => [m.nombre_raw, m.nombre_display])));
    }
  }, []);

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
  }, [lapso, programa, horariosRefreshKey]);

  return (
    <div>
      <div className="qr-filters">
        <div>
          <div className="qr-filter-label">Trimestre</div>
          <select
            value={lapso}
            onChange={(e) => setLapso(e.target.value)}
            className="qr-filter-select"
          >
            {getLapsosDisponibles().map(l => <option key={l} value={l}>{formatLapso(l)}</option>)}
          </select>
        </div>
        {!restringidoAPrograma && (
          <div>
            <div className="qr-filter-label">Programa</div>
            <select
              value={programa}
              onChange={(e) => setPrograma(e.target.value)}
              className="qr-filter-select"
            >
              <option value="todos">Todos los programas</option>
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
        />
      )}
    </div>
  );
}
