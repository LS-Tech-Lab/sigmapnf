import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { DEFAULT_PROGRAMAS, TURNOS_CONFIG, pctClass } from "../../../constants";
import { fechaHoyVE } from "../../../utils/time";
import { rangoFechas } from "./helpers";
import { exportarPDFRango } from "./exportPDF";
import { exportarCSVRango } from "./exportCSV";
import { ModalConfirm } from "../../usuarios/shared";
import "./index.css";

function ReporteRango({ onVolverDiario, permisos = {}, showToast }) {
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

  // ARCH-2: paginación por cursor (mismo patrón que useDataSync) para evitar
  // que el límite por defecto de Supabase (1000 filas) trunque el reporte
  // sin avisar. RANGO_PAGE_SIZE controla el tamaño de cada página y
  // RANGO_MAX_FILAS es un tope de seguridad para no cargar rangos absurdos.
  const RANGO_PAGE_SIZE = 1000;
  const RANGO_MAX_FILAS = 20000;

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
      setRows([]);
      setLoading(false);
      return;
    }

    setIsOffline(false);
    setTruncado(false);
    setLoading(true); setError(null);

    try {
      const todasLasFilas = [];
      // Fix (14 de julio): `asistencias_diarias.id` es UUID (ver migración
      // 0006_modulo_asistencias_qr.sql), no un entero autoincremental. La
      // paginación por cursor `.gt("id", cursor)` partía de `cursor = 0` y
      // Postgres rechaza comparar una columna uuid contra el entero 0 —
      // "invalid input syntax for type uuid: 0" en la primera página, antes
      // de que llegara ningún dato real. Los UUID tampoco tienen un orden
      // secuencial útil, así que un cursor por `id` no aplica aquí (a
      // diferencia de `horarios.id`, que sí es INTEGER — ver
      // useDataSync.js/PlanillaQR.jsx). Se pagina por offset, ordenando por
      // `hora_registro` (con `id` como desempate estable) en vez de por
      // cursor.
      let offset = 0;
      let hayMas = true;

      while (hayMas) {
        let q = supabase
          .from("asistencias_diarias")
          .select("id, cedula_docente, nombre_docente, fecha, programa")
          .gte("fecha", inicio).lte("fecha", fin).eq("turno", turno)
          .order("hora_registro", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + RANGO_PAGE_SIZE - 1)
          .abortSignal(signal);
        if (programa) q = q.eq("programa", programa);

        const { data, error: err } = await q;
        // ARCH-4: si este fetch ya fue superado por uno más nuevo, descartar
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
          offset += RANGO_PAGE_SIZE;
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

  const handleBorrarRango = async () => {
    setBorrando(true);
    const { data: cantidad, error } = await supabase.rpc("admin_borrar_asistencias_rango", {
      p_fecha_desde: inicio,
      p_fecha_hasta: fin,
      p_turno:       turno || null,
      p_programa:    programa || null,
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
          <button onClick={() => exportarPDFRango(filtrados, inicio, fin, turno, diasHabiles)} disabled={filtrados.length === 0} className={`ra-btn ra-btn-pdf${filtrados.length === 0 ? ' ra-btn-pdf--disabled' : ''}`}>
            <i className="ti ti-printer ra-btn-icon" aria-hidden="true" />
            PDF
          </button>
          {permisos.puedeBorrarReportes && (
            <button
              onClick={() => setConfirmBorrar(true)}
              disabled={rows.length === 0}
              className={`ra-btn ra-btn--sm ra-btn-borrar-rango${rows.length === 0 ? ' ra-btn-borrar-rango--disabled' : ''}`}
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
            {TURNOS_CONFIG.filter(t => t.habilitado).map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
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

      {truncado && (
        <div className="ra-warn-banner" role="alert">
          <i className="ti ti-alert-triangle ra-warn-icon" aria-hidden="true" />
          <div>
            <strong>Resultado truncado.</strong> Se alcanzó el límite de {RANGO_MAX_FILAS.toLocaleString("es")} registros para este rango. Reduce el rango de fechas para ver todos los datos.
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
          mensaje={`Se borrarán ${rows.length} registro${rows.length !== 1 ? "s" : ""} de asistencia entre ${inicio} y ${fin}${turno ? ` (turno ${turno})` : ""}${programa ? `, programa ${programa.replace("PNF ", "")}` : ""}. Esta acción no se puede deshacer.`}
          onConfirm={borrando ? undefined : handleBorrarRango}
          onCancel={borrando ? undefined : () => setConfirmBorrar(false)}
          peligro
        />
      )}
    </div>
  );
}

export default ReporteRango;
