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

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { DEFAULT_PROGRAMAS, TURNOS_CONFIG } from "../../constants";
import { S } from "../../constants";
import { parseClase } from "../../utils/parsing";
import { fechaHoyVE } from "../../utils/time";

// FIX (turno-todos-reporte): se agrega "TODOS" como opción de filtro,
// además de los turnos reales que existen en el módulo QR (DIURNO/VESPERTINO).
// MEJORA #11: lista dinámica desde TURNOS_CONFIG — si se activa NOCTURNO
// en constants/index.js, aparece automáticamente en el filtro del reporte.
const TURNOS_FILTRO = [...TURNOS_CONFIG.filter(t => t.habilitado).map(t => t.id), "TODOS"];

// Intervalo de refresco de respaldo (ver FIX realtime-fallback-polling-reporte
// y FIX reporte-refresco-molesto). Solo es red de seguridad: Realtime ya está
// confirmado activo, así que no hace falta que sea agresivo.
const POLL_FALLBACK_MS = 60000;

// ── Días de la semana según fecha ISO ───────────────────────────────────────
const DIAS_ISO = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
function diaSemana(fechaISO) {
  // Parsear como fecha local para evitar desfase de zona horaria
  const [y, m, d] = fechaISO.split("-").map(Number);
  return DIAS_ISO[new Date(y, m - 1, d).getDay()];
}

// ── Exportar CSV con nombre_display cruzado (MEJORA #8) ─────────────────────
async function exportarCSV(docentesAgrupados, fecha, turno) {
  // Cruzar cédulas contra la tabla docentes para obtener nombre_display oficial
  const cedulas = docentesAgrupados.map(d => d.cedula).filter(Boolean);
  let nombreDisplay = {};
  if (cedulas.length > 0) {
    const { data: docentesDB } = await supabase
      .from("docentes")
      .select("cedula, nombre_display")
      .in("cedula", cedulas);
    (docentesDB || []).forEach(d => {
      if (d.cedula && d.nombre_display) nombreDisplay[d.cedula] = d.nombre_display;
    });
  }

  const headers = [
    "Cédula",
    "Nombre (ingresado por docente)",
    "Nombre oficial (sistema)",
    "¿Coincide?",
    "Estado",
    "Hora entrada",
    "Hora salida",
    "Turno",
    "Programa",
  ];

  const lines = docentesAgrupados.map(d => {
    const oficial  = nombreDisplay[d.cedula] || "";
    const coincide = oficial
      ? (oficial.trim().toLowerCase() === (d.nombre || "").trim().toLowerCase() ? "✓" : "✗ REVISAR")
      : "sin registro";
    return [
      d.cedula,
      d.nombre,
      oficial || "—",
      coincide,
      d.estado === "completo"    ? "Entrada y salida" :
      d.estado === "solo_entrada" ? "Solo entrada" :
      d.estado === "solo_salida"  ? "Solo salida (anómalo)" : "—",
      d.horaEntrada ? new Date(d.horaEntrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) : "—",
      d.horaSalida  ? new Date(d.horaSalida).toLocaleTimeString("es-VE",  { hour: "2-digit", minute: "2-digit" }) : "—",
      turno,
      d.programa || "—",
    ];
  });

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

// ── MEJORA #9: helper de días hábiles ────────────────────────────────────────
function rangoFechas(inicio, fin) {
  const dias = [];
  const cur  = new Date(inicio + "T00:00:00");
  const end  = new Date(fin   + "T00:00:00");
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) dias.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dias;
}

// ── MEJORA #10: motor de PDF (sin librerías externas) ────────────────────────
function abrirVentanaPDF({ titulo, subtitulo, columnas, filas, pie }) {
  const esc = s => String(s ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><title>${esc(titulo)}</title>
<style>
  @page{size:A4 landscape;margin:18mm 14mm}
  body{font-family:Arial,sans-serif;font-size:10pt;color:#111}
  .hdr{text-align:center;margin-bottom:16px;border-bottom:2px solid #1E3A8A;padding-bottom:10px}
  .hdr h1{margin:0 0 4px;font-size:14pt;color:#1E3A8A}.hdr p{margin:0;font-size:9pt;color:#555}
  table{width:100%;border-collapse:collapse;font-size:9pt}
  th{background:#1E3A8A;color:#fff;padding:6px 8px;text-align:left}
  td{padding:5px 8px;border-bottom:1px solid #E5E7EB}
  tr:nth-child(even) td{background:#F8FAFC}
  .ftr{margin-top:24px;display:flex;justify-content:space-between;font-size:9pt;color:#555}
  .firma{margin-top:48px;border-top:1px solid #111;width:200px;padding-top:4px;font-size:8pt}
  @media print{button{display:none}}
</style></head><body>
<div class="hdr"><h1>UNERMB · PNF · ${esc(titulo)}</h1><p>${esc(subtitulo)}</p></div>
<table><thead><tr>${columnas.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${filas.map(f => `<tr>${f.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
<div class="ftr">
  <div>Generado: ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}</div>
  <div>${esc(pie)}</div>
</div>
<div class="firma">Firma y sello del coordinador</div>
<script>window.onload=()=>window.print()<\/script>
</body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

function exportarPDFDiario(docentesAgrupados, fecha, turno, programa) {
  const columnas = ["Cédula", "Nombre docente", "Estado", "Entrada", "Salida", "Programa"];
  const filas = docentesAgrupados.map(d => [
    d.cedula, d.nombre,
    d.estado === "completo" ? "Entrada y Salida" : d.estado === "solo_entrada" ? "Solo Entrada" : "Solo Salida",
    d.horaEntrada ? new Date(d.horaEntrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) : "—",
    d.horaSalida  ? new Date(d.horaSalida).toLocaleTimeString("es-VE",  { hour: "2-digit", minute: "2-digit" }) : "—",
    d.programa?.replace("PNF ", "") || "—",
  ]);
  const [y, m, dd] = fecha.split("-");
  abrirVentanaPDF({
    titulo:    `Control de Asistencia – ${turno}`,
    subtitulo: `Fecha: ${dd}-${m}-${y}${programa ? " · " + programa : ""}`,
    columnas, filas,
    pie: `Total docentes: ${docentesAgrupados.length}`,
  });
}

function exportarPDFRango(docentes, inicio, fin, turno, diasHabiles) {
  const columnas = ["Cédula", "Nombre", "Días asistidos", "Días hábiles", "% Asistencia", "Horas est.", "Programa(s)"];
  const filas = docentes.map(d => {
    const pct = diasHabiles > 0 ? Math.round((d.diasAsistidos / diasHabiles) * 100) : 0;
    return [d.cedula, d.nombre, d.diasAsistidos, diasHabiles, `${pct}%`, `~${d.horasEstimadas}h`, d.programas.join(" / ") || "—"];
  });
  const fmt = iso => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
  abrirVentanaPDF({
    titulo:    `Reporte de Asistencia – ${turno}`,
    subtitulo: `Período: ${fmt(inicio)} al ${fmt(fin)}`,
    columnas, filas,
    pie: `Total docentes: ${docentes.length} · Días hábiles en rango: ${diasHabiles}`,
  });
}

async function exportarCSVRango(docentes, inicio, fin, turno) {
  const diasHabiles = rangoFechas(inicio, fin).length;
  const headers = ["Cédula", "Nombre", "Días asistidos", "Días hábiles", "% Asistencia", "Horas estimadas", "Programa(s)"];
  const lines = docentes.map(d => {
    const pct = diasHabiles > 0 ? Math.round((d.diasAsistidos / diasHabiles) * 100) : 0;
    return [d.cedula, d.nombre, d.diasAsistidos, diasHabiles, `${pct}%`, `~${d.horasEstimadas}h`, d.programas.join(" / ") || "—"];
  });
  const csv = [headers, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: `reporte_rango_${turno.toLowerCase()}_${inicio}_${fin}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── MEJORA #9: Vista de reporte por rango ────────────────────────────────────
function ReporteRango({ onVolverDiario }) {
  const hoy   = fechaHoyVE();
  const lunes = (() => {
    const d = new Date(); const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().slice(0, 10);
  })();
  const [inicio,   setInicio]   = useState(lunes);
  const [fin,      setFin]      = useState(hoy);
  const [turno,    setTurno]    = useState("DIURNO");
  const [programa, setPrograma] = useState("");
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [busqueda, setBusqueda] = useState("");

  const fetchRango = useCallback(async () => {
    if (!inicio || !fin || inicio > fin) return;
    setLoading(true); setError(null);
    let q = supabase.from("asistencias_diarias").select("*")
      .gte("fecha", inicio).lte("fecha", fin).eq("turno", turno);
    if (programa) q = q.eq("programa", programa);
    const { data, error: err } = await q;
    if (err) { setError(err.message); setRows([]); } else setRows(data || []);
    setLoading(false);
  }, [inicio, fin, turno, programa]);

  useEffect(() => { fetchRango(); }, [fetchRango]);

  const docentes = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      if (!map[r.cedula_docente]) map[r.cedula_docente] = { cedula: r.cedula_docente, nombre: r.nombre_docente, diasSet: new Set(), programas: new Set() };
      const d = map[r.cedula_docente];
      d.diasSet.add(r.fecha);
      if (r.programa) d.programas.add(r.programa.replace("PNF ", ""));
      d.nombre = r.nombre_docente;
    });
    return Object.values(map).map(d => ({
      cedula:         d.cedula,
      nombre:         d.nombre,
      diasAsistidos:  d.diasSet.size,
      horasEstimadas: d.diasSet.size * (turno === "NOCTURNO" ? 3 : 4),
      programas:      [...d.programas],
    })).sort((a, b) => b.diasAsistidos - a.diasAsistidos);
  }, [rows, turno]);

  const filtrados   = docentes.filter(d => !busqueda || d.cedula.includes(busqueda) || d.nombre.toLowerCase().includes(busqueda.toLowerCase()));
  const diasHabiles = rangoFechas(inicio, fin).length;

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111827" }}>📆 Reporte por Rango de Fechas</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6B7280" }}>Totales por docente: días asistidos, horas estimadas y porcentaje.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onVolverDiario} style={{ padding: "8px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>← Vista diaria</button>
          <button onClick={() => exportarCSVRango(filtrados, inicio, fin, turno)} disabled={filtrados.length === 0} style={{ padding: "8px 14px", background: filtrados.length === 0 ? "#F3F4F6" : "#059669", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#9CA3AF" : "#fff" }}>⬇ CSV</button>
          <button onClick={() => exportarPDFRango(filtrados, inicio, fin, turno, diasHabiles)} disabled={filtrados.length === 0} style={{ padding: "8px 14px", background: filtrados.length === 0 ? "#F3F4F6" : "#DC2626", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#9CA3AF" : "#fff" }}>🖨 PDF</button>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", padding: "16px 20px", marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        {[["Desde", inicio, setInicio, {}], ["Hasta", fin, setFin, { max: hoy }]].map(([lbl, val, fn, extra]) => (
          <label key={lbl} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{lbl}</span>
            <input type="date" value={val} onChange={e => fn(e.target.value)} {...extra} style={{ ...S.input, fontSize: 13 }} />
          </label>
        ))}
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Turno</span>
          <select value={turno} onChange={e => setTurno(e.target.value)} style={S.select}>
            {TURNOS_CONFIG.filter(t => t.habilitado).map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Programa</span>
          <select value={programa} onChange={e => setPrograma(e.target.value)} style={S.select}>
            <option value="">Todos</option>
            {DEFAULT_PROGRAMAS.map(p => <option key={p} value={p}>{p.replace("PNF ", "")}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Buscar</span>
          <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre o cédula…" style={S.input} />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Docentes en rango",  value: filtrados.length, color: "#2563EB", bg: "#EFF6FF" },
          { label: "Días hábiles",       value: diasHabiles,       color: "#059669", bg: "#ECFDF5" },
          { label: "Asistencia ≥ 75%",  value: filtrados.filter(d => diasHabiles > 0 && (d.diasAsistidos / diasHabiles) >= 0.75).length, color: "#15803D", bg: "#F0FDF4" },
          { label: "Asistencia < 75%",  value: filtrados.filter(d => diasHabiles > 0 && (d.diasAsistidos / diasHabiles) <  0.75).length, color: "#DC2626", bg: "#FEF2F2" },
        ].map(stat => (
          <div key={stat.label} style={{ background: stat.bg, borderRadius: 10, padding: "14px 16px", border: `1px solid ${stat.color}22` }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: 500 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "12px 16px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>⚠️ {error}</div>}

      <div style={{ ...S.card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{["Cédula", "Nombre", "Días asistidos", "Días hábiles", "% Asistencia", "Horas est.", "Programa(s)"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={S.td}><div style={{ height: 14, width: [100, 150, 60, 60, 60, 50, 80][j], borderRadius: 4, background: "linear-gradient(90deg,#F3F4F6 25%,#E5E7EB 50%,#F3F4F6 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} /></td>
                  ))}</tr>
                ))
              : filtrados.length === 0
                ? <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: "40px 0", color: "#9CA3AF" }}>No hay asistencias en este rango.</td></tr>
                : filtrados.map(d => {
                    const pct   = diasHabiles > 0 ? Math.round((d.diasAsistidos / diasHabiles) * 100) : 0;
                    const color = pct >= 75 ? "#15803D" : pct >= 50 ? "#D97706" : "#DC2626";
                    return (
                      <tr key={d.cedula} onMouseEnter={e => e.currentTarget.style.background = "#F9FAFB"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12, color: "#1D4ED8", fontWeight: 600 }}>{d.cedula}</td>
                        <td style={{ ...S.td, fontWeight: 500 }}>{d.nombre}</td>
                        <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{d.diasAsistidos}</td>
                        <td style={{ ...S.td, textAlign: "center", color: "#6B7280" }}>{diasHabiles}</td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <span style={{ color, fontWeight: 700 }}>{pct}%</span>
                          <div style={{ marginTop: 3, height: 4, borderRadius: 2, background: "#E5E7EB", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
                          </div>
                        </td>
                        <td style={{ ...S.td, textAlign: "center", fontSize: 12, color: "#6B7280" }}>~{d.horasEstimadas}h</td>
                        <td style={{ ...S.td, fontSize: 12, color: "#6B7280" }}>{d.programas.join(", ") || "—"}</td>
                      </tr>
                    );
                  })
            }
          </tbody>
        </table>
        {!loading && filtrados.length > 0 && (
          <div style={{ padding: "10px 16px", fontSize: 12, color: "#9CA3AF", borderTop: "1px solid #F3F4F6", textAlign: "right" }}>
            {filtrados.length} docente{filtrados.length !== 1 ? "s" : ""} en el período
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function ReporteAsistencias({ onVolverPanel }) {
  // FIX (fecha-hoy-timezone): antes usaba new Date().toISOString() (UTC),
  // que durante la noche en Venezuela mostraba el reporte de "mañana" en
  // vez del de hoy por defecto al abrir la pestaña.
  const hoy = fechaHoyVE();
  const [vistaRango, setVistaRango] = useState(false);
  const [fecha,    setFecha]    = useState(hoy);
  const [turno,    setTurno]    = useState("DIURNO");
  const [programa, setPrograma] = useState("");
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [tab,      setTab]      = useState("presentes"); // "presentes" | "ausentes"

  // FIX (reporte-refresco-molesto): `silent=true` actualiza los datos sin
  // tocar `loading`, para que los refrescos en segundo plano (realtime / poll
  // de respaldo) no hagan parpadear toda la tabla cada pocos segundos. Solo
  // se muestra el estado de carga cuando el usuario cambia fecha/turno/
  // programa o entra por primera vez.
  const fetchAsistencias = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    let query = supabase
      .from("asistencias_diarias")
      .select("*")
      .eq("fecha", fecha)
      .order("hora_registro", { ascending: true });

    // FIX (turno-todos-reporte): "TODOS" no filtra por turno.
    if (turno !== "TODOS") query = query.eq("turno", turno);
    if (programa) query = query.eq("programa", programa);

    const { data, error: err } = await query;
    if (err) { setError(err.message); setRows([]); }
    else     { setRows(data || []); }
    if (!silent) setLoading(false);
  }, [fecha, turno, programa]);

  useEffect(() => { fetchAsistencias(); }, [fetchAsistencias]);

  // Realtime (requiere que asistencias_diarias esté en la publicación
  // supabase_realtime — ver migración 0010_realtime_asistencias_qr.sql)
  useEffect(() => {
    const ch = supabase.channel("reporte_realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "asistencias_diarias" }, () => fetchAsistencias(true))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchAsistencias]);

  // FIX (realtime-fallback-polling-reporte) + FIX (reporte-refresco-molesto):
  // poll de respaldo silencioso. Ahora que Realtime ya está confirmado activo
  // en producción (migración 0010), este poll es solo una red de seguridad
  // por si se cae el websocket — se espació a 60s (antes 8s, que se sentía
  // como un refresco constante de la página) y ya no muestra el loader.
  useEffect(() => {
    const id = setInterval(() => fetchAsistencias(true), POLL_FALLBACK_MS);
    return () => clearInterval(id);
  }, [fetchAsistencias]);

  // FIX (ausentes-parpadeo): docentesAgrupados y cedulasPresentes se memoizan
  // por `rows`. Antes se recreaban en CADA render (incluso al teclear en el
  // buscador, o al recibir un INSERT de otro turno/fecha), generando un Set
  // nuevo cada vez. Ese Set es dependencia del useEffect de VistaAusentes y
  // de AlertaSinVincular, así que disparaba su fetch una y otra vez,
  // poniendo loading=true y haciendo "parpadear" la tabla de Ausentes.
  const docentesAgrupados = useMemo(() => agruparPorDocente(rows), [rows]);

  const filtrados = docentesAgrupados.filter(d => {
    if (!busqueda) return true;
    const q = busqueda.toLowerCase();
    return d.cedula?.toLowerCase().includes(q) || d.nombre?.toLowerCase().includes(q);
  });

  // Cédulas presentes para pasarlas a VistaAusentes (CRÍTICO #4)
  const cedulasPresentes = useMemo(
    () => new Set(docentesAgrupados.map(d => d.cedula)),
    [docentesAgrupados]
  );

  // Estadísticas separadas
  const totalDocentes = docentesAgrupados.length;
  const conSalida     = docentesAgrupados.filter(d => d.estado === "completo").length;
  const soloEntrada   = docentesAgrupados.filter(d => d.estado === "solo_entrada").length;

  const primerRegistro = rows.length > 0 ? rows[0].hora_registro : null;
  const ultimoRegistro = rows.length > 0 ? rows[rows.length - 1].hora_registro : null;

  // MEJORA #9: early return para vista de rango semanal/mensual
  if (vistaRango) return <ReporteRango onVolverDiario={() => setVistaRango(false)} />;

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
          {/* MEJORA #9: acceso a vista semanal/rango */}
          <button onClick={() => setVistaRango(true)} style={{ padding: "8px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#1D4ED8" }}>
            📆 Vista semanal / rango
          </button>
          {/* MEJORA #10: PDF del día */}
          <button
            onClick={() => exportarPDFDiario(filtrados, fecha, turno, programa)}
            disabled={filtrados.length === 0}
            style={{ padding: "8px 14px", background: filtrados.length === 0 ? "#F3F4F6" : "#DC2626", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#9CA3AF" : "#fff" }}
          >
            🖨 PDF
          </button>
          <button
            onClick={() => exportarCSV(filtrados, fecha, turno)}
            disabled={filtrados.length === 0}
            style={{ padding: "8px 16px", background: filtrados.length === 0 ? "#F3F4F6" : "#059669", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#9CA3AF" : "#fff" }}
          >
            ⬇ CSV
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
            {TURNOS_FILTRO.map(t => (
              <option key={t} value={t}>
                {t === "DIURNO" ? "☀️ Diurno" : t === "VESPERTINO" ? "🌙 Vespertino" : "🔁 Todos"}
              </option>
            ))}
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
