import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

function AlertaSinVincular({ cedulasPresentes, loading }) {
  const [sinVincular, setSinVincular] = useState([]);

  useEffect(() => {
    if (loading || cedulasPresentes.size === 0) { setSinVincular([]); return; }
    const fetch = async () => {
      const cedulas = [...cedulasPresentes];
      const { data } = await supabase
        .from("docentes")
        .select("cedula, nombre_display")
        .in("cedula", cedulas);
      const vinculadas = new Set((data || []).map(d => d.cedula));
      setSinVincular(cedulas.filter(c => !vinculadas.has(c)));
    };
    fetch();
  }, [cedulasPresentes, loading]);

  if (sinVincular.length === 0) return null;

  return (
    <div style={{
      background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10,
      padding: "12px 16px", marginBottom: 16,
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <i className="ti ti-alert-triangle" style={{ fontSize: 20, color: "#D97706", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
          {sinVincular.length} cédula{sinVincular.length > 1 ? "s" : ""} sin vincular al sistema de horarios
        </div>
        <div style={{ fontSize: 12, color: "#78350F", lineHeight: 1.5 }}>
          Los siguientes docentes marcaron asistencia pero su cédula no coincidió con ningún docente del horario.
          Ve a <strong>Docentes</strong> y asigna manualmente la cédula correspondiente para que su horario aparezca en el escaneo.
        </div>
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {sinVincular.map(c => (
            <span key={c} style={{
              fontSize: 12, fontFamily: "monospace", fontWeight: 700,
              background: "#FEF3C7", color: "#92400E",
              border: "1px solid #FDE68A", borderRadius: 5, padding: "2px 8px",
            }}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AlertaSinVincular;
