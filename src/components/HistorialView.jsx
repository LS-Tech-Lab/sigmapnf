import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  formatLapso, getSiguienteLapso, isValidLapso
} from "../utils/lapso";
import { fmt, duracion, StatusBadge } from "./historial/historialUtils";
import ModalTrimestre from "./historial/ModalTrimestre";
import ComparadorPanel from "./historial/ComparadorPanel";
import HistorialLista from "./historial/HistorialLista";
import { useSedeContext } from "../context/SedeContext";
// Fix SEC-38 (auditoría de estrés operacional, 10 de agosto): las 3
// concatenaciones de error.message de abajo bypasseaban el filtro de
// errorMessages.js.
import { mensajeAmigable } from "../utils/errorMessages";
import "./HistorialView.css";

// Fix ARCH-13 (auditoría 9 de julio): ModalTrimestre, ComparadorPanel,
// HistorialLista y las utilidades compartidas (fmt/duracion/StatusBadge)
// se extrajeron a src/components/historial/ — mismo patrón que ARCH-11
// (HorariosSidebar/HorariosTopbar). Este archivo mantiene TODO el estado,
// los efectos y los handlers; los subcomponentes son puramente
// presentacionales y reciben todo por props.

// ── Componente principal ──────────────────────────────────────────────────────

export default function HistorialView({ lapsoActivo, onCambiarLapso, showToast, user, modoConsulta = false, logAudit = null, programasRestringidos = [] }) {
  // SEDE-16: `trimestres` no tiene sede_id (decisión de negocio pendiente,
  // ver nota en 0061 -- los lapsos hoy son compartidos entre sedes), pero
  // las estadísticas que este archivo calcula a partir de `horarios` sí
  // deben acotarse a la sede activa: sin esto, un rol con
  // puedeVerTodasLasSedes veía "docentes"/"secciones"/"programas" de un
  // trimestre mezclando TODAS las sedes -- RLS (0063) deja pasar todas
  // para ese rol.
  const { sedeActiva } = useSedeContext();

  const [trimestres,     setTrimestres]     = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [expandido,      setExpandido]      = useState(null);
  const [detalles,       setDetalles]       = useState({});
  const [loadingDet,     setLoadingDet]     = useState(false);
  const [procesando,     setProcesando]     = useState(false);
  const [busqueda,       setBusqueda]       = useState("");
  const [tab,            setTab]            = useState("lista");
  const [modal,          setModal]          = useState(null);
  const [lapsoSiguiente, setLapsoSiguiente] = useState("");
  // ASIST-6: trimestre completo sobre el que se abrió el modal "editar"
  // (ModalTrimestre necesita la fila real para precargar los campos).
  const [trimestreEditando, setTrimestreEditando] = useState(null);

  const cargarTrimestres = useCallback(async () => {
    setLoading(true);
    // PERM-3 fix: si el usuario tiene restringe_programa, solo mostramos
    // trimestres que contengan horarios de su(s) programa(s). Para
    // usuarios sin restricción la query es idéntica a la original.
    // PROG-3 (fase 2): programasRestringidos es un array -- un
    // coordinador puede tener más de uno (0078/0079); .in() cubre tanto
    // el caso de uno solo como el de varios.
    let data, error;
    if (programasRestringidos.length > 0) {
      // Obtenemos los lapsos donde existe al menos un horario de sus programas
      let queryLapsos = supabase
        .from("horarios")
        .select("lapso")
        .in("programa", programasRestringidos);
      if (sedeActiva) queryLapsos = queryLapsos.eq("sede_id", sedeActiva);
      const { data: lapsos, error: errLapsos } = await queryLapsos;
      if (errLapsos) { showToast("Error al cargar historial: " + errLapsos.message, "error"); setLoading(false); return; }
      const lapsoSet = [...new Set((lapsos || []).map(h => h.lapso))];
      if (lapsoSet.length === 0) { setTrimestres([]); setLoading(false); return; }
      ({ data, error } = await supabase
        .from("trimestres")
        .select("*")
        .in("lapso", lapsoSet)
        .order("anio", { ascending: false })
        .order("numero", { ascending: false }));
    } else {
      ({ data, error } = await supabase
        .from("trimestres")
        .select("*")
        .order("anio", { ascending: false })
        .order("numero", { ascending: false }));
    }
    if (error) showToast("Error al cargar historial: " + mensajeAmigable(error), "error");
    else setTrimestres(data || []);
    setLoading(false);
  }, [showToast, programasRestringidos, sedeActiva]);

  useEffect(() => { cargarTrimestres(); }, [cargarTrimestres]);

  // SEDE-16: el caché de `detalles` es por lapso, no por sede -- si un
  // rol con puedeVerTodasLasSedes cambia de sede activa y vuelve a abrir
  // un lapso ya expandido antes, sin este reset vería el detalle
  // cacheado de la sede anterior en vez de refrescarlo.
  useEffect(() => { setDetalles({}); setExpandido(null); }, [sedeActiva]);

  const cargarDetalle = async (lapso) => {
    if (detalles[lapso]) { setExpandido(lapso); return; }
    setLoadingDet(true);
    // PERM-3 fix: si hay restricción de programa, el detalle también se filtra
    let query = supabase.from("horarios").select("programa, trayecto, sheet").eq("lapso", lapso);
    if (programasRestringidos.length > 0) query = query.in("programa", programasRestringidos);
    if (sedeActiva) query = query.eq("sede_id", sedeActiva);
    const { data: horarios } = await query;

    const meta = trimestres.find(t => t.lapso === lapso);

    if (horarios) {
      setDetalles(prev => ({
        ...prev,
        [lapso]: {
          total:      horarios.length,
          secciones:  new Set(horarios.map(h => h.sheet?.trim())).size,
          docentes:   new Set(horarios.map(h => h.trayecto)).size,
          materias:   0,
          programas:  [...new Set(horarios.map(h => h.programa).filter(Boolean))].sort(),
          trayectos:  [...new Set(horarios.map(h => h.trayecto).filter(Boolean))].sort(),
          fechaInicio: meta?.fecha_inicio,
          fechaFin:    meta?.fecha_fin,
        }
      }));
    }
    setExpandido(lapso);
    setLoadingDet(false);
  };

  const handleCerrar = async ({ lapso, fechaInicio, fechaFin, observacion }) => {
    setProcesando(true);
    const [num, anio] = lapso.split("-").map(Number);
    const { error } = await supabase.from("trimestres").upsert(
      {
        lapso, numero: num, anio,
        estado:       "cerrado",
        fecha_inicio: fechaInicio || null,
        fecha_fin:    fechaFin || null,
        notas:        observacion || null,
        cerrado_en:   new Date().toISOString(),
        cerrado_por:  user?.email,
      },
      { onConflict: "lapso" }
    );
    if (error) { showToast("Error al cerrar: " + mensajeAmigable(error), "error"); setProcesando(false); return; }
    showToast(`Trimestre ${formatLapso(lapso)} cerrado y archivado.`, "success");
    logAudit?.({ accion: "CERRAR_TRIMESTRE", entidad: "trimestres", lapso, resumen: `Trimestre cerrado: ${formatLapso(lapso)}` });
    setModal(null);
    await cargarTrimestres();
    setLapsoSiguiente(getSiguienteLapso(lapso));
    setTimeout(() => setModal("crear"), 300);
    setProcesando(false);
  };

  const handleCrear = async ({ lapso, fechaInicio, fechaFin, observacion }) => {
    if (!isValidLapso(lapso)) { showToast("Formato inválido (ej: 3-2026)", "error"); return; }
    const yaActivo = trimestres.find(t => t.lapso === lapso && t.estado === "activo");
    if (yaActivo) { showToast("Ese trimestre ya está activo.", "warning"); return; }
    setProcesando(true);
    const [num, anio] = lapso.split("-").map(Number);
    const { error } = await supabase.from("trimestres").upsert(
      {
        lapso, numero: num, anio,
        estado:       "activo",
        fecha_inicio:  fechaInicio || null,
        fecha_fin:     fechaFin    || null,
        notas:         observacion || null,
        creado_en:    new Date().toISOString(),
        creado_por:   user?.email,
      },
      { onConflict: "lapso" }
    );
    if (error) { showToast("Error al crear: " + mensajeAmigable(error), "error"); setProcesando(false); return; }
    showToast(`Trimestre ${formatLapso(lapso)} activado.`, "success");
    logAudit?.({ accion: "CREAR_TRIMESTRE", entidad: "trimestres", lapso, resumen: `Nuevo trimestre activado: ${formatLapso(lapso)}` });
    setModal(null);
    onCambiarLapso(lapso);
    await cargarTrimestres();
    setProcesando(false);
  };

  // ASIST-6 (pedido de LS, 12 ago): hasta ahora no había forma de
  // corregir fecha_inicio/fecha_fin de un trimestre ya activo sin pasar
  // por "Cerrar" (cambia estado a 'cerrado', no aplica) o "Nuevo
  // trimestre" (bloqueado si el lapso ya está activo -- ver handleCrear).
  // Upsert parcial: solo toca fecha_inicio/fecha_fin/notas -- estado,
  // creado_en/creado_por, cerrado_en/cerrado_por quedan intactos (mismo
  // comportamiento ya usado por handleCerrar, que tampoco reenvía
  // creado_en/creado_por y no los pisa).
  const handleEditarFechas = async ({ lapso, fechaInicio, fechaFin, observacion }) => {
    setProcesando(true);
    // numero/anio son NOT NULL sin default en `trimestres` -- Postgres
    // exige que la fila propuesta los satisfaga incluso cuando el
    // conflicto se resuelve como UPDATE (el ON CONFLICT no exime la
    // validación de la fila de INSERT construida). Se derivan del mismo
    // `lapso`, igual que ya hacen handleCerrar/handleCrear.
    const [num, anio] = lapso.split("-").map(Number);
    const { error } = await supabase.from("trimestres").upsert(
      {
        lapso, numero: num, anio,
        fecha_inicio: fechaInicio || null,
        fecha_fin:    fechaFin || null,
        notas:        observacion || null,
      },
      { onConflict: "lapso" }
    );
    if (error) { showToast("Error al editar fechas: " + mensajeAmigable(error), "error"); setProcesando(false); return; }
    showToast(`Fechas de ${formatLapso(lapso)} actualizadas.`, "success");
    logAudit?.({ accion: "EDITAR_FECHAS_TRIMESTRE", entidad: "trimestres", lapso, resumen: `Fechas corregidas: ${formatLapso(lapso)} (${fechaInicio} a ${fechaFin})` });
    setModal(null);
    setTrimestreEditando(null);
    await cargarTrimestres();
    setProcesando(false);
  };

  const filtrados = trimestres.filter(t =>
    !busqueda ||
    t.lapso.includes(busqueda) ||
    formatLapso(t.lapso).toLowerCase().includes(busqueda.toLowerCase())
  );

  const trimestreActual = trimestres.find(t => t.lapso === lapsoActivo);

  return (
    <>
      {modal === "cerrar" && (
        <ModalTrimestre
          modo="cerrar"
          lapsoSugerido={lapsoActivo}
          trimestre={trimestreActual}
          onConfirm={handleCerrar}
          onCancel={() => setModal(null)}
          loading={procesando}
        />
      )}
      {modal === "editar" && trimestreEditando && (
        <ModalTrimestre
          modo="editar"
          lapsoSugerido={trimestreEditando.lapso}
          trimestre={trimestreEditando}
          onConfirm={handleEditarFechas}
          onCancel={() => { setModal(null); setTrimestreEditando(null); }}
          loading={procesando}
        />
      )}
      {modal === "crear" && (
        <ModalTrimestre
          modo="crear"
          lapsoSugerido={lapsoSiguiente}
          onConfirm={handleCrear}
          onCancel={() => setModal(null)}
          loading={procesando}
        />
      )}

      <div className="hist-page">

        {/* Encabezado */}
        <div className="hist-header">
          <div>
            <h1 className="hist-header__title">Historial de Trimestres</h1>
            <p className="hist-header__subtitle">Gestión y consulta de todos los períodos académicos</p>
          </div>
          <div className="hist-header__actions">
            {!modoConsulta && (
              <>
                <button onClick={() => { setLapsoSiguiente(getSiguienteLapso(lapsoActivo)); setModal("crear"); }}
                  className="hist-btn hist-btn--primary">
                  <i className="ti ti-plus hist-btn__icon" aria-hidden="true" />
                  Nuevo trimestre
                </button>
                <button onClick={() => setModal("cerrar")}
                  className="hist-btn hist-btn--danger">
                  <i className="ti ti-lock hist-btn__icon" aria-hidden="true" />
                  Cerrar trimestre activo
                </button>
              </>
            )}
          </div>
        </div>

        {/* Trimestre activo */}
        <div className="hist-current">
          <div className="hist-current__row">
            <div>
              <div className="hist-current__eyebrow">Trimestre en curso</div>
              <div className="hist-current__lapso">{formatLapso(lapsoActivo)}</div>
              <div className="hist-current__meta">
                {trimestreActual?.fecha_inicio && (
                  <span className="hist-current__meta-item">
                    <i className="ti ti-calendar" aria-hidden="true" />
                    Inicio: <strong>{fmt(trimestreActual.fecha_inicio)}</strong>
                  </span>
                )}
                {trimestreActual?.fecha_fin && (
                  <span className="hist-current__meta-item">
                    <i className="ti ti-flag-finish" aria-hidden="true" />
                    Fin estimado: <strong>{fmt(trimestreActual.fecha_fin)}</strong>
                  </span>
                )}
                {trimestreActual?.fecha_inicio && trimestreActual?.fecha_fin && (
                  <span className="hist-current__meta-item hist-current__meta-item--accent">
                    <i className="ti ti-clock" aria-hidden="true" />
                    {duracion(trimestreActual.fecha_inicio, trimestreActual.fecha_fin)}
                  </span>
                )}
              </div>
              {trimestreActual?.notas && (
                <div className="hist-current__notes">
                  <i className="ti ti-notes hist-current__notes-icon" aria-hidden="true" />
                  {trimestreActual.notas}
                </div>
              )}
            </div>
            <StatusBadge estado={trimestreActual?.estado} />
          </div>
        </div>

        {/* Tabs */}
        <div className="hist-tabs">
          {[
            { id: "lista",    icon: "ti-list",        label: "Historial" },
            { id: "comparar", icon: "ti-chart-bar",   label: "Comparar trimestres" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`hist-tab ${tab === t.id ? "hist-tab--active" : ""}`}>
              <i className={`ti ${t.icon}`} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB: LISTA ── */}
        {tab === "lista" && (
          <HistorialLista
            busqueda={busqueda} setBusqueda={setBusqueda}
            loading={loading}
            filtrados={filtrados}
            expandido={expandido} setExpandido={setExpandido}
            detalles={detalles}
            loadingDet={loadingDet}
            lapsoActivo={lapsoActivo}
            cargarDetalle={cargarDetalle}
            onCambiarLapso={onCambiarLapso}
            onEditarFechas={(t) => { setTrimestreEditando(t); setModal("editar"); }}
            modoConsulta={modoConsulta}
          />
        )}

        {/* ── TAB: COMPARAR ── */}
        {tab === "comparar" && (
          <div className="hist-card hist-comp-card">
            <ComparadorPanel trimestres={trimestres} detalles={detalles} />
            {Object.keys(detalles).length === 0 && trimestres.filter(t => t.estado !== "activo").length >= 2 && (
              <p className="hist-comp-footer-hint">
                <i className="ti ti-info-circle" aria-hidden="true" />
                Expande los trimestres en la pestaña Historial para cargar sus estadísticas y poder comparar.
              </p>
            )}
          </div>
        )}

      </div>
    </>
  );
}
