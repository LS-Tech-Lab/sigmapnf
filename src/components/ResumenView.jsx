import React, { useState, useMemo } from 'react';
import { DAYS, ALL_TRAYECTOS, trayectoClass } from '../constants';
import { getTurnoDeRegistro } from '../utils/turno';
import StatCard from './StatCard';
import Avatar from './Avatar';
import './ResumenView.css';

export default function ResumenView({ stats, data, byDocente, byMateria, conflicts = [], getDocName, getMateriaName, onGoToConflictos, isSyncing }) {
  const [tab, setTab] = useState('general');

  const metricas = useMemo(() => {
    if (!data || data.length === 0) return null;
    const docentesConConflicto = new Set(conflicts.map(c => c.docente)).size;
    const clasesPorDia = {};
    DAYS.forEach(d => { clasesPorDia[d] = data.filter(r => r.dia === d).length; });
    const promedioClasesDia = Math.round(Object.values(clasesPorDia).reduce((a, b) => a + b, 0) / 5);
    const trayectosActivos = [...new Set(data.map(d => d.trayecto))].length;
    const topDocente = Object.entries(byDocente).sort((a, b) => b[1].length - a[1].length)[0];
    const topMateria = Object.entries(byMateria).sort((a, b) => b[1].length - a[1].length)[0];
    const diurno = data.filter(d => getTurnoDeRegistro(d) === 'DIURNO').length;
    const vespertino = data.filter(d => getTurnoDeRegistro(d) === 'VESPERTINO').length;
    // Para análisis
    const trayectoCount = {}, dayCount = {}, turnoCount = {};
    data.forEach(d => {
      trayectoCount[d.trayecto] = (trayectoCount[d.trayecto] || 0) + 1;
      turnoCount[d.turno] = (turnoCount[d.turno] || 0) + 1;
    });
    DAYS.forEach(d => { dayCount[d] = data.filter(r => r.dia === d).length; });
    const maxDay = Math.max(...Object.values(dayCount), 1);
    const top8Docentes = Object.entries(byDocente).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
    const maxLoadDocente = Math.max(...top8Docentes.map(([, e]) => e.length), 1);
    const topMaterias = Object.entries(byMateria).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
    const maxMat = topMaterias[0]?.[1].length || 1;
    const seccionesCount = new Set(data.map(d => d.sheet.trim())).size;
    return {
      docentesConConflicto, promedioClasesDia, trayectosActivos,
      topDocente, topMateria, diurno, vespertino,
      trayectoCount, dayCount, turnoCount, maxDay,
      top8Docentes, maxLoadDocente, topMaterias, maxMat, seccionesCount,
    };
  }, [data, byDocente, byMateria, conflicts]);

  const TABS = [
    { id: 'general', icon: 'ti-home', label: 'Vista general' },
    { id: 'analisis', icon: 'ti-chart-histogram', label: 'Análisis detallado' },
  ];

  return (
    <div className="rv-root">
      {/* A-5: banner mientras data está vacía y se está cargando el programa nuevo */}
      {isSyncing && (!data || data.length === 0) && (
        <div className="rv-syncing-banner">
          <i className="ti ti-refresh rv-syncing-icon" aria-hidden="true" />
          Cargando datos del programa…
        </div>
      )}
      {/* Header con tabs */}
      <div className="rv-header">
        <h1 className="rv-title">
          <i className="ti ti-layout-dashboard rv-title-icon" aria-hidden="true" /> Resumen
        </h1>
        <div className="rv-tabs-wrap">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`rv-tab-btn${tab === t.id ? ' rv-tab-btn--active' : ''}`}>
              <i className={`ti ${t.icon}`} aria-hidden="true" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB: VISTA GENERAL ── */}
      {tab === 'general' && (
        <>
          <div className="stats-grid-4">
            <StatCard label="Conflictos activos" value={conflicts.length} icon="ti-alert-triangle" variant={conflicts.length > 0 ? 'danger' : 'success'} />
            <StatCard label="Trayectos activos" value={metricas?.trayectosActivos || 0} icon="ti-chart-bar" variant="purple" />
            <StatCard label="Prom. clases/día" value={metricas?.promedioClasesDia || 0} icon="ti-trending-up" variant="sky" />
            <StatCard label="Docentes con conflictos" value={metricas?.docentesConConflicto || 0} icon="ti-user-exclamation" variant={metricas?.docentesConConflicto > 0 ? 'danger' : 'success'} />
          </div>

          <div className="rv-grid-2">
            {conflicts.length > 0 && (
              <div className="s-card rv-card rv-card--alert">
                <div className="rv-alert-title">
                  <i className="ti ti-alert-triangle" aria-hidden="true" /> Conflictos detectados
                </div>
                <div className="rv-alert-text">
                  Hay {conflicts.length} conflicto(s) de horario que requieren atención.
                </div>
                <button onClick={onGoToConflictos} className="rv-alert-btn">
                  Ver detalles <i className="ti ti-arrow-right" aria-hidden="true" />
                </button>
              </div>
            )}
            {metricas && (
              <div className={`s-card rv-card ${conflicts.length > 0 ? '' : 'rv-card--full'}`}>
                <div className="rv-section-title rv-section-title--turno">Distribución por turno</div>
                <div className="rv-turno-boxes">
                  <div className="rv-turno-box rv-turno-box--diurno">
                    <i className="ti ti-sun-high rv-turno-box-icon rv-turno-box-icon--diurno" aria-hidden="true" />
                    <div className="rv-turno-box-value rv-turno-box-value--diurno">{metricas.diurno}</div>
                    <div className="rv-turno-box-label">Diurno</div>
                  </div>
                  <div className="rv-turno-box rv-turno-box--vespertino">
                    <i className="ti ti-moon-stars rv-turno-box-icon rv-turno-box-icon--vespertino" aria-hidden="true" />
                    <div className="rv-turno-box-value rv-turno-box-value--vespertino">{metricas.vespertino}</div>
                    <div className="rv-turno-box-label">Vespertino</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="stats-grid-2">
            {metricas?.topDocente && (
              <div className="s-card rv-card">
                <div className="rv-section-title">
                  <i className="ti ti-user-star" aria-hidden="true" /> Docente con mayor carga
                </div>
                <div className="rv-top-row">
                  <Avatar name={getDocName(metricas.topDocente[0])} size={44} />
                  <div>
                    <div className="rv-top-name">{getDocName(metricas.topDocente[0])}</div>
                    <div className="rv-top-sub">{metricas.topDocente[1].length} clases asignadas</div>
                  </div>
                </div>
              </div>
            )}
            {metricas?.topMateria && (
              <div className="s-card rv-card">
                <div className="rv-section-title">
                  <i className="ti ti-book-2" aria-hidden="true" /> Materia más frecuente
                </div>
                <div className="rv-top-name">{getMateriaName(metricas.topMateria[0])}</div>
                <div className="rv-top-sub">{metricas.topMateria[1].length} clases</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TAB: ANÁLISIS DETALLADO ── */}
      {tab === 'analisis' && metricas && (
        <div className="stats-grid-2">
          <div className="s-card rv-card">
            <div className="rv-analysis-title">Clases por trayecto</div>
            {Object.entries(metricas.trayectoCount).sort().map(([t, c]) => (
              <div key={t} className="rv-bar-row">
                <span className={`rv-trayecto-badge ${trayectoClass(t)}`}>{t}</span>
                <div className="rv-bar-track">
                  <div className={`rv-bar-fill ${trayectoClass(t)}`} style={{ width: `${(c/stats.total)*100}%` }} />
                </div>
                <span className="rv-count-label rv-count-label--32">{c}</span>
              </div>
            ))}
          </div>

          <div className="s-card rv-card">
            <div className="rv-analysis-title">Distribución por día</div>
            {DAYS.map(d => (
              <div key={d} className="rv-bar-row">
                <span className="rv-day-label">{d.charAt(0)+d.slice(1).toLowerCase()}</span>
                <div className="rv-bar-track">
                  <div className="rv-bar-fill rv-fill--dia" style={{ width: `${(metricas.dayCount[d]/metricas.maxDay)*100}%` }} />
                </div>
                <span className="rv-count-label rv-count-label--32">{metricas.dayCount[d]}</span>
              </div>
            ))}
          </div>

          <div className="s-card rv-card">
            <div className="rv-analysis-title">Docentes con mayor carga</div>
            {metricas.top8Docentes.map(([doc, entries], idx) => (
              <div key={doc} className="rv-bar-row">
                <span className="rv-rank">{idx+1}</span>
                <span className="rv-bar-label">{getDocName(doc)}</span>
                <div className="rv-bar-track rv-bar-track--w100">
                  <div className="rv-bar-fill rv-fill--docente" style={{ width: `${(entries.length/metricas.maxLoadDocente)*100}%` }} />
                </div>
                <span className="rv-count-label rv-count-label--24">{entries.length}</span>
              </div>
            ))}
          </div>

          <div className="s-card rv-card">
            <div className="rv-analysis-title">Materias más frecuentes</div>
            {metricas.topMaterias.map(([mat, entries], idx) => {
              const cnt = entries.length;
              return (
                <div key={mat} className="rv-bar-row">
                  <span className="rv-rank">{idx+1}</span>
                  <span className="rv-bar-label" title={getMateriaName(mat)}>
                    {getMateriaName(mat).length > 28 ? getMateriaName(mat).slice(0,26)+'…' : getMateriaName(mat)}
                  </span>
                  <div className="rv-bar-track rv-bar-track--w100">
                    <div className="rv-bar-fill rv-fill--materia" style={{ width: `${(cnt/metricas.maxMat)*100}%` }} />
                  </div>
                  <span className="rv-count-label rv-count-label--24">{cnt}</span>
                </div>
              );
            })}
          </div>

          <div className="s-card rv-card">
            <div className="rv-analysis-title">Distribución por turno</div>
            {Object.entries(metricas.turnoCount).sort().map(([t, cnt]) => {
              const pct = stats.total > 0 ? Math.round((cnt/stats.total)*100) : 0;
              return (
                <div key={t} className="rv-bar-row rv-bar-row--turno">
                  <span className="rv-turno-label">{t.charAt(0)+t.slice(1).toLowerCase()}</span>
                  <div className="rv-bar-track rv-bar-track--h14">
                    <div className={`rv-bar-fill rv-fill--${t.toLowerCase()}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="rv-count-label rv-count-label--60">{cnt} ({pct}%)</span>
                </div>
              );
            })}
          </div>

          <div className="s-card rv-card">
            <div className="rv-analysis-title">Secciones por trayecto</div>
            {ALL_TRAYECTOS.map(t => {
              const cnt = [...new Set(data.filter(d => d.trayecto === t).map(d => d.sheet.trim()))].length;
              const pct = metricas.seccionesCount > 0 ? (cnt/metricas.seccionesCount)*100 : 0;
              return (
                <div key={t} className="rv-bar-row">
                  <span className={`rv-trayecto-badge ${trayectoClass(t)}`}>{t}</span>
                  <div className="rv-bar-track">
                    <div className={`rv-bar-fill ${trayectoClass(t)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="rv-count-label rv-count-label--32">{cnt}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!metricas && (
        <div className="s-card s-empty-state">
          Carga un archivo Excel para ver el resumen.
        </div>
      )}
    </div>
  );
}
