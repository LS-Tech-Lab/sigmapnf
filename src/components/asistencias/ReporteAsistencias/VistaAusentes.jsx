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

      // FIX (ausentes-duplicados-por-texto): antes esta vista ignoraba
      // horarios.docente_id (el FK que useUpload.js ya resuelve con
      // matching fuzzy contra el catálogo al importar) y volvía a derivar
      // la identidad del docente parseando el texto de `clase` en cada
      // carga. Si el Excel maestro traía una variante de nombre distinta
      // (typo, nombre corto, tilde faltante) para un docente ya unificado
      // en `docentes`, esa variante se agrupaba aparte y el docente
      // reaparecía duplicado en Ausentes — incluso cuando docente_id ya
      // apuntaba correctamente a un solo registro.
      //
      // Ahora se agrupa por docente_id cuando existe (identidad estable,
      // uno por persona real). Solo se cae al parseo por texto + fuzzy
      // matching como último recurso, para horarios legacy sin docente_id
      // vinculado.
      let query = supabase
        .from("horarios")
        .select("clase, programa, sheet, hora, trayecto, docente_id, docentes(nombre_raw, nombre_display, cedula)")
        .eq("dia", dia);

      if (programa) query = query.eq("programa", programa);

      const { data: clases } = await query;

      if (!clases || clases.length === 0) {
        setAusentes([]);
        await guardarAusentesEnIDB(fecha, programa, []);
        setLoading(false);
        return;
      }

      // Catálogo de nombres completos (nombre_raw), usado únicamente como
      // fallback para resolver el nombre de horarios sin docente_id.
      const { data: docentesCatalogo } = await supabase
        .from("docentes")
        .select("nombre_raw, cedula");

      const catalogoDocentes = (docentesCatalogo || []).map(d => d.nombre_raw).filter(Boolean);
      const cedulaPorNombre = {};
      (docentesCatalogo || []).forEach(d => { if (d.cedula) cedulaPorNombre[d.nombre_raw] = d.cedula; });

      const porDocente = {};
      clases.forEach(c => {
        if (c.docente_id) {
          const key = `id:${c.docente_id}`;
          const nombre = c.docentes?.nombre_display || c.docentes?.nombre_raw || "(sin nombre)";
          const cedula = c.docentes?.cedula || null;
          if (!porDocente[key]) porDocente[key] = { nombre, clases: [], programa: c.programa, cedula };
          porDocente[key].clases.push(c);
          return;
        }

        // Fallback: registros sin docente_id vinculado (ej. importados
        // antes de que existiera la resolución fuzzy en useUpload.js).
        const { docente } = parseClase(c.clase, catalogoDocentes);
        if (!docente) return;
        const key = `raw:${docente}`;
        if (!porDocente[key]) porDocente[key] = { nombre: docente, clases: [], programa: c.programa, cedula: cedulaPorNombre[docente] || null };
        porDocente[key].clases.push(c);
      });

      const clavesDocente = Object.keys(porDocente);
      if (clavesDocente.length === 0) {
        setAusentes([]);
        await guardarAusentesEnIDB(fecha, programa, []);
        setLoading(false);
        return;
      }

      const resultado = Object.values(porDocente).filter(d => {
        if (d.cedula && cedulasPresentes.has(d.cedula)) return false;
        return true;
      }).map(d => ({
        ...d,
        sinVincular: !d.cedula,
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
