import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { DEFAULT_PROGRAMAS, TURNOS_CONFIG, pctClass } from "../../../constants";
import { fechaHoyVE } from "../../../utils/time";
import { rangoFechas } from "./helpers";
import { exportarPDFRango } from "./exportPDF";
import { exportarCSVRango } from "./exportCSV";
import { ModalConfirm } from "../../usuarios/shared";
import { useReporteConfig } from "../../../hooks/useReporteConfig";
import { useSedeContext } from "../../../context/SedeContext";
import "./index.css";

function ReporteRango({ onVolverDiario, permisos = {}, showToast }) {
  // SEDE-13 (auditoría 6 ago): admin_borrar_asistencias_rango ahora exige
  // p_sede_id (mismo patrón que conflictos_horario/crear_qr_session) --
  // antes borraba asistencias de TODAS las sedes que hicieran match con
  // el rango/turno/programa.
  const { sedeActiva } = useSedeContext();
  const hoy   = fechaHoyVE();
  // Fix (recurrencia de fecha-hoy-timezone, ver utils/time.js): se deriva
  // del mismo `hoy` anclado a Venezuela, no de `new Date()` crudo (que usa
  // el timezone del runtime — en producción, UTC). Aritmética en UTC para
  // no reintroducir el mismo desfase por otra vía.
  const lunes = (() => {
    const d = new Date(`${hoy}T00:00:00Z`);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().slice(0, 10);
  })();
  const [inicio,   setInicio]   = useState(lunes);
  const [fin,      setFin]      = useState(hoy);
  const [turno,    setTurno]    = useState("DIURNO");
  const [programa, setPrograma] = useState("");
  // ARCH-27 (auditoría 1 ago): `docentes` ya viene agregado por docente
  // desde el servidor (ver reporte_asistencias_rango_agregado, migración
  // 0055) — ya no se guardan las filas crudas de asistencia en el cliente.
  // `totalRegistros` es solo el conteo (sin transferir filas) usado en el
  // modal de borrado, que sí opera sobre registros individuales.
  const [docentes,       setDocentes]       = useState([]);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [isOffline, setIsOffline] = useState(false);
  // ADMIN-6: mismo hook de branding que ReporteAsistencias/index.jsx —
  // ReporteRango es una vista hermana (no anidada), se carga aparte.
  const { config: reporteConfig } = useReporteConfig();

  // ADMIN-2: borrado de reportes de asistencia por rango (solo admin,
  // permiso puedeBorrarReportes). Usa exactamente los mismos filtros que
  // ya están aplicados en pantalla (inicio/fin/turno/programa) — ver RPC
  // admin_borrar_asistencias_rango (0053). Es la operación más destructiva
  // de las tres de este audit item: borra datos reales de asistencia, no
  // solo metadatos de sesión.
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [borrando,      setBorrando]      = useState(false);

  // ARCH-4: ref al AbortController del fetch en curso. fetchRango se dispara
  // de nuevo cada vez que cambian inicio/fin/turno/programa; si el usuario
  // cambia filtros antes de que termine la paginación anterior, se aborta
  // el fetch viejo para que su respuesta tardía no pise la tabla con datos
  // de un rango/turno que ya no es el seleccionado.
  const abortControllerRef = useRef(null);

  // ARCH-27 (auditoría 1 ago): la paginación por offset de hasta 20.000
  // filas crudas (ver historial de ARCH-2/UX-15 en AUDITORIA_INDICE.md) se
  // reemplaza por una sola llamada a reporte_asistencias_rango_agregado
  // (migración 0055), que agrupa por docente en el servidor. Ya no hay
  // límite de filas que truncar ni múltiples idas y vueltas de red que
  // necesiten un indicador de progreso — el problema que motivaba ambas
  // cosas (transferir filas individuales) desaparece con la agregación
  // server-side.
  const fetchRango = useCallback(async () => {
    if (!inicio || !fin || inicio > fin) return;

    // ARCH-4: cancelar el fetch anterior si seguía en curso.
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    // Sin red: no ejecutar — mostrar aviso
    if (!navigator.onLine) {
      setIsOffline(true);
      setDocentes([]);
      setTotalRegistros(0);
      setLoading(false);
      return;
    }

    setIsOffline(false);
    setLoading(true); setError(null);

    try {
      const rpcCall = supabase
        .rpc("reporte_asistencias_rango_agregado", {
          p_fecha_desde: inicio,
          p_fecha_hasta: fin,
          p_turno:       turno,
          p_programa:    programa || null,
          p_sede_id:     sedeActiva || null,
        })
        .abortSignal(signal);

      // Conteo liviano (head: sin transferir filas) — solo para el texto
      // del modal de borrado, que opera sobre registros individuales, no
      // sobre docentes agregados.
      let countQuery = supabase
        .from("asistencias_diarias")
        .select("id", { count: "exact", head: true })
        .gte("fecha", inicio).lte("fecha", fin).eq("turno", turno)
        .abortSignal(signal);
      if (programa) countQuery = countQuery.eq("programa", programa);
      // SEDE-16: sin este filtro, un rol con puedeVerTodasLasSedes veía el
      // conteo (y el reporte agregado de arriba, ver p_sede_id) mezclando
      // TODAS las sedes -- RLS (0064) las deja pasar todas para ese rol.
      if (sedeActiva) countQuery = countQuery.eq("sede_id", sedeActiva);

      const [{ data, error: err }, { count, error: countErr }] = await Promise.all([rpcCall, countQuery]);

      // ARCH-4: si este fetch ya fue superado por uno más nuevo, descartar
      // el resultado en silencio en vez de pisar la tabla actual.
      if (signal.aborted) return;
      if (err || countErr) {
        setError((err || countErr).message);
        setDocentes([]);
        setTotalRegistros(0);
        setLoading(false);
        return;
      }

      // Fix (caso PNF Agroalimentación, turno MIXTO): antes se estimaban las
      // horas trabajadas con un ternario fijo (NOCTURNO=3, cualquier otro
      // turno=4) — una aproximación razonable mientras solo existían
      // DIURNO/VESPERTINO (4.5h reales cada uno, redondeadas hacia abajo).
      // MIXTO dura 9h (7:00am-4:00pm continuo, sin el corte de mediodía),
      // así que con el ternario viejo un docente de Agroalimentación con
      // jornada completa aparecía con menos de la mitad de sus horas
      // reales. Ahora se deriva de TURNOS_CONFIG (inicioMin/finMin), igual
      // redondeado hacia abajo para no romper los números ya conocidos de
      // DIURNO/VESPERTINO/NOCTURNO — y cualquier turno nuevo que se agregue
      // a futuro queda cubierto automáticamente sin tocar este archivo.
      const conf = TURNOS_CONFIG.find(t => t.id === turno);
      const horasPorDia = (conf?.inicioMin != null && conf?.finMin != null)
        ? Math.floor((conf.finMin - conf.inicioMin) / 60)
        : 4; // fallback (ej. turno="" / sin filtro): mismo valor de siempre

      const agregados = (data || []).map(d => ({
        cedula: d.cedula_docente,
        nombre: d.nombre_docente,
        diasAsistidos: Number(d.dias_asistidos),
        horasEstimadas: Number(d.dias_asistidos) * horasPorDia,
        programas: (d.programas || []).map(p => p.replace("PNF ", "")),
      }));

      setDocentes(agregados);
      setTotalRegistros(count ?? 0);
    } catch (e) {
      if (signal.aborted || e.name === "AbortError") return;
      setError(e.message || "Error al cargar el reporte.");
      setDocentes([]);
      setTotalRegistros(0);
    }
    setLoading(false);
  }, [inicio, fin, turno, programa, sedeActiva]);

  useEffect(() => { fetchRango(); }, [fetchRango]);

  const handleBorrarRango = async () => {
    setBorrando(true);
    const { data: cantidad, error } = await supabase.rpc("admin_borrar_asistencias_rango", {
      p_fecha_desde: inicio,
      p_fecha_hasta: fin,
      p_turno:       turno || null,
      p_programa:    programa || null,
      p_sede_id:     sedeActiva || null,
    });
    setBorrando(false);
    setConfirmBorrar(false);
    if (error) {
      showToast?.(error.message || "No se pudieron borrar los registros.", "error");
    } else {
      showToast?.(`Se borraron ${cantidad ?? 0} registro(s) de asistencia.`, "success");
      fetchRango();
    }
  };


  // ARCH-4: abortar el fetch en curso al desmontar el componente.
  useEffect(() => () => { if (abortControllerRef.current) abortControllerRef.current.abort(); }, []);

  useEffect(() => {
    const handleOnline  = () => { setIsOffline(false); fetchRango(); };
    const handleOffline = () => { setIsOffline(true); setDocentes([]); setTotalRegistros(0); };
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchRango]);

  // ARCH-28 (auditoría 1 ago): ambos se recalculaban en cada render aunque
  // sus dependencias reales no hubieran cambiado (ej. al reabrir el modal
  // de borrado). `docentes` ya viene ordenado y agregado desde
  // reporte_asistencias_rango_agregado (ARCH-27), así que aquí solo queda
  // filtrar por búsqueda.
  const filtrados   = useMemo(
    () => docentes.filter(d => !busqueda || d.cedula.includes(busqueda) || d.nombre.toLowerCase().includes(busqueda.toLowerCase())),
    [docentes, busqueda]
  );
  const diasHabiles = useMemo(() => rangoFechas(inicio, fin).length, [inicio, fin]);

  return (
    <div className="ra-root">
      <div className="ra-header">
        <div>
          <h1 className="ra-title">
            <i className="ti ti-calendar-stats ra-title-icon" aria-hidden="true" />
            Reporte por Rango de Fechas
          </h1>
          <p className="ra-subtitle">Totales por docente: días asistidos, horas estimadas y porcentaje.</p>
        </div>
        <div className="ra-header-actions">
          <button onClick={onVolverDiario} className="ra-btn ra-btn-volver ra-btn--sm">
            <i className="ti ti-arrow-left ra-btn-icon" aria-hidden="true" />
            Vista diaria
          </button>
          <button onClick={() => exportarCSVRango(filtrados, inicio, fin, turno)} disabled={filtrados.length === 0} className={`ra-btn ra-btn-csv ra-btn--sm${filtrados.length === 0 ? ' ra-btn-csv--disabled' : ''}`}>
            <i className="ti ti-download ra-btn-icon" aria-hidden="true" />
            CSV
          </button>
          <button onClick={() => exportarPDFRango(filtrados, inicio, fin, turno, diasHabiles, reporteConfig)} disabled={filtrados.length === 0} className={`ra-btn ra-btn-pdf${filtrados.length === 0 ? ' ra-btn-pdf--disabled' : ''}`}>
            <i className="ti ti-printer ra-btn-icon" aria-hidden="true" />
            PDF
          </button>
          {permisos.puedeBorrarReportes && (
            <button
              onClick={() => setConfirmBorrar(true)}
              disabled={totalRegistros === 0}
              className={`ra-btn ra-btn--sm ra-btn-borrar-rango${totalRegistros === 0 ? ' ra-btn-borrar-rango--disabled' : ''}`}
            >
              <i className="ti ti-trash ra-btn-icon" aria-hidden="true" />
              Borrar rango
            </button>
          )}
        </div>
      </div>

      <div className="ra-filtros">
        {[["Desde", inicio, setInicio, {}], ["Hasta", fin, setFin, { max: hoy }]].map(([lbl, val, fn, extra]) => (
          <label key={lbl} className="ra-filtro-label">
            <span className="ra-filtro-label-text">{lbl}</span>
            <input type="date" value={val} onChange={e => fn(e.target.value)} {...extra} className="s-input ra-input-date" />
          </label>
        ))}
        <label className="ra-filtro-label">
          <span className="ra-filtro-label-text">Turno</span>
          <select value={turno} onChange={e => setTurno(e.target.value)} className="s-select">
            {/* Antes mostraba el id crudo (ej. "MIXTO") en vez de un label
                legible — inconsistente con el resto de selects de turno de
                la app (AdminQRPanel, ReporteAsistencias/index.jsx, etc.),
                que sí usan TURNOS_CONFIG.label. */}
            {TURNOS_CONFIG.filter(t => t.habilitado).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="ra-filtro-label">
          <span className="ra-filtro-label-text">Programa</span>
          <select value={programa} onChange={e => setPrograma(e.target.value)} className="s-select">
            <option value="">Todos</option>
            {DEFAULT_PROGRAMAS.map(p => <option key={p} value={p}>{p.replace("PNF ", "")}</option>)}
          </select>
        </label>
        <label className="ra-filtro-label ra-filtro-label--grow160">
          <span className="ra-filtro-label-text">Buscar</span>
          <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre o cédula…" className="s-input" />
        </label>
      </div>

      <div className="ra-stats-grid">
        {[
          { label: "Docentes en rango",  value: filtrados.length,                                                                                    variant: "docentes" },
          { label: "Días hábiles",       value: diasHabiles,                                                                                         variant: "dias" },
          { label: "Asistencia ≥ 75%",  value: filtrados.filter(d => diasHabiles > 0 && (d.diasAsistidos / diasHabiles) >= 0.75).length,           variant: "alta" },
          { label: "Asistencia < 75%",  value: filtrados.filter(d => diasHabiles > 0 && (d.diasAsistidos / diasHabiles) <  0.75).length,           variant: "baja" },
        ].map(stat => (
          <div key={stat.label} className={`ra-stat-card ra-stat-card--${stat.variant}`}>
            <div className={`ra-stat-value ra-stat-value--${stat.variant}`}>{stat.value}</div>
            <div className="ra-stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {isOffline && (
        <div className="ra-warn-banner">
          <i className="ti ti-wifi-off ra-warn-icon" aria-hidden="true" />
          <div>
            <strong>Sin conexión.</strong> El reporte por rango requiere red para calcularse. Vuelve a intentarlo cuando se restablezca la conexión.
          </div>
        </div>
      )}

      {error && (
        <div className="ra-error-banner">
          <i className="ti ti-alert-triangle ra-error-icon" aria-hidden="true" />
          {error}
        </div>
      )}

      <div className="s-card ra-table-wrap">
        <table className="ra-table ra-table--rango">
          <thead>
            <tr>{["Cédula", "Nombre", "Días asistidos", "Días hábiles", "% Asistencia", "Horas est.", "Programa(s)"].map(h => <th key={h} className="s-th">{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="s-td"><div className="ra-skeleton-bar" /></td>
                  ))}</tr>
                ))
              : filtrados.length === 0
                ? <tr><td colSpan={7} className="s-td ra-td-empty-msg">No hay asistencias en este rango.</td></tr>
                : filtrados.map(d => {
                    const pct   = diasHabiles > 0 ? Math.round((d.diasAsistidos / diasHabiles) * 100) : 0;
                    const pctVariant = pct >= 75 ? "alta" : pct >= 50 ? "media" : "baja";
                    return (
                      <tr key={d.cedula}>
                        <td className="s-td ra-td-cedula">{d.cedula}</td>
                        <td className="s-td ra-td-nombre">{d.nombre}</td>
                        <td className="s-td ra-td-center-bold">{d.diasAsistidos}</td>
                        <td className="s-td ra-td-center-muted">{diasHabiles}</td>
                        <td className="s-td ra-td-pct">
                          <span className={`ra-pct-label ra-pct--${pctVariant}`}>{pct}%</span>
                          <div className="ra-pct-track">
                            <div className={`ra-pct-fill ra-pct--${pctVariant} ${pctClass(pct)}`} />
                          </div>
                        </td>
                        <td className="s-td ra-td-center-sm-muted">~{d.horasEstimadas}h</td>
                        <td className="s-td ra-td-programa">{d.programas.join(", ") || "—"}</td>
                      </tr>
                    );
                  })
          }
          </tbody>
        </table>
        {!loading && filtrados.length > 0 && (
          <div className="ra-table-footer">
            {filtrados.length} docente{filtrados.length !== 1 ? "s" : ""} en el período
          </div>
        )}
      </div>

      {confirmBorrar && (
        <ModalConfirm
          titulo="¿Borrar reporte de asistencia?"
          mensaje={`Se borrarán ${totalRegistros} registro${totalRegistros !== 1 ? "s" : ""} de asistencia entre ${inicio} y ${fin}${turno ? ` (turno ${turno})` : ""}${programa ? `, programa ${programa.replace("PNF ", "")}` : ""}. Esta acción no se puede deshacer.`}
          onConfirm={borrando ? undefined : handleBorrarRango}
          onCancel={borrando ? undefined : () => setConfirmBorrar(false)}
          peligro
        />
      )}
    </div>
  );
}

export default ReporteRango;
