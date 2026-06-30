import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { S } from "../../../constants";
import { parseClase } from "../../../utils/parsing";
import { diaSemana } from "./helpers";
import SkeletonRow from "./SkeletonRow";
import { guardarAusentesEnIDB, cargarAusentesDeIDB } from "../../../utils/reporteCache";

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
      <div style={{ ...S.card, padding: "32px 24px", textAlign: "center", color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A" }}>
        <i className="ti ti-wifi-off" style={{ fontSize: 32, display: "block", marginBottom: 10 }} aria-hidden="true" />
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin conexión</div>
        <div style={{ fontSize: 13 }}>No hay datos de ausentes guardados para esta fecha y programa.</div>
      </div>
    );
  }

  if (dia === "SÁBADO" || dia === "DOMINGO") {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#64748B", fontSize: 14 }}>
        No hay clases asignadas los fines de semana.
      </div>
    );
  }

  return (
    <div style={{ ...S.card, overflowX: "auto" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      {!loading && ausentes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#64748B", fontSize: 14 }}>
          <i className="ti ti-mood-happy" style={{ fontSize: 36, color: "#22C55E", display: "block", marginBottom: 12 }} aria-hidden="true" />
          Todos los docentes con clases hoy marcaron asistencia.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Nombre docente", "Cédula", "Clases asignadas hoy", "Programa"].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={4} />)
              : ausentes.map((d, i) => (
                <tr key={i}
                  onMouseEnter={e => e.currentTarget.style.background = "#FFF7F7"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}
                  style={{ transition: "background 0.1s" }}
                >
                  <td style={{ ...S.td, fontWeight: 600, color: "#0F172A" }}>{d.nombre}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                    {d.sinVincular
                      ? <span style={{ color: "#CBD5E1", fontStyle: "italic" }}>sin vincular</span>
                      : <span style={{ color: "#DC2626", fontWeight: 600 }}>{d.cedula}</span>
                    }
                  </td>
                  <td style={S.td}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {d.clases.map((c, j) => {
                        const { materia } = parseClase(c.clase);
                        return (
                          <span key={j} style={{ fontSize: 11, background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA", borderRadius: 5, padding: "2px 7px", fontWeight: 500 }}>
                            {materia || c.clase} · {c.sheet} · {c.hora}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: "#64748B" }}>
                    {d.programa?.replace("PNF ", "") || "—"}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      )}
      {modoOffline && fechaCache && (
        <div style={{ padding: "8px 16px", fontSize: 12, color: "#92400E", background: "#FFFBEB", borderTop: "1px solid #FDE68A", display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-wifi-off" style={{ fontSize: 14 }} aria-hidden="true" />
          Modo offline — datos del {new Date(fechaCache).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}
        </div>
      )}
      {!loading && ausentes.length > 0 && (
        <div style={{ padding: "10px 16px", fontSize: 12, color: "#64748B", borderTop: "1px solid #F1F5F9" }}>
          {ausentes.filter(d => !d.sinVincular).length} ausentes confirmados
          {ausentes.filter(d => d.sinVincular).length > 0 && ` · ${ausentes.filter(d => d.sinVincular).length} sin cédula vinculada (no verificables)`}
          {" · "} Día: {dia.charAt(0) + dia.slice(1).toLowerCase()}
        </div>
      )}
    </div>
  );
}

export default VistaAusentes;
