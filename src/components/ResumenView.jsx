import React, { useState, useMemo } from 'react';
import { DAYS, ALL_TRAYECTOS, TRAYECTO_BG, TRAYECTO_COLORS } from '../constants';
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
    <div style={{ padding: 20 }}>
      {/* A-5: banner mientras data está vacía y se está cargando el programa nuevo */}
      {isSyncing && (!data || data.length === 0) && (
        <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "#0369A1", fontWeight: 500 }}>
          <i className="ti ti-refresh" aria-hidden="true" style={{ fontSize: 15, animation: "spin 1s linear infinite" }} />
          Cargando datos del programa…
        </div>
      )}
      {/* Header con tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 9 }}>
          <i className="ti ti-layout-dashboard" style={{ fontSize: 19, color: '#2563EB' }} aria-hidden="true" /> Resumen
        </h1>
        <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 10, padding: 4 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 6,
              background: tab === t.id ? '#fff' : 'transparent',
              color: tab === t.id ? '#0F172A' : '#64748B',
              boxShadow: tab === t.id ? '0 1px 4px rgba(15,23,42,0.10)' : 'none',
            }}><i className={`ti ${t.icon}`} aria-hidden="true" /> {t.label}</button>
          ))}
        </div>
      </div>

      {/* ── TAB: VISTA GENERAL ── */}
      {tab === 'general' && (
        <>
          <div className="stats-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
            <StatCard label="Conflictos activos" value={conflicts.length} icon="ti-alert-triangle" color={conflicts.length > 0 ? '#DC2626' : '#059669'} />
            <StatCard label="Trayectos activos" value={metricas?.trayectosActivos || 0} icon="ti-chart-bar" color="#8B5CF6" />
            <StatCard label="Prom. clases/día" value={metricas?.promedioClasesDia || 0} icon="ti-trending-up" color="#0EA5E9" />
            <StatCard label="Docentes con conflictos" value={metricas?.docentesConConflicto || 0} icon="ti-user-exclamation" color={metricas?.docentesConConflicto > 0 ? '#DC2626' : '#059669'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {conflicts.length > 0 && (
              <div className="s-card rv-card rv-card--alert">
                <div style={{ fontSize: 15, fontWeight: 700, color: '#991B1B', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <i className="ti ti-alert-triangle" aria-hidden="true" /> Conflictos detectados
                </div>
                <div style={{ fontSize: 13, color: '#B91C1C', marginBottom: 10, fontWeight: 500 }}>
                  Hay {conflicts.length} conflicto(s) de horario que requieren atención.
                </div>
                <button onClick={onGoToConflictos} style={{ padding: '6px 14px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  Ver detalles <i className="ti ti-arrow-right" aria-hidden="true" />
                </button>
              </div>
            )}
            {metricas && (
              <div className={`s-card rv-card ${conflicts.length > 0 ? '' : 'rv-card--full'}`}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 12 }}>Distribución por turno</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: 14, background: '#EFF6FF', borderRadius: 8 }}>
                    <i className="ti ti-sun-high" style={{ fontSize: 26, color: '#2563EB' }} aria-hidden="true" />
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#1D4ED8' }}>{metricas.diurno}</div>
                    <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>Diurno</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', padding: 14, background: '#FDF2F8', borderRadius: 8 }}>
                    <i className="ti ti-moon-stars" style={{ fontSize: 26, color: '#BE185D' }} aria-hidden="true" />
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#BE185D' }}>{metricas.vespertino}</div>
                    <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>Vespertino</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {metricas?.topDocente && (
              <div className="s-card rv-card">
                <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <i className="ti ti-user-star" aria-hidden="true" /> Docente con mayor carga
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={getDocName(metricas.topDocente[0])} size={44} />
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{getDocName(metricas.topDocente[0])}</div>
                    <div style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>{metricas.topDocente[1].length} clases asignadas</div>
                  </div>
                </div>
              </div>
            )}
            {metricas?.topMateria && (
              <div className="s-card rv-card">
                <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <i className="ti ti-book-2" aria-hidden="true" /> Materia más frecuente
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{getMateriaName(metricas.topMateria[0])}</div>
                <div style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>{metricas.topMateria[1].length} clases</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TAB: ANÁLISIS DETALLADO ── */}
      {tab === 'analisis' && metricas && (
        <div className="stats-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="s-card rv-card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Clases por trayecto</div>
            {Object.entries(metricas.trayectoCount).sort().map(([t, c]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ background: TRAYECTO_BG[t] || '#f3f4f6', color: TRAYECTO_COLORS[t] || '#555', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{t}</span>
                <div style={{ flex: 1, background: '#F1F5F9', borderRadius: 4, height: 12, overflow: 'hidden' }}>
                  <div style={{ width: `${(c/stats.total)*100}%`, height: '100%', background: TRAYECTO_COLORS[t] || '#888', borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 13, width: 32, textAlign: 'right', color: '#64748B', fontWeight: 600 }}>{c}</span>
              </div>
            ))}
          </div>

          <div className="s-card rv-card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Distribución por día</div>
            {DAYS.map(d => (
              <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 13, width: 80, color: '#64748B', fontWeight: 500 }}>{d.charAt(0)+d.slice(1).toLowerCase()}</span>
                <div style={{ flex: 1, background: '#F1F5F9', borderRadius: 4, height: 12, overflow: 'hidden' }}>
                  <div style={{ width: `${(metricas.dayCount[d]/metricas.maxDay)*100}%`, height: '100%', background: '#059669', borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 13, width: 32, textAlign: 'right', color: '#64748B', fontWeight: 600 }}>{metricas.dayCount[d]}</span>
              </div>
            ))}
          </div>

          <div className="s-card rv-card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Docentes con mayor carga</div>
            {metricas.top8Docentes.map(([doc, entries], idx) => (
              <div key={doc} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#CBD5E1', width: 16 }}>{idx+1}</span>
                <span style={{ fontSize: 13, flex: 1, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{getDocName(doc)}</span>
                <div style={{ width: 100, background: '#F1F5F9', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${(entries.length/metricas.maxLoadDocente)*100}%`, height: '100%', background: '#7C3AED', borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 13, width: 24, textAlign: 'right', color: '#64748B', fontWeight: 600 }}>{entries.length}</span>
              </div>
            ))}
          </div>

          <div className="s-card rv-card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Materias más frecuentes</div>
            {metricas.topMaterias.map(([mat, entries], idx) => {
              const cnt = entries.length;
              return (
                <div key={mat} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#CBD5E1', width: 16 }}>{idx+1}</span>
                  <span style={{ fontSize: 13, flex: 1, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }} title={getMateriaName(mat)}>
                    {getMateriaName(mat).length > 28 ? getMateriaName(mat).slice(0,26)+'…' : getMateriaName(mat)}
                  </span>
                  <div style={{ width: 100, background: '#F1F5F9', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${(cnt/metricas.maxMat)*100}%`, height: '100%', background: '#D97706', borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 13, width: 24, textAlign: 'right', color: '#64748B', fontWeight: 600 }}>{cnt}</span>
                </div>
              );
            })}
          </div>

          <div className="s-card rv-card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Distribución por turno</div>
            {Object.entries(metricas.turnoCount).sort().map(([t, cnt]) => {
              const pct = stats.total > 0 ? Math.round((cnt/stats.total)*100) : 0;
              const colors = { DIURNO: '#2563EB', VESPERTINO: '#DB2777' };
              return (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, width: 90, color: '#64748B', fontWeight: 500 }}>{t.charAt(0)+t.slice(1).toLowerCase()}</span>
                  <div style={{ flex: 1, background: '#F1F5F9', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: colors[t] || '#888', borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 13, color: '#64748B', fontWeight: 600, width: 60, textAlign: 'right' }}>{cnt} ({pct}%)</span>
                </div>
              );
            })}
          </div>

          <div className="s-card rv-card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Secciones por trayecto</div>
            {ALL_TRAYECTOS.map(t => {
              const cnt = [...new Set(data.filter(d => d.trayecto === t).map(d => d.sheet.trim()))].length;
              const pct = metricas.seccionesCount > 0 ? (cnt/metricas.seccionesCount)*100 : 0;
              return (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ background: TRAYECTO_BG[t] || '#f3f4f6', color: TRAYECTO_COLORS[t] || '#555', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{t}</span>
                  <div style={{ flex: 1, background: '#F1F5F9', borderRadius: 4, height: 12, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: TRAYECTO_COLORS[t] || '#888', borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 13, width: 32, textAlign: 'right', color: '#64748B', fontWeight: 600 }}>{cnt}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!metricas && (
        <div className="s-card rv-empty">
          Carga un archivo Excel para ver el resumen.
        </div>
      )}
    </div>
  );
}
