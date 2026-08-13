// Núcleo presentacional de la "planilla de asistencia imprimible":
// selector de turno/día + tabla en blanco para firma física, generada
// a partir del horario (no depende de datos de asistencia QR).
//
// Hoy se usa solo desde PlanillaQR.jsx (pestaña "Planilla" del módulo
// Asistencias QR). Antes también existía como submenú dentro del módulo
// Horarios (AsistenciasView.jsx), eliminado por redundante: la misma
// planilla ya es accesible desde Asistencias QR.
//
// Fase 1 del editor de plantillas (12 ago, migración 0090): las columnas
// de la tabla ya no están fijas en este archivo -- se leen de `plantilla`
// (la fila de plantillas_impresion resuelta para la sede activa, ver
// usePlantillasImpresion.js), con DEFAULT_COLUMNAS_BLOQUE como respaldo
// si no se pasa ninguna (tabla borrada a mano, o -- como en los tests de
// este componente -- un caller que todavía no pasa la prop). El set de
// filas pasó de "una fila por docente" a "una fila por bloque de horario
// programado ese día/turno" (`agrupacion: 'bloque'`), para calzar con el
// formato en papel que LS trajo de referencia ("ASISTENCIA DIARIA EDUC
// ESPECIAL", columnas HORA/ASIGNATURA/SECCIÓN/PROFESOR/ACTIVIDAD/FIRMA
// ENTRADA/FIRMA SALIDA/AULA/OBSERVACIÓN). Este componente sigue siendo
// puramente presentacional a propósito -- NO llama a Supabase ni a
// useSedeContext directamente; quien lo monta (PlanillaQR.jsx) es quien
// resuelve `plantilla` y se la pasa por prop, igual que ya hace con
// `reporteConfig`.
import React, { useState, useMemo } from 'react';
import { DAYS, TURNOS_CONFIG } from '../../constants';
import { getTurnoDeRegistro } from '../../utils/turno';
import { getHoraDisplayDeRegistro, getHoraMin } from '../../utils/time';
import { parseClase } from '../../utils/parsing';
import { getCurrentLapso } from '../../utils/lapso';
import { plantillaReporte, abrirVentanaImpresion } from '../../utils/reportePlantilla';
import { DEFAULT_COLUMNAS_BLOQUE } from '../../utils/plantillasImpresion';
import './PlanillaImprimibleBase.css';

// Fix SEC-25 (CodeQL, 15 de julio — "DOM text reinterpreted as HTML"):
// `handlePrint` arma un string de HTML e imprime vía `document.write()`
// sobre una ventana nueva del mismo origen. Todo valor derivado de datos
// reales (nombre de docente/materia/programa/sección, que llegan a la BD
// vía carga masiva de Excel — ver useUpload.js/parseClase) pasa por
// ESC() antes de interpolarse — ver PlanillaImprimibleBase.security.test.jsx.
const ESC = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Fix (caso PNF Agroalimentación, turno MIXTO): el selector de turno sale
// de TURNOS_CONFIG (misma fuente que TURNOS_VISIBLES/TURNOS_FILTRO en el
// resto del módulo) en vez de un array fijo -- cualquier turno nuevo que
// se habilite a futuro aparece automáticamente, sin tocar este archivo.
const TURNOS_PLANILLA = TURNOS_CONFIG.filter(t => t.habilitado);
const turnoIcon = (id) => (id === "VESPERTINO" || id === "NOCTURNO") ? "ti-moon" : "ti-sun";

// Registro de campos disponibles para agrupacion 'bloque'. DEFAULT_COLUMNAS_BLOQUE
// (respaldo si `plantilla` no llega) vive en utils/plantillasImpresion.js,
// compartido con el panel admin -- ver el comentario de ese archivo. `blank: true`
// = celda en blanco para llenar a mano (igual que en el papel); el resto
// se resuelve desde el bloque de horario. Un `campo` en la plantilla que
// no esté acá (dato corrupto, o una plantilla pensada para otra
// agrupación) se ignora en vez de romper el render.
const CAMPOS_BLOQUE = {
  hora:          { getValor: b => b.hora },
  asignatura:    { getValor: b => b.asignatura },
  seccion:       { getValor: b => b.seccion, center: true },
  profesor:      { getValor: b => b.profesor },
  actividad:     { blank: true },
  firma_entrada: { blank: true },
  firma_salida:  { blank: true },
  aula:          { getValor: b => b.aula || "" },
  observacion:   { blank: true },
};

function resolverColumnas(plantilla) {
  const fuente = Array.isArray(plantilla?.columnas) && plantilla.columnas.length
    ? plantilla.columnas
    : DEFAULT_COLUMNAS_BLOQUE;
  return fuente
    .filter(c => c.visible !== false && CAMPOS_BLOQUE[c.campo])
    .slice()
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

export default function PlanillaImprimibleBase({ data, getDocName, getMateriaName, catalogoDocentes = [], lapso, reporteConfig, plantilla = null }) {
  const lapsoActual = lapso || getCurrentLapso();
  const [turno, setTurno] = useState(TURNOS_PLANILLA[0]?.id || "DIURNO"), [selectedDay, setSelectedDay] = useState(DAYS[0]);
  const turnoConf = TURNOS_CONFIG.find(t => t.id === turno);
  const turnoLabel = turnoConf?.label || turno;

  const columnasActivas = useMemo(() => resolverColumnas(plantilla), [plantilla]);

  const programaActual = useMemo(() => {
    const programas = [...new Set(data.map(d => d.programa).filter(Boolean))];
    if (programas.length === 1) return programas[0];
    if (programas.length > 1) return "Varios programas";
    return "Sin programa";
  }, [data]);

  // Una fila por CLASE programada ese día/turno (no por docente) -- así
  // una misma sección/profesor puede aparecer más de una vez si tiene más
  // de un bloque, igual que en la planilla en papel de referencia.
  const bloquesDelDia = useMemo(() => {
    const bloques = data
      .filter(d => getTurnoDeRegistro(d) === turno && d.dia === selectedDay)
      .map(d => {
        const { materia, docente: docenteParseado } = parseClase(d.clase, catalogoDocentes);
        // Mismo criterio que antes: relación real docentes.nombre_raw
        // (garantizada por FK) tiene prioridad sobre parseClase con
        // catálogo fuzzy, que queda como respaldo para filas legacy sin
        // docente_id vinculado.
        const docenteRaw = d.docentes?.nombre_raw || docenteParseado;
        return {
          horaMin:   getHoraMin(d),
          hora:      getHoraDisplayDeRegistro(d),
          asignatura: getMateriaName(d.materias?.nombre_raw || materia),
          seccion:   (d.sheet || "").trim(),
          profesor:  docenteRaw ? getDocName(docenteRaw) : "—",
          aula:      d.aula || "",
        };
      });
    bloques.sort((a, b) => a.horaMin - b.horaMin || a.seccion.localeCompare(b.seccion));
    return bloques;
  }, [data, turno, selectedDay, getDocName, getMateriaName, catalogoDocentes]);

  const handlePrint = () => {
    const diaLabel = selectedDay.charAt(0) + selectedDay.slice(1).toLowerCase();

    const theadHtml = columnasActivas.map(col => `<th>${ESC(col.etiqueta)}</th>`).join("");

    const filas = bloquesDelDia.map(b => {
      const celdas = columnasActivas.map(col => {
        const spec = CAMPOS_BLOQUE[col.campo];
        if (spec.blank) return `<td class="td-center"><div class="firma-box"></div></td>`;
        const valor = ESC(spec.getValor(b));
        return `<td${spec.center ? ' class="td-center"' : ''}>${valor}</td>`;
      }).join("");
      return `<tr>${celdas}</tr>`;
    }).join("");

    const seccionesHtml = `
      <div class="subtitulo">${ESC(programaActual)} · ${ESC(diaLabel)} · Turno: ${ESC(turnoLabel)} · Trimestre ${ESC(lapsoActual)}</div>
      <table>
        <thead><tr>${theadHtml}</tr></thead>
        <tbody>${filas || `<tr><td colspan="${columnasActivas.length}" class="td-empty">Sin clases programadas</td></tr>`}</tbody>
      </table>`;

    const html = plantillaReporte({
      config: reporteConfig,
      titulo: "Control de Asistencia Docentes",
      subtitulo: `${diaLabel} · ${turnoLabel}`,
      seccionesHtml,
      pie: `Total de bloques: ${bloquesDelDia.length}`,
      orientacion: plantilla?.orientacion,
      tamanoPagina: plantilla?.tamano_pagina,
      layout: plantilla?.layout,
    });

    if (!abrirVentanaImpresion(html, { autoPrint: true })) {
      alert("El navegador bloqueó la ventana emergente.");
    }
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
            {TURNOS_PLANILLA.map(t => (
              <button key={t.id} onClick={() => setTurno(t.id)} className={`s-btn pib-turno-btn${turno === t.id ? ' s-btn--active' : ''}`}>
                <i className={`ti ${turnoIcon(t.id)} pib-turno-btn-icon`} aria-hidden="true" />
                {t.label}
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
          <div className="pib-table-sub">{programaActual} · {selectedDay.charAt(0)+selectedDay.slice(1).toLowerCase()} · Turno: {turnoLabel} ({turnoConf?.hora || ""}) · Trimestre {lapsoActual}</div>
        </div>
        {!bloquesDelDia.length ? <div className="pib-empty">No hay clases programadas.</div> : (
          <table className="pib-table">
            <thead>
              <tr>
                {columnasActivas.map(col => <th key={col.campo} className="s-th">{col.etiqueta}</th>)}
              </tr>
            </thead>
            <tbody>
              {bloquesDelDia.map((b, idx) => (
                <tr key={idx}>
                  {columnasActivas.map(col => {
                    const spec = CAMPOS_BLOQUE[col.campo];
                    if (spec.blank) {
                      return <td key={col.campo} className="s-td pib-cell-blank"><div className="pib-cell-blank-box" /></td>;
                    }
                    return (
                      <td key={col.campo} className={`s-td${spec.center ? ' pib-td-center' : ''}`}>
                        {spec.getValor(b)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {bloquesDelDia.length > 0 && (
          <div className="pib-footer">
            <div>Total de bloques: <strong className="pib-footer-strong">{bloquesDelDia.length}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
