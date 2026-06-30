// Pestaña "Planilla" del módulo Asistencias QR.
//
// A diferencia del resto del módulo QR (que solo lee asistencias_diarias),
// esta pestaña necesita el horario (tabla `horarios` + nombres de
// docentes/materias) para armar la planilla imprimible. El módulo QR no
// vive dentro de AppDataContext (ese contexto es exclusivo de
// HorariosLayout), así que esta pestaña se autoabastece con su propio
// fetch a Supabase en vez de depender de él.
import React, { useState, useEffect, useCallback } from 'react';
import { S } from '../../constants';
import { supabase } from '../../lib/supabase';
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
  useEffect(() => {
    (async () => {
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
    })();
  }, []);

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
            .select("dia, hora, clase, aula, trayecto, sheet, programa, turno, id")
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
  }, [lapso, programa]);

  return (
    <div>
      <div style={{ padding: "16px 20px 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", marginBottom: 6, textTransform: "uppercase" }}>Trimestre</div>
          <select
            value={lapso}
            onChange={(e) => setLapso(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, fontWeight: 600, color: "#0F172A" }}
          >
            {getLapsosDisponibles().map(l => <option key={l} value={l}>{formatLapso(l)}</option>)}
          </select>
        </div>
        {!restringidoAPrograma && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", marginBottom: 6, textTransform: "uppercase" }}>Programa</div>
            <select
              value={programa}
              onChange={(e) => setPrograma(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, fontWeight: 600, color: "#0F172A" }}
            >
              <option value="todos">Todos los programas</option>
              {programasDisponibles.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94A3B8", fontSize: 14 }}>
          <i className="ti ti-loader-2" style={{ fontSize: 20, animation: "spin 1s linear infinite" }} aria-hidden="true" /> Cargando horario…
        </div>
      ) : error ? (
        <div style={{ ...S.card, margin: 20, padding: 20, color: "#B91C1C", fontSize: 14 }}>
          Error al cargar el horario: {error}
        </div>
      ) : (
        <PlanillaImprimibleBase
          data={data}
          getDocName={getDocName}
          getMateriaName={getMateriaName}
          lapso={lapso}
        />
      )}
    </div>
  );
}
