import React, { useMemo, useState } from 'react';
import { trayectoClass, TURNOS_CONFIG } from '../constants';
import { getTurnoDeRegistro, findStartBlock, buildBloquesDinamicos, countBlocksEnBloques } from '../utils/turno';
import { getHoraDisplayDeRegistro } from '../utils/time';
import { parseClase } from '../utils/parsing';
import ModalEditarClase from './ModalEditarClase';
import './TurnoGrid.css';

// UX-14: puedeEditar/puedeBorrar/onSaveClase/onDeleteClase/openConfirm/
// closeConfirm son opcionales — si no llegan (vista de solo lectura o sin
// permiso), la grilla se comporta exactamente igual que antes: solo
// expandir/colapsar el detalle de la celda, sin botones de edición.
export default function TurnoGrid({
  bloques, turnoLabel, filtered, days, expandedCell, setExpandedCell, getDocName, getMateriaName,
  puedeEditar, puedeBorrar, puedeCrearDocentes, puedeCrearMaterias, onSaveClase, onDeleteClase, openConfirm, closeConfirm,
}) {
  const [editingEntry, setEditingEntry] = useState(null);

  // Caso particular PNF Agroalimentación (turno "MIXTO", ver constants/
  // turno.js): en vez de una tabla de bloques fija por turno, se parte de
  // `bloques` (el esqueleto DIURNO/VESPERTINO/MIXTO) y se le agregan los
  // límites reales que traigan los datos cargados — así un programa con
  // horas estándar renderiza exactamente igual que antes, y uno con horas
  // distintas (o que cambian de trimestre a trimestre) se ajusta solo.
  const bloquesDinamicos = useMemo(
    () => buildBloquesDinamicos(bloques, filtered, turnoLabel),
    [bloques, filtered, turnoLabel]
  );

  const cellMap = useMemo(() => {
    if (!days || !bloquesDinamicos || !filtered) return {};
    const map = {};
    days.forEach(day => {
      map[day] = {};
      // `owner[bi] = biDueño` — qué celda (identificada por su propio bi de
      // inicio) cubre el bloque `bi` mediante su rowSpan. Antes se guardaba
      // solo un booleano `occupied[bi]`, y cualquier clase que EMPEZARA en
      // un bloque ya cubierto por el rowSpan de una clase anterior se
      // descartaba en silencio (`map[day][bi] = "skip"; return;`) sin
      // aparecer en ningún lado — aunque siguiera intacta en la base de
      // datos. Esto es lo que producía el bug reportado: editar una clase
      // (ej. alargar su duración) podía "tapar" y hacer desaparecer una
      // clase distinta que empezaba en el bloque siguiente; y al revés, si
      // una clase larga ya estaba tapando a otra desde antes, acortarla o
      // editarla hacía que la tapada "apareciera de golpe" donde se estaba
      // editando — dando la sensación de que "se movió", cuando en
      // realidad siempre estuvo ahí, invisible.
      //
      // Fix UX-28: ahora, si un bloque ya cubierto por un rowSpan anterior
      // tiene ADEMÁS su propia clase empezando ahí (choque real de horario
      // en los datos, ej. dos clases distintas superpuestas en el mismo
      // día/aula), esa clase se fusiona dentro de la celda dueña en vez de
      // descartarse — nunca desaparece de la vista, y la celda se marca
      // `conflicto: true` para que el staff note el choque de horario y lo
      // corrija en el origen (no es algo que la grilla deba resolver sola).
      const owner = {};
      bloquesDinamicos.forEach((bloque, bi) => {
        const entriesAqui = filtered.filter(d => d.dia === day && getTurnoDeRegistro(d) === turnoLabel && findStartBlock(bloquesDinamicos, d.hora) === bi);

        if (owner[bi] !== undefined) {
          if (entriesAqui.length) {
            map[day][owner[bi]].entries.push(...entriesAqui);
            map[day][owner[bi]].conflicto = true;
          }
          map[day][bi] = "skip";
          return;
        }

        if (!entriesAqui.length) { map[day][bi] = null; return; }
        let span = 1;
        entriesAqui.forEach(e => { const s = countBlocksEnBloques(bloquesDinamicos, e.hora, bi); if (s > span) span = s; });
        span = Math.min(span, bloquesDinamicos.length - bi);
        map[day][bi] = { entries: entriesAqui, span };
        for (let k = bi + 1; k < bi + span; k++) owner[k] = bi;
      });
    });
    return map;
  }, [bloquesDinamicos, days, filtered, turnoLabel]);

  if (!days || !bloquesDinamicos || !filtered) {
    return <div className="tg-loading">Cargando grilla...</div>;
  }

  const turnoConfig = TURNOS_CONFIG.find(t => t.id === turnoLabel);
  const esVespertino = turnoLabel === "VESPERTINO" || turnoLabel === "NOCTURNO";
  const primerBloque = bloquesDinamicos[0];
  const ultimoBloque = bloquesDinamicos[bloquesDinamicos.length - 1];
  const subtitulo = primerBloque && ultimoBloque
    ? `${primerBloque.inicio.replace(/(\d)(AM|PM)/gi, '$1 $2')} – ${ultimoBloque.fin.replace(/(\d)(AM|PM)/gi, '$1 $2')}`
    : (turnoConfig?.hora || "");

  return (
    <div className="s-card tg-card">
      <div className={`tg-header${esVespertino ? " tg-header--vespertino" : ""}`}>
        <i className={`ti ${esVespertino ? "ti-moon-stars" : "ti-sun-high"} tg-header-icon`} aria-hidden="true" />
        <span className="tg-header-title">Turno {turnoConfig?.label || turnoLabel}</span>
        <span className="tg-header-subtitle">{subtitulo}</span>
      </div>
      <div className="turno-grid-wrapper">
        <table className="turno-grid-table">
          <colgroup>
            <col className="tg-col-hora" />
            {days.map(d => <col key={d} />)}
          </colgroup>
          <thead>
            <tr className="tg-thead-row">
              <th className="s-th tg-th-hora">Hora</th>
              {days.map(d => <th key={d} className="s-th tg-th-day">{d.charAt(0) + d.slice(1).toLowerCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {bloquesDinamicos.map((bloque, bi) => {
              const cells = days.map(day => {
                const cell = cellMap[day]?.[bi];
                if (cell === "skip") return { skip: true };
                if (!cell) return { empty: true };
                return { data: cell };
              });
              return (
                <tr key={bi} className="tg-row">
                  <td className="tg-cell-hora">
                    <div>{bloque.inicio.replace(/(\d)(AM|PM)/gi, '$1 $2')}</div>
                    <div className="tg-cell-hora-fin">{bloque.fin.replace(/(\d)(AM|PM)/gi, '$1 $2')}</div>
                  </td>
                  {cells.map((cell, ci) => {
                    const day = days[ci];
                    if (cell.skip) return null;
                    const cellKey = `${turnoLabel}__${bi}__${day}`, isExp = expandedCell === cellKey;
                    if (cell.empty) return <td key={day} className="tg-cell-empty" />;
                    const { entries, span, conflicto } = cell.data;
                    return (
                      <td
                        key={day}
                        rowSpan={span}
                        className={`tg-cell-data tg-cell-data--span-${span}${conflicto ? " tg-cell-data--conflicto" : ""}`}
                      >
                        <div className="tg-cell-inner">
                        {conflicto && (
                          <div className="tg-cell-conflicto-aviso" role="alert">
                            <i className="ti ti-alert-triangle" aria-hidden="true" /> Choque de horario: hay más de una clase en este bloque.
                          </div>
                        )}
                        {entries.map((e) => {
                          const { materia: rawMateria, docente: docenteParseado } = parseClase(e.clase);
                          const rawDoc = e.docentes?.nombre_raw || docenteParseado;
                          const materia = getMateriaName(rawMateria), docente = getDocName(rawDoc);
                          const toggleExpand = () => setExpandedCell(isExp ? null : cellKey);
                          return (
                            <div
                              key={e.id}
                              role="button"
                              tabIndex={0}
                              aria-expanded={isExp}
                              aria-label={`${materia}${docente ? ` — ${docente}` : ""}. Presiona Enter para ${isExp ? "ocultar" : "ver"} detalles.`}
                              onClick={toggleExpand}
                              onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleExpand(); } }}
                              className={`tg-clase ${trayectoClass(e.trayecto)}${isExp ? " tg-clase--expanded" : ""}`}
                            >
                              <div className="tg-clase-materia">{materia}</div>
                              {docente && <div className="tg-clase-docente">{docente}</div>}
                              {isExp && (
                                <div className="tg-clase-detail">
                                  <div className="tg-clase-detail-row"><i className="ti ti-folder" aria-hidden="true" /> {e.sheet.trim()} · T.{e.trayecto}</div>
                                  <div className="tg-clase-detail-row"><i className="ti ti-clock" aria-hidden="true" /> {getHoraDisplayDeRegistro(e)}</div>
                                  <div className="tg-clase-detail-row"><i className="ti ti-door" aria-hidden="true" /> {e.aula || "Sin aula"}</div>
                                  {(puedeEditar || puedeBorrar) && (
                                    <button
                                      type="button"
                                      className="tg-clase-edit-btn"
                                      onClick={ev => { ev.stopPropagation(); setEditingEntry(e); }}
                                    >
                                      <i className="ti ti-edit" aria-hidden="true" /> Editar
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(puedeEditar || puedeBorrar) && (
        <ModalEditarClase
          open={!!editingEntry}
          entry={editingEntry}
          puedeEditar={puedeEditar}
          puedeBorrar={puedeBorrar}
          puedeCrearDocentes={puedeCrearDocentes}
          puedeCrearMaterias={puedeCrearMaterias}
          onSave={onSaveClase}
          onDelete={onDeleteClase}
          onClose={() => setEditingEntry(null)}
          openConfirm={openConfirm}
          closeConfirm={closeConfirm}
        />
      )}
    </div>
  );
}
