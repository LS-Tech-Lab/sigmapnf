/**
 * Reporte de Asistencias — vista diaria.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../../../lib/supabase";
import { DEFAULT_PROGRAMAS, TURNOS_CONFIG } from "../../../constants";
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
import { useReporteConfig } from "../../../hooks/useReporteConfig";
import { useSedeContext } from "../../../context/SedeContext";
// Fix UX-55 (auditoría 16 ago): setError(err.message) mostraba error crudo.
import { mensajeAmigable } from "../../../utils/errorMessages";
import useTrimestreActivo from "../../../hooks/useTrimestreActivo";
import { formatLapso, lapsoParaFecha } from "../../../utils/lapso";
import "./index.css";

export default function ReporteAsistencias({ onVolverPanel, permisos = {}, showToast }) {
  // SEDE-16: esta vista (y VistaAusentes/AlertaSinVincular/exportarCSV, que
  // cuelgan de acá) nunca leía sedeActiva -- un rol con puedeVerTodasLasSedes
  // veía el Reporte diario mezclando asistencias/horarios/docentes de TODAS
  // las sedes, sin importar la sede elegida en el selector. RLS (0063/0064)
  // deja pasar todas las sedes para ese rol; el filtro por sede activa tiene
  // que venir del cliente, mismo patrón que el resto del módulo.
  const { sedeActiva } = useSedeContext();
  const hoy = fechaHoyVE();
  const [vistaRango, setVistaRango] = useState(false);
  const [fecha,    setFecha]    = useState(hoy);
  const [turno,    setTurno]    = useState("DIURNO");
  // PROG-3 (fase 2): este selector no revisaba permisos.puedeVerSoloSuPrograma
  // en absoluto -- cualquier usuario, restringido o no, podía elegir
  // cualquier programa del dropdown. misProgramas es la lista real de un
  // usuario restringido (0078/0079); el valor inicial y el clamp de abajo
  // lo fuerzan a quedarse dentro de su propio conjunto.
  const misProgramas = permisos.puedeVerSoloSuPrograma ? (permisos.programasRestringidos || []) : [];
  const [programa, setPrograma] = useState(misProgramas[0] || "");
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [tab,      setTab]      = useState("presentes");
  const [ausentesParaPDF, setAusentesParaPDF] = useState([]);
  const [modoOffline,     setModoOffline]     = useState(false);
  const [fechaCache,      setFechaCache]      = useState(null);
  // ADMIN-6: config de branding para el membrete del PDF (logo, textos,
  // color institucional) — carga con fallback seguro a los valores por
  // defecto, ver useReporteConfig.js.
  const { config: reporteConfig } = useReporteConfig();

  // ASIST-4: selector de trimestre para esta vista de un solo día -- al
  // elegir un trimestre, `fecha` salta a su fecha_inicio (o a hoy si es
  // el trimestre activo y hoy cae dentro de su rango) y el input queda
  // acotado (min/max) a ese trimestre, para no tener que adivinar qué
  // fechas pertenecen a cuál. Sigue siendo de solo consulta -- no hay
  // flujo de edición de asistencias_diarias (confirmado en ARCH-44).
  const { trimestres, trimestreActivo, cargando: cargandoTrimestres } = useTrimestreActivo();
  const [trimestreFiltro, setTrimestreFiltro] = useState("");

  const trimestreFiltroInfo = trimestres.find(t => t.lapso === trimestreFiltro) || null;

  // BUG (ausentes-trimestre-cerrado): el `lapso` real que cubre `fecha`,
  // usado para que VistaAusentes filtre `horarios` por trimestre en vez
  // de mezclar el vigente con uno ya cerrado. Si el usuario ya eligió un
  // trimestre explícito en el selector, se usa ese directamente (fecha
  // fue sincronizada a su rango en handleTrimestreFiltro); si no, se
  // resuelve por rango de fechas contra `trimestres`.
  const lapsoDeFecha = trimestreFiltro || lapsoParaFecha(fecha, trimestres);

  const handleTrimestreFiltro = (lapsoElegido) => {
    setTrimestreFiltro(lapsoElegido);
    if (!lapsoElegido) return;
    const info = trimestres.find(t => t.lapso === lapsoElegido);
    if (!info?.fecha_inicio || !info?.fecha_fin) return;
    const dentroDeHoy = hoy >= info.fecha_inicio && hoy <= info.fecha_fin;
    setFecha(dentroDeHoy ? hoy : info.fecha_inicio);
  };

  // PROG-3 (fase 2): clamp defensivo, mismo criterio que App.jsx/
  // PlanillaQR.jsx -- si `programa` queda fuera del conjunto permitido
  // (primer render antes de que lleguen permisos, o un cambio de rol en
  // caliente), se corrige antes de que la query se dispare.
  useEffect(() => {
    if (misProgramas.length > 0 && !misProgramas.includes(programa)) {
      setPrograma(misProgramas[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permisos.puedeVerSoloSuPrograma, JSON.stringify(misProgramas)]);

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
    if (sedeActiva) query = query.eq("sede_id", sedeActiva);

    const { data, error: err } = await query;
    if (err) {
      // Fetch falló con red — intentar IDB como fallback
      const cached = await cargarReporteDeIDB(fecha, turno, programa);
      if (cached) {
        setRows(cached.datos);
        setModoOffline(true);
        setFechaCache(cached.guardadoEn);
      } else {
        setError(mensajeAmigable(err));
        setRows([]);
      }
    } else {
      const resultado = data || [];
      setRows(resultado);
      // Guardar en IDB para uso offline posterior
      await guardarReporteEnIDB(fecha, turno, programa, resultado);
    }
    if (!silent) setLoading(false);
  }, [fecha, turno, programa, sedeActiva]);

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

  // ARCH-28 (auditoría 1 ago): antes se recalculaba en cada render (ej. al
  // cambiar de pestaña Presentes/Ausentes) aunque docentesAgrupados/busqueda
  // no hubieran cambiado. Memoizado con las mismas dependencias reales.
  const filtrados = useMemo(() => docentesAgrupados.filter(d => {
    if (!busqueda) return true;
    const q = busqueda.toLowerCase();
    return d.cedula?.toLowerCase().includes(q) || d.nombre?.toLowerCase().includes(q);
  }), [docentesAgrupados, busqueda]);

  const cedulasPresentes = useMemo(
    () => new Set(docentesAgrupados.map(d => d.cedula)),
    [docentesAgrupados]
  );

  const totalDocentes = docentesAgrupados.length;
  const conSalida     = docentesAgrupados.filter(d => d.estado === "completo").length;
  const soloEntrada   = docentesAgrupados.filter(d => d.estado === "solo_entrada").length;

  const primerRegistro = rows.length > 0 ? rows[0].hora_registro : null;
  const ultimoRegistro = rows.length > 0 ? rows[rows.length - 1].hora_registro : null;

  if (vistaRango) return (
    <ReporteRango
      onVolverDiario={() => setVistaRango(false)}
      permisos={permisos}
      showToast={showToast}
    />
  );

  return (
    <div className="ra-root">
      {/* Cabecera */}
      <div className="ra-header">
        <div>
          <h1 className="ra-title">
            <i className="ti ti-clipboard-list ra-title-icon" aria-hidden="true" />
            Reporte de Asistencias
          </h1>
          <p className="ra-subtitle">Registro diario de presencia docente</p>
        </div>
        <div className="ra-header-actions">
          {onVolverPanel && (
            <button onClick={onVolverPanel} className="ra-btn ra-btn-volver">
              <i className="ti ti-arrow-left ra-btn-icon" aria-hidden="true" />
              Volver al panel QR
            </button>
          )}
          <button onClick={() => setVistaRango(true)} className="ra-btn ra-btn-rango">
            <i className="ti ti-calendar-stats ra-btn-icon" aria-hidden="true" />
            Vista semanal / rango
          </button>
          <button
            onClick={() => exportarPDFDiario(filtrados, fecha, turno, programa, ausentesParaPDF, reporteConfig)}
            disabled={filtrados.length === 0}
            className={`ra-btn ra-btn-pdf${filtrados.length === 0 ? ' ra-btn-pdf--disabled' : ''}`}
          >
            <i className="ti ti-printer ra-btn-icon" aria-hidden="true" />
            PDF
          </button>
          <button
            onClick={() => exportarCSV(filtrados, fecha, turno, sedeActiva)}
            disabled={filtrados.length === 0}
            className={`ra-btn ra-btn-csv${filtrados.length === 0 ? ' ra-btn-csv--disabled' : ''}`}
          >
            <i className="ti ti-download ra-btn-icon" aria-hidden="true" />
            CSV
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="ra-filtros">
        {!cargandoTrimestres && trimestres.length > 0 && (
          <label className="ra-filtro-label">
            <span className="ra-filtro-label-text">Trimestre</span>
            <select
              value={trimestreFiltro}
              onChange={e => handleTrimestreFiltro(e.target.value)}
              className="s-select"
            >
              <option value="">Cualquier fecha</option>
              {trimestres.map(t => (
                <option key={t.lapso} value={t.lapso}>
                  {formatLapso(t.lapso)}{t.lapso === trimestreActivo ? " (actual)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="ra-filtro-label">
          <span className="ra-filtro-label-text">Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            min={trimestreFiltroInfo?.fecha_inicio || undefined}
            max={trimestreFiltroInfo?.fecha_fin || undefined}
            className="s-input ra-input-date"
          />
        </label>
        <label className="ra-filtro-label">
          <span className="ra-filtro-label-text">Turno</span>
          <select value={turno} onChange={e => setTurno(e.target.value)} className="s-select">
            {TURNOS_FILTRO.map(t => (
              <option key={t} value={t}>
                {/* Fix (caso PNF Agroalimentación, turno MIXTO): antes era
                    un ternario DIURNO/VESPERTINO/(cualquier otra cosa) —
                    "cualquier otra cosa" incluía a MIXTO, que se mostraba
                    como "Todos los turnos", duplicando literalmente el
                    texto de la opción "TODOS" real. Ahora el label sale de
                    TURNOS_CONFIG (misma fuente que TURNOS_FILTRO). */}
                {t === "TODOS" ? "Todos los turnos" : (TURNOS_CONFIG.find(c => c.id === t)?.label || t)}
              </option>
            ))}
          </select>
        </label>
        <label className="ra-filtro-label">
          <span className="ra-filtro-label-text">Programa</span>
          <select
            value={programa}
            onChange={e => (!permisos.puedeVerSoloSuPrograma || misProgramas.length > 1) && setPrograma(e.target.value)}
            disabled={permisos.puedeVerSoloSuPrograma && misProgramas.length <= 1}
            className="s-select"
          >
            {/* PROG-3 (fase 2): "Todos" solo para quien no tiene
                restricción de programa. */}
            {!permisos.puedeVerSoloSuPrograma && <option value="">Todos</option>}
            {(permisos.puedeVerSoloSuPrograma ? misProgramas : DEFAULT_PROGRAMAS).map(p => (
              <option key={p} value={p}>{p.replace("PNF ", "")}</option>
            ))}
          </select>
        </label>
        <label className="ra-filtro-label ra-filtro-label--grow">
          <span className="ra-filtro-label-text">Buscar</span>
          <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre o cédula…" className="s-input" />
        </label>
      </div>

      {/* Estadísticas */}
      <div className="ra-stats-grid">
        {[
          { label: "Docentes presentes", value: totalDocentes, variant: "presentes" },
          { label: "Entrada y salida",   value: conSalida,     variant: "entrada-salida" },
          { label: "Solo entrada",       value: soloEntrada,   variant: "solo-entrada" },
          {
            label: "Primer registro",
            value: primerRegistro
              ? new Date(primerRegistro).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
              : "—",
            variant: "primer",
          },
          {
            label: "Último registro",
            value: ultimoRegistro
              ? new Date(ultimoRegistro).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
              : "—",
            variant: "ultimo",
          },
        ].map(stat => (
          <div key={stat.label} className={`ra-stat-card ra-stat-card--${stat.variant}`}>
            <div className={`ra-stat-value ra-stat-value--${stat.variant}`}>{stat.value}</div>
            <div className="ra-stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Pestañas */}
      <div className="ra-tabs">
        {[
          { id: "presentes", label: `Presentes (${totalDocentes})`, icon: "ti-circle-check" },
          { id: "ausentes",  label: "Ausentes",                     icon: "ti-circle-x"    },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`ra-tab-btn${tab === t.id ? ' ra-tab-btn--active' : ''}`}
          >
            <i className={`ti ${t.icon} ra-tab-icon`} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      <AlertaSinVincular cedulasPresentes={cedulasPresentes} loading={loading} sedeActiva={sedeActiva} />

      {modoOffline && (
        <div className="ra-offline-banner">
          <i className="ti ti-wifi-off ra-offline-icon" aria-hidden="true" />
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
        <div className="ra-error-banner">
          <i className="ti ti-alert-triangle ra-error-icon" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Vista Presentes */}
      {tab === "presentes" && (
        <div className="s-card ra-table-wrap">
          <table className="ra-table ra-table--fecha">
            <thead>
              <tr>
                {["Cédula", "Nombre docente", "Estado", "Entrada", "Salida", "Programa"].map(h => (
                  <th key={h} className="s-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={6} />)
                : filtrados.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="s-td ra-td-empty-msg">
                        {busqueda
                          ? "No se encontraron docentes con ese nombre o cédula."
                          : "No hay asistencias registradas para esta fecha y turno."}
                      </td>
                    </tr>
                  )
                  : filtrados.map((d) => (
                    <tr key={d.cedula}>
                      <td className="s-td ra-td-cedula">
                        {d.cedula}
                      </td>
                      <td className="s-td ra-td-nombre">
                        {d.nombre || <span className="ra-td-dash">—</span>}
                      </td>
                      <td className="s-td">
                        <EstadoChip estado={d.estado} />
                      </td>
                      <td className="s-td ra-td-hora">
                        {d.horaEntrada
                          ? new Date(d.horaEntrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
                          : <span className="ra-td-dash--light">—</span>}
                      </td>
                      <td className="s-td ra-td-hora">
                        {d.horaSalida
                          ? new Date(d.horaSalida).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
                          : <span className="ra-td-dash--light">—</span>}
                      </td>
                      <td className="s-td ra-td-programa">
                        {d.programa?.replace("PNF ", "") || "—"}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
          {!loading && filtrados.length > 0 && (
            <div className="ra-table-footer">
              {filtrados.length} docente{filtrados.length !== 1 ? "s" : ""} · Actualización en tiempo real
            </div>
          )}
        </div>
      )}

      {/* Vista Ausentes */}
      {tab === "ausentes" && (
        <VistaAusentes fecha={fecha} programa={programa} cedulasPresentes={cedulasPresentes} onAusentesChange={setAusentesParaPDF} sedeActiva={sedeActiva} lapso={lapsoDeFecha} />
      )}
    </div>
  );
}
