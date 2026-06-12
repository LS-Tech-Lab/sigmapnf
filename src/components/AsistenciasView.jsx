import React, { useState, useMemo } from 'react';
import { S, DAYS, TRAYECTO_BG, TRAYECTO_COLORS } from '../constants';
import { getTurnoDeRegistro } from '../utils/turno';
import { getHoraDisplayDeRegistro, getHoraMin } from '../utils/time';
import { parseClase } from '../utils/parsing';
import { getCurrentLapso } from '../utils/lapso';
import Avatar from './Avatar';

export default function AsistenciasView({ data, getDocName, getMateriaName, lapso }) {
  const lapsoActual = lapso || getCurrentLapso();
  const [turno, setTurno] = useState("DIURNO"), [selectedDay, setSelectedDay] = useState(DAYS[0]);

  const docentesDelDia = useMemo(() => {
    const map = {};
    data.filter(d => getTurnoDeRegistro(d) === turno && d.dia === selectedDay).forEach(d => {
      const { docente, materia } = parseClase(d.clase);
      if (!docente) return;
      if (!map[docente]) map[docente] = { clases: [] };
      map[docente].clases.push({
        materia: getMateriaName(materia),
        hora: getHoraDisplayDeRegistro(d),
        horaMin: getHoraMin(d),
        seccion: d.sheet.trim(),
        trayecto: d.trayecto,
        aula: d.aula
      });
    });
    Object.values(map).forEach(v => { v.clases.sort((a, b) => a.horaMin - b.horaMin); });
    return Object.entries(map).sort((a, b) => getDocName(a[0]).localeCompare(getDocName(b[0])));
  }, [data, turno, selectedDay, getDocName, getMateriaName]);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) { alert("⚠️ El navegador bloqueó la ventana emergente."); return; }
    const html = `<!DOCTYPE html><html><head><title>Asistencia</title><style>*{margin:0;padding:0}body{font-family:Arial;font-size:12px}.page{padding:20px}h1{font-size:16px}.subtitle{font-size:12px;color:#555;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;border:1px solid #ccc;padding:8px;font-size:11px;font-weight:bold}td{border:1px solid #ccc;padding:8px;font-size:12px}.docente-name{font-weight:bold}.firma-box{width:120px;height:45px;border:1px solid #999}</style></head><body><div class="page"><h1>Control de Asistencia Docentes</h1><div class="subtitle">${selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: ${turno==="DIURNO"?"Diurno":"Vespertino"} · Trimestre ${lapsoActual}</div><table><thead><tr><th>N°</th><th>Docente</th><th>Materia(s) / Sección(es)</th><th>Horario</th><th>Entrada</th><th>Salida</th><th>Firma</th></tr></thead><tbody>${docentesDelDia.map(([rd, info], idx) => `<tr><td>${idx+1}</td><td class="docente-name">${getDocName(rd)}</td><td>${info.clases.map(c => `${c.materia} — ${c.seccion}`).join("<br>")}</td><td>${info.clases.map(c => c.hora).join("<br>")}</td><td><div class="firma-box"></div></td><td><div class="firma-box"></div></td><td><div class="firma-box"></div></td></tr>`).join("")}</tbody></table></div></body></html>`;
    win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 400);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>🖨️ Asistencias Diarias por Turno</h1>
      <div style={{ ...S.card, padding: "14px 20px", marginBottom: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase" }}>Turno</div>
          <div style={{ display: "flex", gap: 6 }}>
            {["DIURNO", "VESPERTINO"].map(t => (
              <button key={t} onClick={() => setTurno(t)} style={{ ...S.btn(turno === t), borderRadius: 8 }}>{t === "DIURNO" ? "☀️ Diurno" : "🌙 Vespertino"}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase" }}>Día</div>
          <div style={{ display: "flex", gap: 6 }}>
            {DAYS.map(d => <button key={d} onClick={() => setSelectedDay(d)} style={S.btn(selectedDay === d)}>{d.charAt(0)+d.slice(1).toLowerCase()}</button>)}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={handlePrint} style={{ padding: "9px 18px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>🖨️ Imprimir / PDF</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Control de Asistencia Docentes</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginTop: 2, fontWeight: 500 }}>PNF en Informática · {selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: {turno === "DIURNO" ? "Diurno (7:30AM – 12:00PM)" : "Vespertino (1:00PM – 5:30PM)"} · Trimestre {lapsoActual}</div>
        </div>
        {!docentesDelDia.length ? <div style={{ padding: "40px 20px", textAlign: "center", color: "#9CA3AF", fontSize: 15, fontWeight: 500 }}>No hay docentes registrados.</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 40, textAlign: "center" }}>N°</th>
                <th style={{ ...S.th, width: 200 }}>Docente</th>
                <th style={S.th}>Materia(s) / Sección(es)</th>
                <th style={{ ...S.th, width: 160 }}>Horario</th>
                <th style={{ ...S.th, width: 90 }}>Entrada</th>
                <th style={{ ...S.th, width: 90 }}>Salida</th>
                <th style={{ ...S.th, width: 130 }}>Firma</th>
              </tr>
            </thead>
            <tbody>
              {docentesDelDia.map(([rd, info], idx) => (
                <tr key={rd} style={{ background: idx % 2 === 0 ? "#fff" : "#FAFAFB" }}>
                  <td style={{ ...S.td, textAlign: "center", color: "#9CA3AF", fontWeight: 600, fontSize: 13 }}>{idx+1}</td>
                  <td style={S.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={getDocName(rd)} size={30} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{getDocName(rd)}</span>
                    </div>
                  </td>
                  <td style={{ ...S.td, fontSize: 13 }}>
                    {info.clases.map((c, i) => (
                      <div key={i} style={{ marginBottom: i < info.clases.length - 1 ? 5 : 0 }}>
                        <span style={{ fontWeight: 600 }}>{c.materia}</span>
                        <span style={{ color: "#6B7280", marginLeft: 6, fontWeight: 500 }}>— {c.seccion}</span>
                        {c.trayecto && <span style={{ background: TRAYECTO_BG[c.trayecto] || "#f3f4f6", color: TRAYECTO_COLORS[c.trayecto] || "#555", borderRadius: 6, padding: "3px 10px", marginLeft: 8, fontSize: 12, fontWeight: 600 }}>T.{c.trayecto}</span>}
                      </div>
                    ))}
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: "#6B7280", whiteSpace: "nowrap", fontWeight: 500 }}>
                    {info.clases.map((c, i) => <div key={i} style={{ marginBottom: i < info.clases.length - 1 ? 5 : 0 }}>{c.hora}</div>)}
                  </td>
                  <td style={{ ...S.td, border: "1px solid #E5E7EB" }}></td>
                  <td style={{ ...S.td, border: "1px solid #E5E7EB" }}></td>
                  <td style={{ ...S.td, border: "1px solid #E5E7EB", height: 48 }}></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {docentesDelDia.length > 0 && (
          <div style={{ padding: "16px 20px", borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 500 }}>
            <div>Total docentes: <strong style={{ color: "#111827" }}>{docentesDelDia.length}</strong></div>
            <div>Total clases: <strong style={{ color: "#111827" }}>{docentesDelDia.reduce((a, [, v]) => a + v.clases.length, 0)}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
