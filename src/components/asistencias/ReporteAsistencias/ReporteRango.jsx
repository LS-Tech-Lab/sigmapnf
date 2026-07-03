import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { S, DEFAULT_PROGRAMAS, TURNOS_CONFIG } from "../../../constants";
import { fechaHoyVE } from "../../../utils/time";
import { logger } from "../../../utils/logger";
import { rangoFechas } from "./helpers";
import { exportarPDFRango } from "./exportPDF";
import { exportarCSVRango } from "./exportCSV";

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
  const [isOffline, setIsOffline] = useState(false);
  const [truncado, setTruncado] = useState(false);

  // A-4: ref al AbortController del fetch en curso. fetchRango se dispara
  // de nuevo cada vez que cambian inicio/fin/turno/programa; si el usuario
  // cambia filtros antes de que termine la paginación anterior, se aborta
  // el fetch viejo para que su respuesta tardía no pise la tabla con datos
  // de un rango/turno que ya no es el seleccionado.
  const abortControllerRef = useRef(null);

  // A-2: paginación por cursor (mismo patrón que useDataSync) para evitar
  // que el límite por defecto de Supabase (1000 filas) trunque el reporte
  // sin avisar. RANGO_PAGE_SIZE controla el tamaño de cada página y
  // RANGO_MAX_FILAS es un tope de seguridad para no cargar rangos absurdos.
  const RANGO_PAGE_SIZE = 1000;
  const RANGO_MAX_FILAS = 20000;

  const fetchRango = useCallback(async () => {
    if (!inicio || !fin || inicio > fin) return;

    // A-4: cancelar el fetch anterior si seguía en curso.
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    // Sin red: no ejecutar — mostrar aviso
    if (!navigator.onLine) {
      setIsOffline(true);
      setRows([]);
      setLoading(false);
      return;
    }

    setIsOffline(false);
    setTruncado(false);
    setLoading(true); setError(null);

    try {
      const todasLasFilas = [];
      let cursor = 0;
      let hayMas = true;

      while (hayMas) {
        let q = supabase
          .from("asistencias_diarias")
          .select("id, cedula_docente, nombre_docente, fecha, programa")
          .gt("id", cursor)
          .gte("fecha", inicio).lte("fecha", fin).eq("turno", turno)
          .order("id", { ascending: true })
          .limit(RANGO_PAGE_SIZE)
          .abortSignal(signal);
        if (programa) q = q.eq("programa", programa);

        const { data, error: err } = await q;
        // A-4: si este fetch ya fue superado por uno más nuevo, descartar
        // el resultado en silencio en vez de pisar la tabla actual.
        if (signal.aborted) return;
        if (err) { setError(err.message); setRows([]); setLoading(false); return; }

        const filas = data || [];
        todasLasFilas.push(...filas);

        if (filas.length < RANGO_PAGE_SIZE) {
          hayMas = false;
        } else if (todasLasFilas.length >= RANGO_MAX_FILAS) {
          // Guardia de tope: avisar que hay más datos que no se cargaron.
          setTruncado(true);
          hayMas = false;
        } else {
          const nextCursor = filas[filas.length - 1].id;
          if (nextCursor <= cursor) {
            logger.error("Paginación: cursor no avanza, abortando para evitar loop infinito.", { cursor, nextCursor });
            hayMas = false;
          } else {
            cursor = nextCursor;
          }
        }
      }

      setRows(todasLasFilas);
    } catch (e) {
      if (signal.aborted || e.name === "AbortError") return;
      setError(e.message || "Error al cargar el reporte.");
      setRows([]);
    }
    setLoading(false);
  }, [inicio, fin, turno, programa]);

  useEffect(() => { fetchRango(); }, [fetchRango]);

  // A-4: abortar el fetch en curso al desmontar el componente.
  useEffect(() => () => { if (abortControllerRef.current) abortControllerRef.current.abort(); }, []);

  useEffect(() => {
    const handleOnline  = () => { setIsOffline(false); fetchRango(); };
    const handleOffline = () => { setIsOffline(true); setRows([]); };
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchRango]);

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
      cedula: d.cedula, nombre: d.nombre,
      diasAsistidos: d.diasSet.size,
      horasEstimadas: d.diasSet.size * (turno === "NOCTURNO" ? 3 : 4),
      programas: [...d.programas],
    })).sort((a, b) => b.diasAsistidos - a.diasAsistidos);
  }, [rows, turno]);

  const filtrados   = docentes.filter(d => !busqueda || d.cedula.includes(busqueda) || d.nombre.toLowerCase().includes(busqueda.toLowerCase()));
  const diasHabiles = rangoFechas(inicio, fin).length;

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-calendar-stats" style={{ fontSize: 22 }} aria-hidden="true" />
            Reporte por Rango de Fechas
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#64748B" }}>Totales por docente: días asistidos, horas estimadas y porcentaje.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onVolverDiario} style={{ padding: "8px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155", display: "flex", alignItems: "center", gap: 5 }}>
            <i className="ti ti-arrow-left" style={{ fontSize: 14 }} aria-hidden="true" />
            Vista diaria
          </button>
          <button onClick={() => exportarCSVRango(filtrados, inicio, fin, turno)} disabled={filtrados.length === 0} style={{ padding: "8px 14px", background: filtrados.length === 0 ? "#F1F5F9" : "#059669", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#64748B" : "#fff", display: "flex", alignItems: "center", gap: 5 }}>
            <i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden="true" />
            CSV
          </button>
          <button onClick={() => exportarPDFRango(filtrados, inicio, fin, turno, diasHabiles)} disabled={filtrados.length === 0} style={{ padding: "8px 14px", background: filtrados.length === 0 ? "#F1F5F9" : "#DC2626", border: "none", borderRadius: 8, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: filtrados.length === 0 ? "#64748B" : "#fff", display: "flex", alignItems: "center", gap: 5 }}>
            <i className="ti ti-printer" style={{ fontSize: 14 }} aria-hidden="true" />
            PDF
          </button>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E2E8F0", padding: "16px 20px", marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        {[["Desde", inicio, setInicio, {}], ["Hasta", fin, setFin, { max: hoy }]].map(([lbl, val, fn, extra]) => (
          <label key={lbl} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{lbl}</span>
            <input type="date" value={val} onChange={e => fn(e.target.value)} {...extra} style={{ ...S.input, fontSize: 13 }} />
          </label>
        ))}
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Turno</span>
          <select value={turno} onChange={e => setTurno(e.target.value)} style={S.select}>
            {TURNOS_CONFIG.filter(t => t.habilitado).map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Programa</span>
          <select value={programa} onChange={e => setPrograma(e.target.value)} style={S.select}>
            <option value="">Todos</option>
            {DEFAULT_PROGRAMAS.map(p => <option key={p} value={p}>{p.replace("PNF ", "")}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Buscar</span>
          <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre o cédula…" style={S.input} />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Docentes en rango",  value: filtrados.length,                                                                                    color: "#2563EB", bg: "#EFF6FF" },
          { label: "Días hábiles",       value: diasHabiles,                                                                                         color: "#059669", bg: "#ECFDF5" },
          { label: "Asistencia ≥ 75%",  value: filtrados.filter(d => diasHabiles > 0 && (d.diasAsistidos / diasHabiles) >= 0.75).length,           color: "#15803D", bg: "#F0FDF4" },
          { label: "Asistencia < 75%",  value: filtrados.filter(d => diasHabiles > 0 && (d.diasAsistidos / diasHabiles) <  0.75).length,           color: "#DC2626", bg: "#FEF2F2" },
        ].map(stat => (
          <div key={stat.label} style={{ background: stat.bg, borderRadius: 10, padding: "14px 16px", border: `1px solid ${stat.color}22` }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2, fontWeight: 500 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {isOffline && (
        <div style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A", padding: "14px 16px", borderRadius: 8, fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <i className="ti ti-wifi-off" style={{ fontSize: 18, flexShrink: 0 }} aria-hidden="true" />
          <div>
            <strong>Sin conexión.</strong> El reporte por rango requiere red para calcularse. Vuelve a intentarlo cuando se restablezca la conexión.
          </div>
        </div>
      )}

      {truncado && (
        <div style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A", padding: "14px 16px", borderRadius: 8, fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }} role="alert">
          <i className="ti ti-alert-triangle" style={{ fontSize: 18, flexShrink: 0 }} aria-hidden="true" />
          <div>
            <strong>Resultado truncado.</strong> Se alcanzó el límite de {RANGO_MAX_FILAS.toLocaleString("es")} registros para este rango. Reduce el rango de fechas para ver todos los datos.
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "12px 16px", borderRadius: 8, fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
          {error}
        </div>
      )}

      <div style={{ ...S.card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{["Cédula", "Nombre", "Días asistidos", "Días hábiles", "% Asistencia", "Horas est.", "Programa(s)"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={S.td}><div style={{ height: 14, width: [100, 150, 60, 60, 60, 50, 80][j], borderRadius: 4, background: "linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} /></td>
                  ))}</tr>
                ))
              : filtrados.length === 0
                ? <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: "40px 0", color: "#64748B" }}>No hay asistencias en este rango.</td></tr>
                : filtrados.map(d => {
                    const pct   = diasHabiles > 0 ? Math.round((d.diasAsistidos / diasHabiles) * 100) : 0;
                    const color = pct >= 75 ? "#15803D" : pct >= 50 ? "#D97706" : "#DC2626";
                    return (
                      <tr key={d.cedula} onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12, color: "#1D4ED8", fontWeight: 600 }}>{d.cedula}</td>
                        <td style={{ ...S.td, fontWeight: 500 }}>{d.nombre}</td>
                        <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{d.diasAsistidos}</td>
                        <td style={{ ...S.td, textAlign: "center", color: "#64748B" }}>{diasHabiles}</td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <span style={{ color, fontWeight: 700 }}>{pct}%</span>
                          <div style={{ marginTop: 3, height: 4, borderRadius: 2, background: "#E2E8F0", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
                          </div>
                        </td>
                        <td style={{ ...S.td, textAlign: "center", fontSize: 12, color: "#64748B" }}>~{d.horasEstimadas}h</td>
                        <td style={{ ...S.td, fontSize: 12, color: "#64748B" }}>{d.programas.join(", ") || "—"}</td>
                      </tr>
                    );
                  })
            }
          </tbody>
        </table>
        {!loading && filtrados.length > 0 && (
          <div style={{ padding: "10px 16px", fontSize: 12, color: "#64748B", borderTop: "1px solid #F1F5F9", textAlign: "right" }}>
            {filtrados.length} docente{filtrados.length !== 1 ? "s" : ""} en el período
          </div>
        )}
      </div>
    </div>
  );
}

export default ReporteRango;
