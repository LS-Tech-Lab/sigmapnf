/**
 * ReporteAsistencias.jsx
 *
 * CRÍTICO #1 FIX: El reporte ahora agrupa por docente (cédula) y muestra
 * claramente su estado real: solo ENTRADA, ENTRADA+SALIDA, o solo SALIDA
 * (caso anómalo). La columna "Estado" ya no dice "✓ Presente" para todos.
 *
 * CRÍTICO #4 FIX: Nueva pestaña "Ausentes" que cruza los docentes con
 * horario asignado ese día contra los que efectivamente marcaron asistencia,
 * mostrando quién tenía clases y no apareció.
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { DEFAULT_PROGRAMAS } from "../../constants";
import { S } from "../../constants";
import { parseClase } from "../../utils/parsing";

const TURNOS = ["DIURNO", "VESPERTINO", "NOCTURNO"];

// ── Días de la semana según fecha ISO ───────────────────────────────────────
const DIAS_ISO = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
function diaSemana(fechaISO) {
  // Parsear como fecha local para evitar desfase de zona horaria
  const [y, m, d] = fechaISO.split("-").map(Number);
  return DIAS_ISO[new Date(y, m - 1, d).getDay()];
}

// ── Exportar CSV ─────────────────────────────────────────────────────────────
function exportarCSV(docentesAgrupados, fecha, turno) {
  const headers = ["Cédula", "Nombre", "Estado", "Hora entrada", "Hora salida", "Turno", "Programa"];
  const lines = docentesAgrupados.map(d => [
    d.cedula,
    d.nombre,
    d.estado === "completo"  ? "Entrada y salida" :
    d.estado === "solo_entrada" ? "Solo entrada" :
    d.estado === "solo_salida"  ? "Solo salida (anómalo)" : "—",
    d.horaEntrada ? new Date(d.horaEntrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) : "—",
    d.horaSalida  ? new Date(d.horaSalida).toLocaleTimeString("es-VE",  { hour: "2-digit", minute: "2-digit" }) : "—",
    turno,
    d.programa || "—",
  ]);

  const csvContent = [headers, ...lines]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `asistencias_${turno.toLowerCase()}_${fecha}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Chip de estado del docente ───────────────────────────────────────────────
// CRÍTICO #1: reemplaza el "✓ Presente" homogéneo por el estado real.
function EstadoChip({ estado }) {
  const map = {
    completo:    { label: "✅ Entrada y salida", bg: "#F0FDF4", color: "#15803D", border: "#86EFAC" },
    solo_entrada:{ label: "🟡 Solo entrada",     bg: "#FFFBEB", color: "#92400E", border: "#FDE68A" },
    solo_salida: { label: "⚠️ Solo salida",      bg: "#FEF2F2", color: "#DC2626", border: "#FECACA" },
  };
  const ui = map[estado] || map.solo_entrada;
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: ui.bg, color: ui.color, border: `1px solid ${ui.border}`,
      whiteSpace: "nowrap",
    }}>
      {ui.label}
    </span>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────
function SkeletonRow({ cols = 6 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={S.td}>
          <div style={{
            height: 14, width: [120, 90, 160, 90, 80, 100][i] || 100, borderRadius: 4,
            background: "linear-gradient(90deg,#F3F4F6 25%,#E5E7EB 50%,#F3F4F6 75%)",
            backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite",
          }} />
        </td>
      ))}
    </tr>
  );
}

// ── Agrupar filas por cédula → un objeto por docente ────────────────────────
function agruparPorDocente(rows) {
  const map = {};
  rows.forEach(r => {
    if (!map[r.cedula_docente]) {
      map[r.cedula_docente] = {
        cedula: r.cedula_docente,
        nombre: r.nombre_docente,
        programa: r.programa,
        horaEntrada: null,
        horaSalida: null,
        estado: null,
      };
    }
    const d = map[r.cedula_docente];
    if (r.tipo === "ENTRADA") d.horaEntrada = r.hora_registro;
    if (r.tipo === "SALIDA")  d.horaSalida  = r.hora_registro;
    // Nombre más reciente gana (por si cambió)
    d.nombre = r.nombre_docente;
  });

  Object.values(map).forEach(d => {
    if (d.horaEntrada && d.horaSalida)  d.estado = "completo";
    else if (d.horaEntrada)             d.estado = "solo_entrada";
    else                                d.estado = "solo_salida";
  });

  return Object.values(map).sort((a, b) => {
    // Primero los que solo tienen entrada (pendientes de salida), luego completos, luego anómalos
    const orden = { solo_entrada: 0, completo: 1, solo_salida: 2 };
    return (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) ||
      (a.horaEntrada || "").localeCompare(b.horaEntrada || "");
  });
}

// ── Vista: Ausentes ───────────────────────────────────────────────────────────
// CRÍTICO #4: cruza docentes con horario ese día vs los que marcaron asistencia.
function VistaAusentes({ fecha, programa, cedulasPresentes }) {
  const [ausentes, setAusentes] = useState([]);
  const [loading,  setLoading]  = useState(false);

  const dia = diaSemana(fecha);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      // Docentes que tienen horario asignado ese día de la semana
      let query = supabase
        .from("horarios")
        .select("clase, programa, sheet, hora, trayecto")
        .eq("dia", dia);

      if (programa) query = query.eq("programa", programa);

      const { data: clases } = await query;

      if (!clases || clases.length === 0) {
        setAusentes([]);
        setLoading(false);
        return;
      }

      // Agrupar clases por docente (nombre_raw extraído de clase)
      const porDocente = {};
      clases.forEach(c => {
        const { docente } = parseClase(c.clase);
        if (!docente) return;
        if (!porDocente[docente]) porDocente[docente] = { nombre: docente, clases: [], programa: c.programa };
        porDocente[docente].clases.push(c);
      });

      // Cruzar contra cédulas presentes usando la tabla docentes
      const nombresDocentes = Object.keys(porDocente);
      if (nombresDocentes.length === 0) { setAusentes([]); setLoading(false); return; }

      const { data: docentesDB } = await supabase
        .from("docentes")
        .select("nombre_raw, cedula")
        .in("nombre_raw", nombresDocentes);

      const cedulaPorNombre = {};
      (docentesDB || []).forEach(d => { if (d.cedula) cedulaPorNombre[d.nombre_raw] = d.cedula; });

      // Filtrar: docentes con horario ese día y que NO aparecen en cedulasPresentes
      const resultado = Object.values(porDocente).filter(d => {
        const cedula = cedulaPorNombre[d.nombre];
        // Si tiene cédula vinculada y está presente → no es ausente
        if (cedula && cedulasPresentes.has(cedula)) return false;
        // Si tiene cédula vinculada y NO está presente → ausente confirmado
        if (cedula) return true;
        // Sin cédula vinculada → no podemos saber, lo marcamos como "sin vincular"
        return true;
      }).map(d => ({
        ...d,
        cedula: cedulaPorNombre[d.nombre] || null,
        sinVincular: !cedulaPorNombre[d.nombre],
      }));

      setAusentes(resultado.sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setLoading(false);
    };

    fetch();
  }, [fecha, programa, dia, cedulasPresentes]);

  if (dia === "SÁBADO" || dia === "DOMINGO") {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#9CA3AF", fontSize: 14 }}>
        No hay clases asignadas los fines de semana.
      </div>
    );
  }

  return (
    <div style={{ ...S.card, overflowX: "auto" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      {!loading && ausentes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#6B7280", fontSize: 14 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
          Todos los docentes con clases hoy marcaron asistencia.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Nombre docente", "Cédula", "Clases asignadas hoy", "Programa"].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={4} />)
              : ausentes.map((d, i) => (
                <tr key={i}
                  onMouseEnter={e => e.currentTarget.style.background = "#FFF7F7"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}
                  style={{ transition: "background 0.1s" }}
                >
                  <td style={{ ...S.td, fontWeight: 600, color: "#111827" }}>
                    {d.nombre}
                  </td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                    {d.sinVincular
                      ? <span style={{ color: "#D1D5DB", fontStyle: "italic" }}>sin vincular</span>
                      : <span style={{ color: "#DC2626", fontWeight: 600 }}>{d.cedula}</span>
                    }
                  </td>
                  <td style={S.td}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {d.clases.map((c, j) => {
                        const { materia } = parseClase(c.clase);
                        return (
                          <span key={j} style={{ fontSize: 11, background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA", borderRadius: 5, padding: "2px 7px", fontWeight: 500 }}>
                            {materia || c.clase} · {c.sheet} · {c.hora}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: "#6B7280" }}>
                    {d.programa?.replace("PNF ", "") || "—"}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      )}
      {!loading && ausentes.length > 0 && (
        <div style={{ padding: "10px 16px", fontSize: 12, color: "#9CA3AF", borderTop: "1px solid #F3F4F6" }}>
          {ausentes.filter(d => !d.sinVincular).length} ausentes confirmados
          {ausentes.filter(d => d.sinVincular).length > 0 && ` · ${ausentes.filter(d => d.sinVincular).length} sin cédula vinculada (no verificables)`}
          {" · "} Día: {dia.charAt(0) + dia.slice(1).toLowerCase()}
        </div>
      )}
    </div>
  );
}

// ── CRÍTICO #3: alerta de cédulas sin vincular ───────────────────────────────
// Consulta qué cédulas de la sesión no tienen fila en docentes.cedula.
// Esas son las que la auto-vinculación no pudo resolver (nombre ambiguo).
// El admin necesita ir a Docentes y vincular la cédula manualmente.
function AlertaSinVincular({ cedulasPresentes, loading }) {
  const [sinVincular, setSinVincular] = React.useState([]);

  React.useEffect(() => {
    if (loading || cedulasPresentes.size === 0) { setSinVincular([]); return; }
    const fetch = async () => {
      const cedulas = [...cedulasPresentes];
      // Obtener cuáles de estas cédulas SÍ están en docentes.cedula
      const { data } = await supabase
        .from("docentes")
        .select("cedula, nombre_display")
        .in("cedula", cedulas);
      const vinculadas = new Set((data || []).map(d => d.cedula));
      const pendientes = cedulas.filter(c => !vinculadas.has(c));
      setSinVincular(pendientes);
    };
    fetch();
  }, [cedulasPresentes, loading]);

  if (sinVincular.length === 0) return null;

  return (
    <div style={{
      background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10,
      padding: "12px 16px", marginBottom: 16,
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
          {sinVincular.length} cédula{sinVincular.length > 1 ? "s" : ""} sin vincular al sistema de horarios
        </div>
        <div style={{ fontSize: 12, color: "#78350F", lineHeight: 1.5 }}>
          Los siguientes docentes marcaron asistencia pero su cédula no coincidió con ningún docente del horario.
          Ve a <strong>Docentes</strong> y asigna manualmente la cédula correspondiente para que su horario aparezca en el escaneo.
        </div>
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {sinVincular.map(c => (
            <span key={c} style={{
              fontSize: 12, fontFamily: "monospace", fontWeight: 700,
              background: "#FEF3C7", color: "#92400E",
              border: "1px solid #FDE68A", borderRadius: 5, padding: "2px 8px",
            }}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function ReporteAsistencias({ onVolverPanel }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha,    setFecha]    = useState(hoy);
  const [turno,    setTurno]    = useState("DIURNO");
  const [programa, setPrograma] = useState("");
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [tab,      setTab]      = useState("presentes"); // "presentes" | "ausentes"

  const fetchAsistencias = useCallback(async () => {
    setLoading(true);
    setError(null);

    let query = supabase
      .from("asistencias_diarias")
      .select("*")
      .eq("fecha", fecha)
      .eq("turno", turno)
      .order("hora_registro", { ascending: true });

    if (programa) query = query.eq("programa", programa);

    const { data, error: err } = await query;
    if (err) { setError(err.message); setRows([]); }
    else     { setRows(data || []); }
    setLoading(false);
  }, [fecha, turno, programa]);

  useEffect(() => { fetchAsistencias(); }, [fetchAsistencias]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel("reporte_realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "asistencias_diarias" }, fetchAsistencias)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchAsistencias]);

  // CRÍTICO #1: agrupar por docente antes de mostrar
  const docentesAgrupados = agruparPorDocente(rows);

  const filtrados = docentesAgrupados.filter(d => {
    if (!busqueda) return true;
    const q = busqueda.toLowerCase();
    return d.cedula?.toLowerCase().includes(q) || d.nombre?.toLowerCase().includes(q);
  });

  // Cédulas presentes para pasarlas a VistaAusentes (CRÍTICO #4)
  const cedulasPresentes = new Set(docentesAgrupados.map(d => d.cedula));

  // Estadísticas separadas
  const totalDocentes = docentesAgrupados.length;
  const conSalida     = docentesAgrupados.filter(d => d.estado === "completo").length;
  const soloEntrada   = docentesAgrupados.filter(d => d.estado === "solo_entrada").length;

  const primerRegistro = rows.length > 0 ? rows[0].hora_registro : null;
  const ultimoRegistro = rows.length > 0 ? rows[rows.length - 1].hora_registro : null;

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111827" }}>📋 Reporte de Asistencias</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6B7280" }}>Registro diario de presencia docente</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onVolverPanel && (
            <button onClick={onVolverPanel} style={{ padding: "8px 16px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>
              ← Volver al panel QR
            </button>
          )}
          <button
            onClick={() => exportarCSV(filtrados, fecha, turno)}
            disabled={filtrados.length === 0}
            style={{ padding: "8px 16px", background: filtrados.length === 0 ? "#F3F4F6" : "#059669", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#9CA3AF" : "#fff" }}
          >
            ⬇ Exportar CSV
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", padding: "16px 20px", marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Fecha</span>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ ...S.input, fontSize: 13 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Turno</span>
          <select value={turno} onChange={e => setTurno(e.target.value)} style={{ ...S.select }}>
            {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Programa</span>
          <select value={programa} onChange={e => setPrograma(e.target.value)} style={{ ...S.select }}>
            <option value="">Todos</option>
            {DEFAULT_PROGRAMAS.map(p => <option key={p} value={p}>{p.replace("PNF ", "")}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Buscar</span>
          <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre o cédula…" style={{ ...S.input }} />
        </label>
      </div>

      {/* Estadísticas — CRÍTICO #1 + #2: métricas separadas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Docentes presentes", value: totalDocentes, color: "#2563EB", bg: "#EFF6FF" },
          { label: "Entrada y salida",   value: conSalida,     color: "#059669", bg: "#ECFDF5" },
          { label: "Solo entrada",        value: soloEntrada,  color: "#D97706", bg: "#FFFBEB" },
          {
            label: "Primer registro",
            value: primerRegistro
              ? new Date(primerRegistro).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
              : "—",
            color: "#7C3AED", bg: "#F5F3FF",
          },
          {
            label: "Último registro",
            value: ultimoRegistro
              ? new Date(ultimoRegistro).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
              : "—",
            color: "#DC2626", bg: "#FEF2F2",
          },
        ].map(stat => (
          <div key={stat.label} style={{ background: stat.bg, borderRadius: 10, padding: "14px 16px", border: `1px solid ${stat.color}22` }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: 500 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Pestañas: Presentes / Ausentes — CRÍTICO #4 */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "2px solid #E5E7EB", paddingBottom: 0 }}>
        {[
          { id: "presentes", label: `🟢 Presentes (${totalDocentes})` },
          { id: "ausentes",  label: `🔴 Ausentes`                      },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 18px", border: "none", background: "none", cursor: "pointer",
              fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "#1D4ED8" : "#6B7280",
              borderBottom: `2px solid ${tab === t.id ? "#2563EB" : "transparent"}`,
              marginBottom: -2, transition: "all 0.12s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* CRÍTICO #3 — aviso de cédulas cuya auto-vinculación falló.
          Se detecta consultando docentes.cedula: si una cédula de asistencias
          no tiene ninguna fila en docentes con esa cedula, el admin debe
          vincularla manualmente desde Docentes → editar cédula. */}
      <AlertaSinVincular cedulasPresentes={cedulasPresentes} loading={loading} />

      {/* Error */}
      {error && (
        <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "12px 16px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Vista Presentes */}
      {tab === "presentes" && (
        <div style={{ ...S.card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Cédula", "Nombre docente", "Estado", "Entrada", "Salida", "Programa"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={6} />)
                : filtrados.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} style={{ ...S.td, textAlign: "center", padding: "40px 0", color: "#9CA3AF" }}>
                        {busqueda
                          ? "No se encontraron docentes con ese nombre o cédula."
                          : "No hay asistencias registradas para esta fecha y turno."}
                      </td>
                    </tr>
                  )
                  : filtrados.map((d, i) => (
                    <tr
                      key={d.cedula}
                      onMouseEnter={e => e.currentTarget.style.background = "#F9FAFB"}
                      onMouseLeave={e => e.currentTarget.style.background = ""}
                      style={{ transition: "background 0.1s" }}
                    >
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 600, color: "#1D4ED8", fontSize: 12 }}>
                        {d.cedula}
                      </td>
                      <td style={{ ...S.td, fontWeight: 500 }}>
                        {d.nombre || <span style={{ color: "#9CA3AF" }}>—</span>}
                      </td>
                      <td style={S.td}>
                        {/* CRÍTICO #1: estado real del docente */}
                        <EstadoChip estado={d.estado} />
                      </td>
                      <td style={{ ...S.td, color: "#374151", fontSize: 13, fontWeight: 600 }}>
                        {d.horaEntrada
                          ? new Date(d.horaEntrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
                          : <span style={{ color: "#D1D5DB" }}>—</span>}
                      </td>
                      <td style={{ ...S.td, color: "#374151", fontSize: 13, fontWeight: 600 }}>
                        {d.horaSalida
                          ? new Date(d.horaSalida).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
                          : <span style={{ color: "#D1D5DB" }}>—</span>}
                      </td>
                      <td style={{ ...S.td, fontSize: 12, color: "#6B7280" }}>
                        {d.programa?.replace("PNF ", "") || "—"}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
          {!loading && filtrados.length > 0 && (
            <div style={{ padding: "10px 16px", fontSize: 12, color: "#9CA3AF", borderTop: "1px solid #F3F4F6", textAlign: "right" }}>
              {filtrados.length} docente{filtrados.length !== 1 ? "s" : ""} · Actualización en tiempo real
            </div>
          )}
        </div>
      )}

      {/* Vista Ausentes — CRÍTICO #4 */}
      {tab === "ausentes" && (
        <VistaAusentes
          fecha={fecha}
          programa={programa}
          cedulasPresentes={cedulasPresentes}
        />
      )}
    </div>
  );
}
