import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { parseClase } from "../../../utils/parsing";
import { diaSemana } from "./helpers";
import SkeletonRow from "./SkeletonRow";
import { guardarAusentesEnIDB, cargarAusentesDeIDB } from "../../../utils/reporteCache";
import "./index.css";
import "./VistaAusentes.css";

function VistaAusentes({ fecha, programa, cedulasPresentes, onAusentesChange }) {
  const [ausentes,    setAusentes]    = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [modoOffline, setModoOffline] = useState(false);
  const [fechaCache,  setFechaCache]  = useState(null);

  const dia = diaSemana(fecha);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      setModoOffline(false);

      // Sin red: cargar desde IDB
      if (!navigator.onLine) {
        const cached = await cargarAusentesDeIDB(fecha, programa);
        if (cached) {
          setAusentes(cached.datos);
          if (onAusentesChange) onAusentesChange(cached.datos);
          setModoOffline(true);
          setFechaCache(cached.guardadoEn);
        } else {
          setAusentes([]);
          setModoOffline(true);
          setFechaCache(null);
        }
        setLoading(false);
        return;
      }

      let query = supabase
        .from("horarios")
        .select("clase, programa, sheet, hora, trayecto")
        .eq("dia", dia);

      if (programa) query = query.eq("programa", programa);

      const { data: clases } = await query;

      if (!clases || clases.length === 0) {
        setAusentes([]);
        await guardarAusentesEnIDB(fecha, programa, []);
        setLoading(false);
        return;
      }

      // Catálogo de nombres completos (nombre_raw) para resolución fuzzy en parseClase.
      // Sin esto, parseClase no puede mapear nombres cortos/parciales de la celda
      // (ej. "ANILETH CALDERA") al nombre_raw canónico de la tabla docentes
      // (ej. "ANILETH CAROLINA CALDERA RODRIGUEZ"), y el docente queda marcado
      // erróneamente como "sin vincular".
      const { data: docentesCatalogo } = await supabase
        .from("docentes")
        .select("nombre_raw, cedula");

      const catalogoDocentes = (docentesCatalogo || []).map(d => d.nombre_raw).filter(Boolean);
      const cedulaPorNombre = {};
      (docentesCatalogo || []).forEach(d => { if (d.cedula) cedulaPorNombre[d.nombre_raw] = d.cedula; });

      const porDocente = {};
      clases.forEach(c => {
        const { docente } = parseClase(c.clase, catalogoDocentes);
        if (!docente) return;
        if (!porDocente[docente]) porDocente[docente] = { nombre: docente, clases: [], programa: c.programa };
        porDocente[docente].clases.push(c);
      });

      const nombresDocentes = Object.keys(porDocente);
      if (nombresDocentes.length === 0) {
        setAusentes([]);
        await guardarAusentesEnIDB(fecha, programa, []);
        setLoading(false);
        return;
      }

      const resultado = Object.values(porDocente).filter(d => {
        const cedula = cedulaPorNombre[d.nombre];
        if (cedula && cedulasPresentes.has(cedula)) return false;
        return true;
      }).map(d => ({
        ...d,
        cedula: cedulaPorNombre[d.nombre] || null,
        sinVincular: !cedulaPorNombre[d.nombre],
      }));

      const sorted = resultado.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setAusentes(sorted);
      if (onAusentesChange) onAusentesChange(sorted);
      await guardarAusentesEnIDB(fecha, programa, sorted);
      setLoading(false);
    };

    fetch();
  }, [fecha, programa, dia, cedulasPresentes]);

  if (modoOffline && !fechaCache && (dia !== "SÁBADO" && dia !== "DOMINGO")) {
    return (
      <div className="s-card va-offline-card">
        <i className="ti ti-wifi-off va-offline-icon" aria-hidden="true" />
        <div className="va-offline-title">Sin conexión</div>
        <div className="va-offline-desc">No hay datos de ausentes guardados para esta fecha y programa.</div>
      </div>
    );
  }

  if (dia === "SÁBADO" || dia === "DOMINGO") {
    return (
      <div className="va-weekend">
        No hay clases asignadas los fines de semana.
      </div>
    );
  }

  return (
    <div className="s-card va-card">
      {!loading && ausentes.length === 0 ? (
        <div className="va-empty">
          <i className="ti ti-mood-happy va-empty-icon" aria-hidden="true" />
          Todos los docentes con clases hoy marcaron asistencia.
        </div>
      ) : (
        <table className="va-table">
          <thead>
            <tr>
              {["Nombre docente", "Cédula", "Clases asignadas hoy", "Programa"].map(h => (
                <th key={h} className="s-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={4} />)
              : ausentes.map((d, i) => (
                <tr key={i} className="va-row">
                  <td className="s-td va-td-nombre">{d.nombre}</td>
                  <td className="s-td va-td-cedula">
                    {d.sinVincular
                      ? <span className="va-sinvincular">sin vincular</span>
                      : <span className="va-cedula-value">{d.cedula}</span>
                    }
                  </td>
                  <td className="s-td">
                    <div className="va-clases-wrap">
                      {d.clases.map((c, j) => {
                        const { materia } = parseClase(c.clase);
                        return (
                          <span key={j} className="va-clase-chip">
                            {materia || c.clase} · {c.sheet} · {c.hora}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="s-td va-td-programa">
                    {d.programa?.replace("PNF ", "") || "—"}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      )}
      {modoOffline && fechaCache && (
        <div className="va-offline-banner">
          <i className="ti ti-wifi-off va-offline-banner-icon" aria-hidden="true" />
          Modo offline — datos del {new Date(fechaCache).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}
        </div>
      )}
      {!loading && ausentes.length > 0 && (
        <div className="va-summary">
          {ausentes.filter(d => !d.sinVincular).length} ausentes confirmados
          {ausentes.filter(d => d.sinVincular).length > 0 && ` · ${ausentes.filter(d => d.sinVincular).length} sin cédula vinculada (no verificables)`}
          {" · "} Día: {dia.charAt(0) + dia.slice(1).toLowerCase()}
        </div>
      )}
    </div>
  );
}

export default VistaAusentes;
