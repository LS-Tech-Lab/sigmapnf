// Núcleo presentacional de la "planilla de asistencia imprimible":
// selector de turno/día + tabla en blanco para firma física, generada
// a partir del horario (no depende de datos de asistencia QR).
//
// Hoy se usa solo desde PlanillaQR.jsx (pestaña "Planilla" del módulo
// Asistencias QR). Antes también existía como submenú dentro del módulo
// Horarios (AsistenciasView.jsx), eliminado por redundante: la misma
// planilla ya es accesible desde Asistencias QR.
import React, { useState, useMemo } from 'react';
import { DAYS, TRAYECTO_BG, TRAYECTO_COLORS } from '../../constants';
import { getTurnoDeRegistro } from '../../utils/turno';
import { getHoraDisplayDeRegistro, getHoraMin } from '../../utils/time';
import { parseClase } from '../../utils/parsing';
import { getCurrentLapso } from '../../utils/lapso';
import Avatar from '../Avatar';
import './PlanillaImprimibleBase.css';

export default function PlanillaImprimibleBase({ data, getDocName, getMateriaName, catalogoDocentes = [], lapso }) {
  const lapsoActual = lapso || getCurrentLapso();
  const [turno, setTurno] = useState("DIURNO"), [selectedDay, setSelectedDay] = useState(DAYS[0]);

  const programaActual = useMemo(() => {
    const programas = [...new Set(data.map(d => d.programa).filter(Boolean))];
    if (programas.length === 1) return programas[0];
    if (programas.length > 1) return "Varios programas";
    return "Sin programa";
  }, [data]);

  const docentesDelDia = useMemo(() => {
    const map = {};
    data.filter(d => getTurnoDeRegistro(d) === turno && d.dia === selectedDay).forEach(d => {
      const { materia, docente: docenteParseado } = parseClase(d.clase, catalogoDocentes);
      // Prioridad: relación real docentes.nombre_raw (garantizada por FK,
      // inmune a variaciones de tipeo) > parseClase con catálogo fuzzy
      // como respaldo para filas legacy sin docente_id vinculado.
      const docente = d.docentes?.nombre_raw || docenteParseado;
      if (!docente) return;
      if (!map[docente]) map[docente] = { clases: [] };
      map[docente].clases.push({
        materia: getMateriaName(d.materias?.nombre_raw || materia),
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
    if (!win) { alert("El navegador bloqueó la ventana emergente."); return; }
    const html = `<!DOCTYPE html><html><head><title>Asistencia</title><style>*{margin:0;padding:0}body{font-family:Arial;font-size:12px}.page{padding:20px}h1{font-size:16px}.subtitle{font-size:12px;color:#555;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;border:1px solid #ccc;padding:8px;font-size:11px;font-weight:bold}td{border:1px solid #ccc;padding:8px;font-size:12px}.docente-name{font-weight:bold}.firma-box{width:120px;height:45px;border:1px solid #999}</style></head><body><div class="page"><h1>Control de Asistencia Docentes</h1><div class="subtitle">${programaActual} · ${selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: ${turno==="DIURNO"?"Diurno":"Vespertino"} · Trimestre ${lapsoActual}</div><table><thead><tr><th>N°</th><th>Docente</th><th>Materia(s) / Sección(es)</th><th>Horario</th><th>Entrada</th><th>Salida</th><th>Firma</th></tr></thead><tbody>${docentesDelDia.map(([rd, info], idx) => `<tr><td>${idx+1}</td><td class="docente-name">${getDocName(rd)}</td><td>${info.clases.map(c => `${c.materia} — ${c.seccion}`).join("<br>")}</td><td>${info.clases.map(c => c.hora).join("<br>")}</td><td><div class="firma-box"></div></td><td><div class="firma-box"></div></td><td><div class="firma-box"></div></td></tr>`).join("")}</tbody></table></div></body></html>`;
    win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 400);
  };

  return (
    <div className="pib-root">
      <h1 className="pib-title">
        <i className="ti ti-printer pib-title-icon" aria-hidden="true" />
        Asistencias Diarias por Turno
      </h1>
      <div className="s-card pib-toolbar">
        <div>
          <div className="pib-field-label">Turno</div>
          <div className="pib-field-row">
            {["DIURNO", "VESPERTINO"].map(t => (
              <button key={t} onClick={() => setTurno(t)} className={`s-btn pib-turno-btn${turno === t ? ' s-btn--active' : ''}`}>
                <i className={`${t === "DIURNO" ? "ti ti-sun" : "ti ti-moon"} pib-turno-btn-icon`} aria-hidden="true" />
                {t === "DIURNO" ? "Diurno" : "Vespertino"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="pib-field-label">Día</div>
          <div className="pib-field-row">
            {DAYS.map(d => <button key={d} onClick={() => setSelectedDay(d)} className={`s-btn${selectedDay === d ? ' s-btn--active' : ''}`}>{d.charAt(0)+d.slice(1).toLowerCase()}</button>)}
          </div>
        </div>
        <div className="pib-print-wrap">
          <button onClick={handlePrint} className="pib-print-btn">
            <i className="ti ti-printer pib-print-btn-icon" aria-hidden="true" />
            Imprimir / PDF
          </button>
        </div>
      </div>
      <div className="s-card">
        <div className="pib-table-header">
          <div className="pib-table-title">Control de Asistencia Docentes</div>
          <div className="pib-table-sub">{programaActual} · {selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: {turno === "DIURNO" ? "Diurno (7:30AM – 12:00PM)" : "Vespertino (1:00PM – 5:30PM)"} · Trimestre {lapsoActual}</div>
        </div>
        {!docentesDelDia.length ? <div className="pib-empty">No hay docentes registrados.</div> : (
          <table className="pib-table">
            <thead>
              <tr>
                <th className="s-th">N°</th>
                <th className="s-th">Docente</th>
                <th className="s-th">Materia(s) / Sección(es)</th>
                <th className="s-th">Horario</th>
                <th className="s-th">Entrada</th>
                <th className="s-th">Salida</th>
                <th className="s-th">Firma</th>
              </tr>
            </thead>
            <tbody>
              {docentesDelDia.map(([rd, info], idx) => (
                <tr key={rd}>
                  <td className="s-td pib-td-num">{idx+1}</td>
                  <td className="s-td">
                    <div className="pib-doc-cell">
                      <Avatar name={getDocName(rd)} size={30} />
                      <span className="pib-doc-name">{getDocName(rd)}</span>
                    </div>
                  </td>
                  <td className="s-td pib-materias-cell">
                    {info.clases.map((c, i) => (
                      <div key={i} className="pib-materia-row">
                        <span className="pib-materia-name">{c.materia}</span>
                        <span className="pib-materia-seccion">— {c.seccion}</span>
                        {c.trayecto && <span className="pib-materia-trayecto" style={{ background: TRAYECTO_BG[c.trayecto] || "#F1F5F9", color: TRAYECTO_COLORS[c.trayecto] || "#334155" }}>T.{c.trayecto}</span>}
                      </div>
                    ))}
                  </td>
                  <td className="s-td pib-hora-cell">
                    {info.clases.map((c, i) => <div key={i} className="pib-hora-row">{c.hora}</div>)}
                  </td>
                  <td className="s-td pib-firma-cell"></td>
                  <td className="s-td pib-firma-cell"></td>
                  <td className="s-td pib-firma-cell"></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {docentesDelDia.length > 0 && (
          <div className="pib-footer">
            <div>Total docentes: <strong className="pib-footer-strong">{docentesDelDia.length}</strong></div>
            <div>Total clases: <strong className="pib-footer-strong">{docentesDelDia.reduce((a, [, v]) => a + v.clases.length, 0)}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
