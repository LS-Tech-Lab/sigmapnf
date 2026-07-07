import React from 'react';
import { trayectoClass } from '../constants';
import { getHoraDisplayDeRegistro } from '../utils/time';
import { parseClase } from '../utils/parsing';
import './ConflictosView.css';

export default function ConflictosView({ conflicts, onGoDocente, getDocName }) {
  const hayConflictos = conflicts.length > 0;
  return (
    <div className="cv-root">
      <div className="cv-header">
        <h1 className="cv-title">
          <i className={`ti ti-alert-triangle cv-title-icon${hayConflictos ? '' : ' cv-title-icon--ok'}`} aria-hidden="true" /> Conflictos detectados
        </h1>
        <span className={`cv-badge${hayConflictos ? '' : ' cv-badge--ok'}`}>
          {conflicts.length}
        </span>
      </div>
      {!conflicts.length ? (
        <div className="s-card cv-empty">
          <i className="ti ti-circle-check cv-empty-icon" aria-hidden="true" />
          <div className="cv-empty-title">Sin conflictos</div>
          <div className="cv-empty-desc">No se detectaron solapamientos horarios.</div>
        </div>
      ) : (
        <div className="cv-list">
          {conflicts.map((c, i) => (
            <div key={i} className="s-card cv-item">
              <div className="cv-item-row">
                <span className="cv-item-icon-wrap">
                  <i className="ti ti-alert-triangle cv-item-icon" aria-hidden="true" />
                </span>
                <div className="cv-item-body">
                  <div className="cv-item-head">
                    <button onClick={() => onGoDocente(c.docente)} className="cv-item-name">
                      {getDocName(c.docente)}
                    </button>
                    <span className="cv-item-meta">— {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {getHoraDisplayDeRegistro(c.entries[0])}</span>
                  </div>
                  <div className="cv-item-tags">
                    {c.entries.map((e, j) => {
                      const { materia } = parseClase(e.clase);
                      return (
                        <div key={j} className={`cv-tag ${trayectoClass(e.trayecto)}`}>
                          <div className="cv-tag-title">{materia}</div>
                          <div className="cv-tag-sub">{e.sheet.trim()} · T.{e.trayecto}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
