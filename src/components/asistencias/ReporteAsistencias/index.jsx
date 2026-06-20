/**
 * Reporte de Asistencias — vista diaria.
 *
 * CRÍTICO #1 FIX: El reporte agrupa por docente (cédula) y muestra
 * claramente su estado real: solo ENTRADA, ENTRADA+SALIDA, o solo SALIDA
 * (caso anómalo). La columna "Estado" ya no dice "✓ Presente" para todos.
 *
 * CRÍTICO #4 FIX: Pestaña "Ausentes" que cruza los docentes con horario
 * asignado ese día contra los que efectivamente marcaron asistencia,
 * mostrando quién tenía clases y no apareció.
 *
 * Este archivo orquesta las piezas del módulo, que viven divididas en:
 *   - helpers.js              funciones puras compartidas
 *   - exportPDF.js / exportCSV.js   exportación del reporte
 *   - EstadoChip.jsx, SkeletonRow.jsx   componentes de presentación pequeños
 *   - VistaAusentes.jsx, AlertaSinVincular.jsx   secciones con datos propios
 *   - ReporteRango.jsx        vista alternativa por rango de fechas
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../../../lib/supabase";
import { S, DEFAULT_PROGRAMAS } from "../../../constants";
import { fechaHoyVE } from "../../../utils/time";

import { TURNOS_FILTRO, POLL_FALLBACK_MS, agruparPorDocente } from "./helpers";
import { exportarPDFDiario } from "./exportPDF";
import { exportarCSV } from "./exportCSV";
import EstadoChip from "./EstadoChip";
import SkeletonRow from "./SkeletonRow";
import VistaAusentes from "./VistaAusentes";
import AlertaSinVincular from "./AlertaSinVincular";
import ReporteRango from "./ReporteRango";

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
