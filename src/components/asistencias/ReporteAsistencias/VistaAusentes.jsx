// Pestaña "Ausentes": cruza los docentes con horario asignado ese día contra
// los que efectivamente marcaron asistencia, mostrando quién tenía clases y
// no apareció. Extraído de ReporteAsistencias.jsx.
//
// CRÍTICO #4: nueva pestaña que faltaba en el reporte original.

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { S } from "../../../constants";
import { parseClase } from "../../../utils/parsing";
import { diaSemana } from "./helpers";
import SkeletonRow from "./SkeletonRow";

// ── Vista: Ausentes ───────────────────────────────────────────────────────────
function VistaAusentes({ fecha, programa, cedulasPresentes }) {
  const [ausentes, setAusentes] = useState([]);
  const [loading,  setLoading]  = useState(false);

  const dia = diaSemana(fecha);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      // Docentes que tienen horario asignado ese día de la semana
      let query = supabase
        .from("horarios")
        .select("clase, programa, sheet, hora, trayecto")
        .eq("dia", dia);

      if (programa) query = query.eq("programa", programa);

      const { data: clases } = await query;

      if (!clases || clases.length === 0) {
        setAusentes([]);
        setLoading(false);
        return;
      }

      // Agrupar clases por docente (nombre_raw extraído de clase)
      const porDocente = {};
      clases.forEach(c => {
        const { docente } = parseClase(c.clase);
        if (!docente) return;
        if (!porDocente[docente]) porDocente[docente] = { nombre: docente, clases: [], programa: c.programa };
        porDocente[docente].clases.push(c);
      });

      // Cruzar contra cédulas presentes usando la tabla docentes
      const nombresDocentes = Object.keys(porDocente);
      if (nombresDocentes.length === 0) { setAusentes([]); setLoading(false); return; }

      const { data: docentesDB } = await supabase
        .from("docentes")
        .select("nombre_raw, cedula")
        .in("nombre_raw", nombresDocentes);

      const cedulaPorNombre = {};
      (docentesDB || []).forEach(d => { if (d.cedula) cedulaPorNombre[d.nombre_raw] = d.cedula; });

      // Filtrar: docentes con horario ese día y que NO aparecen en cedulasPresentes
      const resultado = Object.values(porDocente).filter(d => {
        const cedula = cedulaPorNombre[d.nombre];
        // Si tiene cédula vinculada y está presente → no es ausente
        if (cedula && cedulasPresentes.has(cedula)) return false;
        // Si tiene cédula vinculada y NO está presente → ausente confirmado
        if (cedula) return true;
        // Sin cédula vinculada → no podemos saber, lo marcamos como "sin vincular"
        return true;
      }).map(d => ({
        ...d,
        cedula: cedulaPorNombre[d.nombre] || null,
        sinVincular: !cedulaPorNombre[d.nombre],
      }));

      setAusentes(resultado.sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setLoading(false);
    };

    fetch();
  }, [fecha, programa, dia, cedulasPresentes]);

  if (dia === "SÁBADO" || dia === "DOMINGO") {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#9CA3AF", fontSize: 14 }}>
        No hay clases asignadas los fines de semana.
      </div>
    );
  }

  return (
    <div style={{ ...S.card, overflowX: "auto" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      {!loading && ausentes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#6B7280", fontSize: 14 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
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
                  <td style={{ ...S.td, fontWeight: 600, color: "#111827" }}>
                    {d.nombre}
                  </td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                    {d.sinVincular
                      ? <span style={{ color: "#D1D5DB", fontStyle: "italic" }}>sin vincular</span>
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
                  <td style={{ ...S.td, fontSize: 12, color: "#6B7280" }}>
                    {d.programa?.replace("PNF ", "") || "—"}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      )}
      {!loading && ausentes.length > 0 && (
        <div style={{ padding: "10px 16px", fontSize: 12, color: "#9CA3AF", borderTop: "1px solid #F3F4F6" }}>
          {ausentes.filter(d => !d.sinVincular).length} ausentes confirmados
          {ausentes.filter(d => d.sinVincular).length > 0 && ` · ${ausentes.filter(d => d.sinVincular).length} sin cédula vinculada (no verificables)`}
          {" · "} Día: {dia.charAt(0) + dia.slice(1).toLowerCase()}
        </div>
      )}
    </div>
  );
}

export default VistaAusentes;
