import React, { useState, useMemo } from 'react';
import { DAYS, S, TRAYECTO_BG, TRAYECTO_COLORS } from '../constants';
import { getTurnoDeRegistro, getHoraDisplayDeRegistro } from '../utils/turno';
import StatCard from './StatCard';
import Avatar from './Avatar';

export default function DashboardView({ stats, data, byDocente, byMateria, conflicts, getDocName, getMateriaName }) {
  const [showConflicts, setShowConflicts] = useState(false);

  const metricas = useMemo(() => {
    if (!data.length) return null;
    const docentesConConflicto = new Set(conflicts.map(c => c.docente)).size;
    const clasesPorDia = {}; DAYS.forEach(d => { clasesPorDia[d] = data.filter(r => r.dia === d).length; });
    const promedioClasesDia = Math.round(Object.values(clasesPorDia).reduce((a, b) => a + b, 0) / 5);
    const trayectosActivos = [...new Set(data.map(d => d.trayecto))].length;
    const topDocente = Object.entries(byDocente).sort((a, b) => b[1].length - a[1].length)[0];
    const topMateria = Object.entries(byMateria).sort((a, b) => b[1].length - a[1].length)[0];
    const diurno = data.filter(d => getTurnoDeRegistro(d) === "DIURNO").length;
    const vespertino = data.filter(d => getTurnoDeRegistro(d) === "VESPERTINO").length;
    return { docentesConConflicto, promedioClasesDia, trayectosActivos, topDocente, topMateria, diurno, vespertino };
  }, [data, byDocente, byMateria, conflicts]);

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 700, color: "#111827" }}>🏠 Dashboard Principal</h1>
      
      <div className="stats-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="Total de clases" value={stats.total} icon="📅" color="#2563EB" />
        <StatCard label="Secciones activas" value={stats.secciones} icon="🏫" color="#059669" />
        <StatCard label="Docentes" value={stats.docentes} icon="👥" color="#7C3AED" />
        <StatCard label="Materias" value={stats.materias} icon="📖" color="#D97706" />
      </div>

      <div className="stats-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="Conflictos activos" value={conflicts.length} icon="⚠️" color={conflicts.length > 0 ? "#DC2626" : "#059669"} />
        <StatCard label="Trayectos activos" value={metricas?.trayectosActivos || 0} icon="📊" color="#8B5CF6" />
        <StatCard label="Prom. clases/día" value={metricas?.promedioClasesDia || 0} icon="📈" color="#0EA5E9" />
        <StatCard label="Docentes con conflictos" value={metricas?.docentesConConflicto || 0} icon="🔴" color={metricas?.docentesConConflicto > 0 ? "#DC2626" : "#059669"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {conflicts.length > 0 && (
          <div style={{ ...S.card, padding: "16px 20px", background: "#FEF2F2", border: "1px solid #FECACA" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#991B1B", marginBottom: 8 }}>⚠️ Conflictos detectados</div>
            <div style={{ fontSize: 13, color: "#B91C1C", marginBottom: 10, fontWeight: 500 }}>Hay {conflicts.length} conflicto(s) de horario que requieren atención.</div>
            <button onClick={() => setShowConflicts(!showConflicts)} style={{ padding: "6px 14px", background: "#DC2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {showConflicts ? "Ocultar detalles" : "Ver detalles"}
            </button>
            {showConflicts && <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>{conflicts.slice(0, 5).map((c, i) => <div key={i} style={{ fontSize: 12, color: "#991B1B", fontWeight: 500 }}>{getDocName(c.docente)} — {c.dia.charAt(0)+c.dia.slice(1).toLowerCase()} · {getHoraDisplayDeRegistro(c.entries[0])}</div>)}</div>}
          </div>
        )}
        {metricas && (
          <div style={{ ...S.card, padding: "16px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 12 }}>Distribución por turno</div>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ flex: 1, textAlign: "center", padding: 14, background: "#EFF6FF", borderRadius: 8 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#2563EB" }}>☀️</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#1D4ED8" }}>{metricas.diurno}</div>
                <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>Diurno</div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: 14, background: "#FDF2F8", borderRadius: 8 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#DB2777" }}>🌙</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#BE185D" }}>{metricas.vespertino}</div>
                <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>Vespertino</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {metricas?.topDocente && (
          <div style={{ ...S.card, padding: "16px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 8 }}>👨‍🏫 Docente con mayor carga</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={getDocName(metricas.topDocente[0])} size={44} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>{getDocName(metricas.topDocente[0])}</div>
                <div style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>{metricas.topDocente[1]} clases asignadas</div>
              </div>
            </div>
          </div>
        )}
        {metricas?.topMateria && (
          <div style={{ ...S.card, padding: "16px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 8 }}>📖 Materia más frecuente</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>{getMateriaName(metricas.topMateria[0])}</div>
            <div style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>{metricas.topMateria[1]} clases</div>
          </div>
        )}
      </div>
    </div>
  );
}
