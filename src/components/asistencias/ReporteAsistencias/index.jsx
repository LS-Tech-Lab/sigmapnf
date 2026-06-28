/**
 * Reporte de Asistencias — vista diaria.
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
import { guardarReporteEnIDB, cargarReporteDeIDB } from "../../../utils/reporteCache";

export default function ReporteAsistencias({ onVolverPanel }) {
  const hoy = fechaHoyVE();
  const [vistaRango, setVistaRango] = useState(false);
  const [fecha,    setFecha]    = useState(hoy);
  const [turno,    setTurno]    = useState("DIURNO");
  const [programa, setPrograma] = useState("");
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [tab,      setTab]      = useState("presentes");
  const [ausentesParaPDF, setAusentesParaPDF] = useState([]);
  const [modoOffline,     setModoOffline]     = useState(false);
  const [fechaCache,      setFechaCache]      = useState(null);

  const fetchAsistencias = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    // Sin red: intentar cargar desde IDB
    if (!navigator.onLine) {
      const cached = await cargarReporteDeIDB(fecha, turno, programa);
      if (cached) {
        setRows(cached.datos);
        setModoOffline(true);
        setFechaCache(cached.guardadoEn);
      } else {
        setRows([]);
        setModoOffline(true);
        setFechaCache(null);
        setError("Sin conexión y sin datos locales para esta fecha y filtros.");
      }
      if (!silent) setLoading(false);
      return;
    }

    setModoOffline(false);

    let query = supabase
      .from("asistencias_diarias")
      .select("id, cedula_docente, nombre_docente, fecha, turno, programa, hora_registro, tipo, qr_session_id")
      .eq("fecha", fecha)
      .order("hora_registro", { ascending: true });

    if (turno !== "TODOS") query = query.eq("turno", turno);
    if (programa) query = query.eq("programa", programa);

    const { data, error: err } = await query;
    if (err) {
      // Fetch falló con red — intentar IDB como fallback
      const cached = await cargarReporteDeIDB(fecha, turno, programa);
      if (cached) {
        setRows(cached.datos);
        setModoOffline(true);
        setFechaCache(cached.guardadoEn);
      } else {
        setError(err.message);
        setRows([]);
      }
    } else {
      const resultado = data || [];
      setRows(resultado);
      // Guardar en IDB para uso offline posterior
      await guardarReporteEnIDB(fecha, turno, programa, resultado);
    }
    if (!silent) setLoading(false);
  }, [fecha, turno, programa]);

  useEffect(() => { fetchAsistencias(); }, [fetchAsistencias]);

  useEffect(() => {
    let pollId = null;

    const ch = supabase.channel("reporte_realtime")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "asistencias_diarias" },
        () => fetchAsistencias(true)
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Realtime falló — activar polling como respaldo
          if (!pollId) {
            pollId = setInterval(() => fetchAsistencias(true), POLL_FALLBACK_MS);
          }
        } else if (status === "SUBSCRIBED") {
          // Realtime OK — cancelar polling si estaba activo
          if (pollId) { clearInterval(pollId); pollId = null; }
        }
      });

    return () => {
      supabase.removeChannel(ch);
      if (pollId) clearInterval(pollId);
    };
  }, [fetchAsistencias]);

  const docentesAgrupados = useMemo(() => agruparPorDocente(rows), [rows]);

  const filtrados = docentesAgrupados.filter(d => {
    if (!busqueda) return true;
    const q = busqueda.toLowerCase();
    return d.cedula?.toLowerCase().includes(q) || d.nombre?.toLowerCase().includes(q);
  });

  const cedulasPresentes = useMemo(
    () => new Set(docentesAgrupados.map(d => d.cedula)),
    [docentesAgrupados]
  );

  const totalDocentes = docentesAgrupados.length;
  const conSalida     = docentesAgrupados.filter(d => d.estado === "completo").length;
  const soloEntrada   = docentesAgrupados.filter(d => d.estado === "solo_entrada").length;

  const primerRegistro = rows.length > 0 ? rows[0].hora_registro : null;
  const ultimoRegistro = rows.length > 0 ? rows[rows.length - 1].hora_registro : null;

  if (vistaRango) return <ReporteRango onVolverDiario={() => setVistaRango(false)} />;

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 22 }} aria-hidden="true" />
            Reporte de Asistencias
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#64748B" }}>Registro diario de presencia docente</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onVolverPanel && (
            <button onClick={onVolverPanel} style={{ padding: "8px 16px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155", display: "flex", alignItems: "center", gap: 5 }}>
              <i className="ti ti-arrow-left" style={{ fontSize: 14 }} aria-hidden="true" />
              Volver al panel QR
            </button>
          )}
          <button onClick={() => setVistaRango(true)} style={{ padding: "8px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#1D4ED8", display: "flex", alignItems: "center", gap: 5 }}>
            <i className="ti ti-calendar-stats" style={{ fontSize: 14 }} aria-hidden="true" />
            Vista semanal / rango
          </button>
          <button
            onClick={() => exportarPDFDiario(filtrados, fecha, turno, programa, ausentesParaPDF)}
            disabled={filtrados.length === 0}
            style={{ padding: "8px 14px", background: filtrados.length === 0 ? "#F1F5F9" : "#DC2626", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#64748B" : "#fff", display: "flex", alignItems: "center", gap: 5 }}
          >
            <i className="ti ti-printer" style={{ fontSize: 14 }} aria-hidden="true" />
            PDF
          </button>
          <button
            onClick={() => exportarCSV(filtrados, fecha, turno)}
            disabled={filtrados.length === 0}
            style={{ padding: "8px 16px", background: filtrados.length === 0 ? "#F1F5F9" : "#059669", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#64748B" : "#fff", display: "flex", alignItems: "center", gap: 5 }}
          >
            <i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden="true" />
            CSV
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E2E8F0", padding: "16px 20px", marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Fecha</span>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ ...S.input, fontSize: 13 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Turno</span>
          <select value={turno} onChange={e => setTurno(e.target.value)} style={{ ...S.select }}>
            {TURNOS_FILTRO.map(t => (
              <option key={t} value={t}>
                {t === "DIURNO" ? "Diurno" : t === "VESPERTINO" ? "Vespertino" : "Todos los turnos"}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Programa</span>
          <select value={programa} onChange={e => setPrograma(e.target.value)} style={{ ...S.select }}>
            <option value="">Todos</option>
            {DEFAULT_PROGRAMAS.map(p => <option key={p} value={p}>{p.replace("PNF ", "")}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Buscar</span>
          <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre o cédula…" style={{ ...S.input }} />
        </label>
      </div>

      {/* Estadísticas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Docentes presentes", value: totalDocentes, color: "#2563EB", bg: "#EFF6FF" },
          { label: "Entrada y salida",   value: conSalida,     color: "#059669", bg: "#ECFDF5" },
          { label: "Solo entrada",       value: soloEntrada,   color: "#D97706", bg: "#FFFBEB" },
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
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2, fontWeight: 500 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "2px solid #E2E8F0", paddingBottom: 0 }}>
        {[
          { id: "presentes", label: `Presentes (${totalDocentes})`, icon: "ti-circle-check" },
          { id: "ausentes",  label: "Ausentes",                     icon: "ti-circle-x"    },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 18px", border: "none", background: "none", cursor: "pointer",
              fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "#1D4ED8" : "#64748B",
              borderBottom: `2px solid ${tab === t.id ? "#2563EB" : "transparent"}`,
              marginBottom: -2, transition: "all 0.12s",
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <i className={`ti ${t.icon}`} style={{ fontSize: 13 }} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      <AlertaSinVincular cedulasPresentes={cedulasPresentes} loading={loading} />

      {modoOffline && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#92400E" }}>
          <i className="ti ti-wifi-off" style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>
            <strong>Modo offline</strong> — mostrando datos guardados localmente.
            {fechaCache && (
              <> Última sincronización: {new Date(fechaCache).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}.</>
            )}
            {!fechaCache && " No hay datos locales para estos filtros."}
          </span>
        </div>
      )}

      {error && (
        <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "12px 16px", borderRadius: 8, fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
          {error}
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
                      <td colSpan={6} style={{ ...S.td, textAlign: "center", padding: "40px 0", color: "#64748B" }}>
                        {busqueda
                          ? "No se encontraron docentes con ese nombre o cédula."
                          : "No hay asistencias registradas para esta fecha y turno."}
                      </td>
                    </tr>
                  )
                  : filtrados.map((d) => (
                    <tr
                      key={d.cedula}
                      onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"}
                      onMouseLeave={e => e.currentTarget.style.background = ""}
                      style={{ transition: "background 0.1s" }}
                    >
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 600, color: "#1D4ED8", fontSize: 12 }}>
                        {d.cedula}
                      </td>
                      <td style={{ ...S.td, fontWeight: 500 }}>
                        {d.nombre || <span style={{ color: "#94A3B8" }}>—</span>}
                      </td>
                      <td style={S.td}>
                        <EstadoChip estado={d.estado} />
                      </td>
                      <td style={{ ...S.td, color: "#334155", fontSize: 13, fontWeight: 600 }}>
                        {d.horaEntrada
                          ? new Date(d.horaEntrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
                          : <span style={{ color: "#CBD5E1" }}>—</span>}
                      </td>
                      <td style={{ ...S.td, color: "#334155", fontSize: 13, fontWeight: 600 }}>
                        {d.horaSalida
                          ? new Date(d.horaSalida).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
                          : <span style={{ color: "#CBD5E1" }}>—</span>}
                      </td>
                      <td style={{ ...S.td, fontSize: 12, color: "#64748B" }}>
                        {d.programa?.replace("PNF ", "") || "—"}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
          {!loading && filtrados.length > 0 && (
            <div style={{ padding: "10px 16px", fontSize: 12, color: "#64748B", borderTop: "1px solid #F1F5F9", textAlign: "right" }}>
              {filtrados.length} docente{filtrados.length !== 1 ? "s" : ""} · Actualización en tiempo real
            </div>
          )}
        </div>
      )}

      {/* Vista Ausentes */}
      {tab === "ausentes" && (
        <VistaAusentes fecha={fecha} programa={programa} cedulasPresentes={cedulasPresentes} onAusentesChange={setAusentesParaPDF} />
      )}
    </div>
  );
}
