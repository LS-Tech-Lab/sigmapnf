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
        .select("cedula")
        .in("cedula", cedulas);
      const vinculadas = new Set((data || []).map(d => d.cedula));
      setSinVincular(cedulas.filter(c => !vinculadas.has(c)));
    };
    fetch();
  }, [cedulasPresentes, loading]);

  if (sinVincular.length === 0) return null;

  return (
    <div className="asv-box">
      <i className="ti ti-alert-triangle asv-icon" aria-hidden="true" />
      <div>
        <div className="asv-title">
          {sinVincular.length} cédula{sinVincular.length > 1 ? "s" : ""} sin vincular al sistema de horarios
        </div>
        <div className="asv-desc">
          Los siguientes docentes marcaron asistencia pero su cédula no coincidió con ningún docente del horario.
          Ve a <strong>Docentes</strong> y asigna manualmente la cédula correspondiente para que su horario aparezca en el escaneo.
        </div>
        <div className="asv-chips">
          {sinVincular.map(c => (
            <span key={c} className="asv-chip">
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AlertaSinVincular;
