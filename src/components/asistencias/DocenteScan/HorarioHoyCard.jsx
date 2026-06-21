// Tarjeta "Tu horario de hoy" mostrada en la pantalla de resultado.
// Extraído de DocenteScan.jsx.
//
// horarioHoy: array de filas { materia (texto crudo "Materia Prof. X"), sheet,
// hora, trayecto, programa, aula } devueltas por la RPC. Se parsea cada
// `materia` con parseClase para mostrar solo el nombre de la materia (sin
// repetir "Prof. Nombre" del docente).

import { parseClase } from "../../../utils/parsing";
import { getHoraDisplayDeRegistro } from "../../../utils/time";

function HorarioHoyCard({ horarioHoy, diaSemana }) {
  if (!Array.isArray(horarioHoy) || horarioHoy.length === 0) {
    return (
      <div style={{ marginTop:16, background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:12, padding:"14px 18px", width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:12, color:"#64748B", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>
          {diaSemana ? `Horario de hoy (${diaSemana.charAt(0)}${diaSemana.slice(1).toLowerCase()})` : "Horario de hoy"}
        </div>
        <div style={{ fontSize:13, color:"#9CA3AF" }}>No tienes clases asignadas hoy según el sistema.</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop:16, background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:12, padding:"14px 18px", width:"100%" }}>
      <div style={{ fontSize:12, color:"#1D4ED8", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10, textAlign:"center" }}>
        {diaSemana ? `Tu horario de hoy (${diaSemana.charAt(0)}${diaSemana.slice(1).toLowerCase()})` : "Tu horario de hoy"}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {horarioHoy.map((clase, i) => {
          const { materia } = parseClase(clase.materia);
          return (
            <div key={i} style={{ background:"#fff", borderRadius:9, padding:"10px 12px", border:"1px solid #DBEAFE" }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#111827" }}>{materia || clase.materia}</div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
                <span style={{ fontSize:12, color:"#6B7280" }}>Sección {clase.sheet}</span>
                <span style={{ fontSize:12, color:"#1D4ED8", fontWeight:700 }}>{getHoraDisplayDeRegistro(clase)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HorarioHoyCard;
