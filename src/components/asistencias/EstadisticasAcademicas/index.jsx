/**
 * EstadisticasAcademicas — dashboard de estadísticas y analítica académica
 * (ESTAD-1, §4.2 de RESUMEN_PENDIENTES.md).
 *
 * Consume el RPC reporte_estadisticas_academicas (0084, reemplazo de
 * por_materia en 0089/ESTAD-2), que devuelve las 5 series ya agregadas en
 * el servidor en una sola llamada: tendencia (asistencias por día),
 * por_docente, por_dia_semana, por_puntualidad y por_sede — las 4 últimas
 * se calculan solo con asistencias_diarias, sin JOIN a horarios/
 * trimestres/docentes (a diferencia de la vieja por_materia, no pueden
 * quedar vacías por un desfase de turno/trimestre).
 *
 * Gate de acceso: mismo permiso que el Reporte de Asistencias
 * (puedeVerReporteAsistencias), controlado en AsistenciasModulo.jsx — no
 * es un permiso nuevo, la RLS de asistencias_diarias/horarios (0081) ya
 * lo exige del lado del servidor.
 *
 * Mismo patrón de filtros/fetch que ReporteRango.jsx: AbortController para
 * cancelar fetches obsoletos, aviso offline, y clamp de `programa` para
 * usuarios con puedeVerSoloSuPrograma (PROG-3).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { supabase } from "../../../lib/supabase";
import { DEFAULT_PROGRAMAS, TURNOS_CONFIG } from "../../../constants";
import { fechaHoyVE } from "../../../utils/time";
import { useSedeContext } from "../../../context/SedeContext";
import useTrimestreActivo from "../../../hooks/useTrimestreActivo";
import { formatLapso, rangoTrimestre } from "../../../utils/lapso";
import { CHART_COLORS, restarDias, formatFechaCorta, topN } from "./helpers";
import "./index.css";

const MAX_BARRAS = 10;

export default function EstadisticasAcademicas({ permisos = {} }) {
  const { sedeActiva } = useSedeContext();
  const hoy = fechaHoyVE();

  const [inicio, setInicio] = useState(restarDias(hoy, 29));
  const [fin,    setFin]    = useState(hoy);
  const [turno,  setTurno]  = useState("DIURNO");

  const misProgramas = permisos.puedeVerSoloSuPrograma ? (permisos.programasRestringidos || []) : [];
  const [programa, setPrograma] = useState(misProgramas[0] || "");

  const [datos,    setDatos]    = useState({ tendencia: [], por_docente: [], por_dia_semana: [], por_puntualidad: [], por_sede: [] });
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  // ASIST-4: mismo preset de trimestre que ReporteRango.jsx -- esta vista
  // es de solo consulta (no borra nada), así que no necesita el guard de
  // vigencia, solo el atajo para saltar Desde/Hasta al rango de un
  // trimestre completo en vez de picarlo a mano.
  const { trimestres, trimestreActivo, cargando: cargandoTrimestres } = useTrimestreActivo();
  const [trimestreFiltro, setTrimestreFiltro] = useState("");

  const handleTrimestreFiltro = (lapsoElegido) => {
    setTrimestreFiltro(lapsoElegido);
    if (!lapsoElegido) return;
    const info = trimestres.find(t => t.lapso === lapsoElegido);
    const rango = rangoTrimestre(info, hoy);
    if (rango) { setInicio(rango.inicio); setFin(rango.fin); }
  };

  const abortControllerRef = useRef(null);

  // PROG-3 (mismo patrón que ReporteRango.jsx): clamp defensivo si
  // `programa` queda fuera del conjunto permitido del usuario.
  useEffect(() => {
    if (misProgramas.length > 0 && !misProgramas.includes(programa)) {
      setPrograma(misProgramas[0] || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [misProgramas.join(",")]);

  const fetchEstadisticas = useCallback(async () => {
    if (!inicio || !fin || inicio > fin) return;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    if (!navigator.onLine) {
      setIsOffline(true);
      setDatos({ tendencia: [], por_docente: [], por_dia_semana: [], por_puntualidad: [], por_sede: [] });
      setLoading(false);
      return;
    }

    setIsOffline(false);
    setLoading(true);
    setError(null);

    try {
      const { data, error: err } = await supabase
        .rpc("reporte_estadisticas_academicas", {
          p_fecha_desde: inicio,
          p_fecha_hasta: fin,
          p_turno:       turno,
          p_programa:    programa || null,
          p_sede_id:     sedeActiva || null,
        })
        .abortSignal(signal)
        .single();

      if (signal.aborted) return;

      if (err) {
        setError(err.message);
        setDatos({ tendencia: [], por_docente: [], por_dia_semana: [], por_puntualidad: [], por_sede: [] });
        setLoading(false);
        return;
      }

      setDatos({
        tendencia:       data?.tendencia       || [],
        por_docente:     data?.por_docente     || [],
        por_dia_semana:  data?.por_dia_semana  || [],
        por_puntualidad: data?.por_puntualidad || [],
        por_sede:        data?.por_sede        || [],
      });
      setLoading(false);
    } catch (e) {
      if (signal.aborted) return;
      setError(e.message);
      setLoading(false);
    }
  }, [inicio, fin, turno, programa, sedeActiva]);

  useEffect(() => {
    fetchEstadisticas();
    return () => abortControllerRef.current?.abort();
  }, [fetchEstadisticas]);

  const tendenciaFmt = useMemo(
    () => datos.tendencia.map(t => ({
      ...t,
      fechaLabel: formatFechaCorta(t.fecha),
    })),
    [datos.tendencia]
  );

  const topDocentes = useMemo(() => topN(datos.por_docente, MAX_BARRAS, "dias_asistidos", "nombre"), [datos.por_docente]);
  const porSede       = useMemo(() => topN(datos.por_sede, MAX_BARRAS, "dias_asistidos", "sede_id"), [datos.por_sede]);

  // por_dia_semana/por_puntualidad (ESTAD-2) ya vienen del servidor en un
  // conjunto fijo y chico (<=7 días, 4 franjas) -- a diferencia de docente/
  // sede no necesitan topN/truncado, solo el número asegurado como Number().
  const porDiaSemana = useMemo(
    () => (datos.por_dia_semana || []).map(d => ({ ...d, total_asistencias: Number(d.total_asistencias || 0) })),
    [datos.por_dia_semana]
  );
  const porPuntualidad = useMemo(
    () => (datos.por_puntualidad || []).map(p => ({ ...p, total_docentes: Number(p.total_docentes || 0) })),
    [datos.por_puntualidad]
  );

  const totalAsistencias = datos.tendencia.reduce((acc, t) => acc + Number(t.total_asistencias || 0), 0);
  const docentesUnicos   = datos.por_docente.length;

  return (
    <div className="est-root">
      <div className="est-header">
        <div>
          <h1 className="est-title">
            <i className="ti ti-chart-histogram est-title-icon" aria-hidden="true" />
            Estadísticas y Analítica Académica
          </h1>
          <p className="est-subtitle">Tendencia de asistencia y desglose por docente, materia y sede.</p>
        </div>
      </div>

      <div className="est-filtros">
        {!cargandoTrimestres && trimestres.length > 0 && (
          <label className="est-filtro-label">
            <span className="est-filtro-label-text">Trimestre</span>
            <select
              value={trimestreFiltro}
              onChange={e => handleTrimestreFiltro(e.target.value)}
              className="s-select"
            >
              <option value="">Rango libre</option>
              {trimestres.map(t => (
                <option key={t.lapso} value={t.lapso}>
                  {formatLapso(t.lapso)}{t.lapso === trimestreActivo ? " (actual)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {[["Desde", inicio, setInicio, {}], ["Hasta", fin, setFin, { max: hoy }]].map(([lbl, val, fn, extra]) => (
          <label key={lbl} className="est-filtro-label">
            <span className="est-filtro-label-text">{lbl}</span>
            <input type="date" value={val} onChange={e => { fn(e.target.value); setTrimestreFiltro(""); }} {...extra} className="s-input est-input-date" />
          </label>
        ))}
        <label className="est-filtro-label">
          <span className="est-filtro-label-text">Turno</span>
          <select value={turno} onChange={e => setTurno(e.target.value)} className="s-select">
            {TURNOS_CONFIG.filter(t => t.habilitado).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="est-filtro-label">
          <span className="est-filtro-label-text">Programa</span>
          <select
            value={programa}
            onChange={e => (!permisos.puedeVerSoloSuPrograma || misProgramas.length > 1) && setPrograma(e.target.value)}
            disabled={permisos.puedeVerSoloSuPrograma && misProgramas.length <= 1}
            className="s-select"
          >
            {!permisos.puedeVerSoloSuPrograma && <option value="">Todos</option>}
            {(permisos.puedeVerSoloSuPrograma ? misProgramas : DEFAULT_PROGRAMAS).map(p => (
              <option key={p} value={p}>{p.replace("PNF ", "")}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="est-stats-grid">
        <div className="est-stat-card">
          <div className="est-stat-value">{totalAsistencias}</div>
          <div className="est-stat-label">Asistencias en el período</div>
        </div>
        <div className="est-stat-card">
          <div className="est-stat-value">{docentesUnicos}</div>
          <div className="est-stat-label">Docentes distintos</div>
        </div>
        <div className="est-stat-card">
          <div className="est-stat-value">{porSede.length}</div>
          <div className="est-stat-label">Sedes con actividad</div>
        </div>
      </div>

      {isOffline && (
        <div className="est-warn-banner">
          <i className="ti ti-wifi-off est-warn-icon" aria-hidden="true" />
          <div><strong>Sin conexión.</strong> Las estadísticas requieren red para calcularse. Vuelve a intentarlo cuando se restablezca la conexión.</div>
        </div>
      )}

      {error && (
        <div className="est-error-banner">
          <i className="ti ti-alert-triangle est-error-icon" aria-hidden="true" />
          {error}
        </div>
      )}

      <section className="s-card est-chart-card">
        <h2 className="est-chart-title">Tendencia de asistencia</h2>
        {loading ? (
          <div className="est-chart-skeleton" />
        ) : tendenciaFmt.length === 0 ? (
          <p className="est-empty-msg">No hay asistencias en este período.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={tendenciaFmt} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary, #e2e8f0)" />
              <XAxis dataKey="fechaLabel" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="total_asistencias"   name="Asistencias"        stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="docentes_distintos"  name="Docentes distintos" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <div className="est-charts-grid">
        <section className="s-card est-chart-card">
          <h2 className="est-chart-title">Días asistidos por docente {datos.por_docente.length > MAX_BARRAS ? `(top ${MAX_BARRAS})` : ""}</h2>
          {loading ? (
            <div className="est-chart-skeleton" />
          ) : topDocentes.length === 0 ? (
            <p className="est-empty-msg">No hay datos para este período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topDocentes} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary, #e2e8f0)" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="etiqueta" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="dias_asistidos" name="Días asistidos" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="s-card est-chart-card">
          <h2 className="est-chart-title">Asistencia por día de la semana</h2>
          {loading ? (
            <div className="est-chart-skeleton" />
          ) : porDiaSemana.length === 0 ? (
            <p className="est-empty-msg">No hay datos para este período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porDiaSemana} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary, #e2e8f0)" />
                <XAxis dataKey="dia_nombre" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="total_asistencias" name="Asistencias" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="s-card est-chart-card">
          <h2 className="est-chart-title">Puntualidad</h2>
          <p className="est-chart-note">
            Compara la hora de marcaje de ENTRADA contra la hora de inicio del turno filtrado (5 min de gracia).
          </p>
          {loading ? (
            <div className="est-chart-skeleton" />
          ) : porPuntualidad.length === 0 ? (
            <p className="est-empty-msg">No hay entradas registradas para este período/turno.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porPuntualidad} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary, #e2e8f0)" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="total_docentes" name="Docentes" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="s-card est-chart-card">
          <h2 className="est-chart-title">Asistencia por sede</h2>
          {loading ? (
            <div className="est-chart-skeleton" />
          ) : porSede.length === 0 ? (
            <p className="est-empty-msg">No hay datos para este período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porSede} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary, #e2e8f0)" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="dias_asistidos" name="Registros" fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>
    </div>
  );
}
