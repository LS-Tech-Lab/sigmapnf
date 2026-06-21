import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  formatLapso, compareLapsos, getSiguienteLapso,
  getCurrentLapso, isValidLapso
} from "../utils/lapso";
import { S } from "../constants";

// ── Utilidades ────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" });
}

function duracion(inicio, fin) {
  if (!inicio || !fin) return null;
  const dias = Math.round((new Date(fin) - new Date(inicio)) / 86400000);
  if (dias < 7) return `${dias} días`;
  const sem = Math.round(dias / 7);
  return `${sem} semana${sem !== 1 ? "s" : ""}`;
}

function StatusBadge({ estado }) {
  const cfg = {
    activo:    { bg: "#DCFCE7", col: "#166534", label: "Activo"    },
    cerrado:   { bg: "#F1F5F9", col: "#475569", label: "Cerrado"   },
    archivado: { bg: "#EFF6FF", col: "#1E40AF", label: "Archivado" },
  };
  const c = cfg[estado] || cfg.cerrado;
  return <span style={{ ...S.badge(c.bg, c.col), fontSize: 11 }}>{c.label}</span>;
}

// ── Modal de cierre / creación de trimestre ───────────────────────────────────

function ModalTrimestre({ modo, lapsoSugerido, onConfirm, onCancel, loading }) {
  const esCrear = modo === "crear";
  const [lapso,       setLapso]       = useState(lapsoSugerido || "");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin,    setFechaFin]    = useState("");
  const [observacion, setObservacion] = useState("");

  useEffect(() => {
    if (!esCrear) setFechaFin(new Date().toISOString().slice(0, 10));
  }, [esCrear]);

  const valido = esCrear
    ? isValidLapso(lapso) && fechaInicio?.trim()
    : fechaFin?.trim();

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: 24,
    }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 460, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>

        <div style={{ marginBottom: 8 }}>
          <i className={`ti ${esCrear ? "ti-school" : "ti-lock"}`}
             style={{ fontSize: 28, color: esCrear ? "#2563EB" : "#DC2626" }} aria-hidden="true" />
        </div>
        <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 700, color: "#0F172A" }}>
          {esCrear ? "Activar nuevo trimestre" : `Cerrar trimestre ${formatLapso(lapsoSugerido)}`}
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>
          {esCrear
            ? "Completa los datos del nuevo período académico."
            : "El trimestre pasará al historial como solo lectura. Completa la información antes de cerrar."}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {esCrear && (
            <div>
              <label style={labelStyle}>Código del trimestre *</label>
              <input value={lapso} onChange={e => setLapso(e.target.value)}
                placeholder="ej: 3-2026"
                style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
              <span style={hintStyle}>Formato: [número]-[año] → 1-2027, 2-2027, 3-2027…</span>
            </div>
          )}

          <div>
            <label style={labelStyle}>{esCrear ? "Fecha de inicio *" : "Fecha de inicio"}</label>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
              style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
          </div>

          <div>
            <label style={labelStyle}>{esCrear ? "Fecha estimada de culminación" : "Fecha de culminación *"}</label>
            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
              style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
            {fechaInicio && fechaFin && (
              <span style={{ ...hintStyle, color: "#3B82F6" }}>
                Duración: {duracion(fechaInicio, fechaFin)}
              </span>
            )}
          </div>

          <div>
            <label style={labelStyle}>Observaciones {esCrear ? "" : "(opcional)"}</label>
            <textarea value={observacion} onChange={e => setObservacion(e.target.value)}
              placeholder={esCrear
                ? "Notas sobre este período, sede, modalidad, etc."
                : "Ej: Trimestre extendido por paro nacional, actividades suspendidas en semana 8…"}
              rows={3}
              style={{ ...S.input, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #E5E7EB", background: "#F8FAFC", color: "#475569", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            Cancelar
          </button>
          <button
            onClick={() => onConfirm({ lapso: esCrear ? lapso : lapsoSugerido, fechaInicio, fechaFin, observacion })}
            disabled={!valido || loading}
            style={{ flex: 2, padding: "10px 0", borderRadius: 8, border: "none",
              background: valido ? (esCrear ? "#2563EB" : "#DC2626") : "#E5E7EB",
              color: valido ? "#fff" : "#94A3B8",
              cursor: valido ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {loading ? "Procesando…" : (
              <>
                <i className={`ti ${esCrear ? "ti-circle-check" : "ti-lock"}`}
                   style={{ fontSize: 15 }} aria-hidden="true" />
                {esCrear ? `Activar ${lapso || "…"}` : "Confirmar cierre"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 5 };
const hintStyle  = { fontSize: 11, color: "#94A3B8", marginTop: 4, display: "block" };

// ── Panel de comparación entre trimestres ─────────────────────────────────────

function ComparadorPanel({ trimestres, detalles }) {
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");

  const cerrados = trimestres.filter(t => t.estado !== "activo");

  useEffect(() => {
    if (cerrados.length >= 2 && !selA) setSelA(cerrados[0].lapso);
    if (cerrados.length >= 2 && !selB) setSelB(cerrados[1]?.lapso || "");
  }, [cerrados.length]);

  const dA = detalles[selA];
  const dB = detalles[selB];

  const metrics = [
    { key: "total",     label: "Clases",    color: "#60A5FA" },
    { key: "secciones", label: "Secciones", color: "#34D399" },
    { key: "docentes",  label: "Docentes",  color: "#A78BFA" },
    { key: "materias",  label: "Materias",  color: "#FBBF24" },
  ];

  if (cerrados.length < 2) return (
    <div style={{ textAlign: "center", padding: "32px 0", color: "#94A3B8", fontSize: 13 }}>
      Necesitas al menos 2 trimestres cerrados para comparar.
    </div>
  );

  return (
    <div>
      {/* Selectores */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[{ val: selA, set: setSelA, label: "Trimestre A", color: "#3B82F6" },
          { val: selB, set: setSelB, label: "Trimestre B", color: "#8B5CF6" }].map(({ val, set, label, color }) => (
          <div key={label}>
            <label style={{ ...labelStyle, color }}>{label}</label>
            <select value={val} onChange={e => set(e.target.value)}
              style={{ ...S.select, width: "100%", borderColor: color }}>
              <option value="">— seleccionar —</option>
              {cerrados.map(t => (
                <option key={t.lapso} value={t.lapso}>{formatLapso(t.lapso)}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {selA && selB && selA !== selB ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "#E5E7EB", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
            <div style={thComp("#F9FAFB", "#475569")}>Métrica</div>
            <div style={thComp("#EFF6FF", "#1D4ED8")}>{formatLapso(selA)}</div>
            <div style={thComp("#F5F3FF", "#6D28D9")}>{formatLapso(selB)}</div>

            {metrics.map(m => {
              const va = dA?.[m.key] ?? "…";
              const vb = dB?.[m.key] ?? "…";
              const diff = (typeof va === "number" && typeof vb === "number") ? vb - va : null;
              return (
                <React.Fragment key={m.key}>
                  <div style={tdComp("#fff")}><span style={{ color: m.color, fontWeight: 700 }}>●</span> {m.label}</div>
                  <div style={tdComp("#EFF6FF", true)}>{va}</div>
                  <div style={{ ...tdComp("#F5F3FF", true), display: "flex", alignItems: "center", gap: 6 }}>
                    {vb}
                    {diff !== null && diff !== 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: diff > 0 ? "#16A34A" : "#DC2626" }}>
                        {diff > 0 ? `▲ +${diff}` : `▼ ${diff}`}
                      </span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}

            {/* Duración */}
            <div style={tdComp("#fff")}>
              <i className="ti ti-clock" style={{ fontSize: 12, marginRight: 4, color: "#64748B" }} aria-hidden="true" />
              Duración
            </div>
            <div style={tdComp("#EFF6FF", true)}>{dA ? duracion(dA.fechaInicio, dA.fechaFin) || "—" : "…"}</div>
            <div style={tdComp("#F5F3FF", true)}>{dB ? duracion(dB.fechaInicio, dB.fechaFin) || "—" : "…"}</div>
          </div>

          {dA?.programas && dB?.programas && (() => {
            const setA = new Set(dA.programas);
            const setB = new Set(dB.programas);
            const comunes  = dA.programas.filter(p => setB.has(p));
            const soloEnA  = dA.programas.filter(p => !setB.has(p));
            const soloEnB  = dB.programas.filter(p => !setA.has(p));
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 4 }}>
                {[
                  { label: "En ambos", items: comunes, bg: "#F0FDF4", col: "#166534" },
                  { label: `Solo en ${formatLapso(selA)}`, items: soloEnA, bg: "#EFF6FF", col: "#1D4ED8" },
                  { label: `Solo en ${formatLapso(selB)}`, items: soloEnB, bg: "#F5F3FF", col: "#6D28D9" },
                ].map(({ label, items, bg, col }) => (
                  <div key={label} style={{ background: bg, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: col, marginBottom: 6, textTransform: "uppercase" }}>{label}</div>
                    {items.length === 0
                      ? <div style={{ fontSize: 11, color: "#94A3B8" }}>Ninguno</div>
                      : items.map(p => <div key={p} style={{ fontSize: 11, color: col, marginBottom: 2 }}>• {p}</div>)
                    }
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      ) : (
        <div style={{ textAlign: "center", padding: 24, color: "#94A3B8", fontSize: 13 }}>
          Selecciona dos trimestres diferentes para ver la comparación.
        </div>
      )}
    </div>
  );
}

const thComp = (bg, col) => ({ background: bg, padding: "10px 14px", fontSize: 11, fontWeight: 700, color: col, textTransform: "uppercase", letterSpacing: "0.05em" });
const tdComp = (bg, center = false) => ({ background: bg, padding: "10px 14px", fontSize: 13, fontWeight: center ? 700 : 400, color: "#475569", textAlign: center ? "center" : "left" });

// ── Componente principal ──────────────────────────────────────────────────────

export default function HistorialView({ lapsoActivo, onCambiarLapso, showToast, openConfirm, closeConfirm, user, modoConsulta = false, logAudit = null }) {
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

  const cargarTrimestres = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("trimestres")
      .select("*")
      .order("anio", { ascending: false })
      .order("numero", { ascending: false });
    if (error) showToast("❌ Error al cargar historial: " + error.message, "error");
    else setTrimestres(data || []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { cargarTrimestres(); }, [cargarTrimestres]);

  const cargarDetalle = async (lapso) => {
    if (detalles[lapso]) { setExpandido(lapso); return; }
    setLoadingDet(true);
    const { data: horarios } = await supabase
      .from("horarios")
      .select("programa, trayecto, sheet")
      .eq("lapso", lapso);

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
    if (error) { showToast("❌ Error al cerrar: " + error.message, "error"); setProcesando(false); return; }
    showToast(`✅ Trimestre ${formatLapso(lapso)} cerrado y archivado.`, "success");
    logAudit?.({ accion: "CERRAR_TRIMESTRE", entidad: "trimestres", lapso, resumen: `Trimestre cerrado: ${formatLapso(lapso)}` });
    setModal(null);
    await cargarTrimestres();
    setLapsoSiguiente(getSiguienteLapso(lapso));
    setTimeout(() => setModal("crear"), 300);
    setProcesando(false);
  };

  const handleCrear = async ({ lapso, fechaInicio, fechaFin, observacion }) => {
    if (!isValidLapso(lapso)) { showToast("❌ Formato inválido (ej: 3-2026)", "error"); return; }
    const yaActivo = trimestres.find(t => t.lapso === lapso && t.estado === "activo");
    if (yaActivo) { showToast("⚠️ Ese trimestre ya está activo.", "warning"); return; }
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
    if (error) { showToast("❌ Error al crear: " + error.message, "error"); setProcesando(false); return; }
    showToast(`✅ Trimestre ${formatLapso(lapso)} activado.`, "success");
    logAudit?.({ accion: "CREAR_TRIMESTRE", entidad: "trimestres", lapso, resumen: `Nuevo trimestre activado: ${formatLapso(lapso)}` });
    setModal(null);
    onCambiarLapso(lapso);
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
          onConfirm={handleCerrar}
          onCancel={() => setModal(null)}
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

      <div style={{ padding: "24px 28px", maxWidth: 900, margin: "0 auto" }}>

        {/* Encabezado */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A" }}>Historial de Trimestres</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748B" }}>Gestión y consulta de todos los períodos académicos</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!modoConsulta && (
              <>
                <button onClick={() => { setLapsoSiguiente(getSiguienteLapso(lapsoActivo)); setModal("crear"); }}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563EB", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
                    display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="ti ti-plus" style={{ fontSize: 14 }} aria-hidden="true" />
                  Nuevo trimestre
                </button>
                <button onClick={() => setModal("cerrar")}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #FECACA", background: "#FFF5F5", color: "#DC2626", cursor: "pointer", fontSize: 13, fontWeight: 600,
                    display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="ti ti-lock" style={{ fontSize: 14 }} aria-hidden="true" />
                  Cerrar trimestre activo
                </button>
              </>
            )}
          </div>
        </div>

        {/* Trimestre activo */}
        <div style={{ background: "linear-gradient(135deg,#EFF6FF,#F5F3FF)", border: "1.5px solid #BFDBFE", borderRadius: 12, padding: "18px 22px", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#3B82F6", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Trimestre en curso</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#1E40AF" }}>{formatLapso(lapsoActivo)}</div>
              <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                {trimestreActual?.fecha_inicio && (
                  <span style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-calendar" style={{ fontSize: 13 }} aria-hidden="true" />
                    Inicio: <strong>{fmt(trimestreActual.fecha_inicio)}</strong>
                  </span>
                )}
                {trimestreActual?.fecha_fin && (
                  <span style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-flag-finish" style={{ fontSize: 13 }} aria-hidden="true" />
                    Fin estimado: <strong>{fmt(trimestreActual.fecha_fin)}</strong>
                  </span>
                )}
                {trimestreActual?.fecha_inicio && trimestreActual?.fecha_fin && (
                  <span style={{ fontSize: 12, color: "#3B82F6", display: "flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-clock" style={{ fontSize: 13 }} aria-hidden="true" />
                    {duracion(trimestreActual.fecha_inicio, trimestreActual.fecha_fin)}
                  </span>
                )}
              </div>
              {trimestreActual?.notas && (
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 6, fontStyle: "italic", display: "flex", alignItems: "flex-start", gap: 4 }}>
                  <i className="ti ti-notes" style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                  {trimestreActual.notas}
                </div>
              )}
            </div>
            <StatusBadge estado="activo" />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #E5E7EB", paddingBottom: 0 }}>
          {[
            { id: "lista",    icon: "ti-list",        label: "Historial" },
            { id: "comparar", icon: "ti-chart-bar",   label: "Comparar trimestres" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "8px 18px", border: "none", background: "none", cursor: "pointer",
                fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
                color: tab === t.id ? "#2563EB" : "#64748B",
                borderBottom: tab === t.id ? "2px solid #2563EB" : "2px solid transparent",
                marginBottom: -2, display: "flex", alignItems: "center", gap: 6,
              }}>
              <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB: LISTA ── */}
        {tab === "lista" && (
          <>
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar trimestre… (ej: 2026, 1-2025)"
              style={{ ...S.input, width: "100%", boxSizing: "border-box", marginBottom: 16 }} />

            {loading ? (
              <div style={{ textAlign: "center", padding: 48, color: "#94A3B8", fontSize: 14 }}>Cargando historial…</div>
            ) : filtrados.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48 }}>
                <i className="ti ti-folder-open" style={{ fontSize: 32, color: "#CBD5E1", display: "block", marginBottom: 12 }} aria-hidden="true" />
                <div style={{ fontSize: 14, color: "#64748B" }}>
                  {busqueda ? "No se encontraron trimestres." : "No hay trimestres en el historial aún."}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filtrados.map(t => {
                  const isOpen = expandido === t.lapso;
                  const d = detalles[t.lapso];
                  const esCurrent = t.lapso === lapsoActivo;
                  return (
                    <div key={t.lapso} style={{ ...S.card, border: esCurrent ? "1.5px solid #3B82F6" : "1px solid #E5E7EB", borderRadius: 10 }}>

                      {/* Cabecera */}
                      <div onClick={() => isOpen ? setExpandido(null) : cargarDetalle(t.lapso)}
                        style={{ display: "flex", alignItems: "center", padding: "14px 18px", cursor: "pointer", gap: 12, userSelect: "none" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>{formatLapso(t.lapso)}</div>
                          <div style={{ display: "flex", gap: 14, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                            {t.fecha_inicio && (
                              <span style={{ fontSize: 11, color: "#64748B", display: "flex", alignItems: "center", gap: 3 }}>
                                <i className="ti ti-calendar" style={{ fontSize: 11 }} aria-hidden="true" />
                                {fmt(t.fecha_inicio)}
                              </span>
                            )}
                            {t.fecha_fin && (
                              <span style={{ fontSize: 11, color: "#64748B" }}>→ {fmt(t.fecha_fin)}</span>
                            )}
                            {t.fecha_inicio && t.fecha_fin && (
                              <span style={{ fontSize: 11, color: "#94A3B8" }}>({duracion(t.fecha_inicio, t.fecha_fin)})</span>
                            )}
                            {t.cerrado_por && (
                              <span style={{ fontSize: 11, color: "#94A3B8" }}>Cerrado por {t.cerrado_por}</span>
                            )}
                          </div>
                        </div>
                        <StatusBadge estado={t.estado} />
                        <i className={`ti ${isOpen ? "ti-chevron-up" : "ti-chevron-down"}`}
                           style={{ color: "#94A3B8", fontSize: 14 }} aria-hidden="true" />
                      </div>

                      {/* Detalle expandible */}
                      {isOpen && (
                        <div style={{ borderTop: "1px solid #F1F5F9", padding: "16px 18px" }}>

                          {t.notas && (
                            <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#92400E",
                              display: "flex", alignItems: "flex-start", gap: 6 }}>
                              <i className="ti ti-notes" style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                              {t.notas}
                            </div>
                          )}

                          {loadingDet && !d ? (
                            <div style={{ color: "#94A3B8", fontSize: 13 }}>Cargando estadísticas…</div>
                          ) : d ? (
                            <>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 14 }}>
                                {[
                                  { label: "Clases",    val: d.total,     color: "#60A5FA" },
                                  { label: "Secciones", val: d.secciones, color: "#34D399" },
                                ].map(s => (
                                  <div key={s.label} style={{ background: "#F8FAFC", borderRadius: 8, padding: "10px 14px" }}>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
                                    <div style={{ fontSize: 11, color: "#64748B" }}>{s.label}</div>
                                  </div>
                                ))}
                              </div>

                              {d.programas?.length > 0 && (
                                <div style={{ marginBottom: 12 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Programas</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {d.programas.map(p => (
                                      <span key={p} style={S.badge("#F0FDF4", "#166534")}>{p}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {d.trayectos?.length > 0 && (
                                <div style={{ marginBottom: 14 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Trayectos</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {d.trayectos.map(t2 => (
                                      <span key={t2} style={S.badge("#EFF6FF", "#1D4ED8")}>{t2}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {!esCurrent && (
                                <button onClick={() => onCambiarLapso(t.lapso)}
                                  style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #BFDBFE", background: "#EFF6FF", color: "#1D4ED8", cursor: "pointer", fontSize: 12, fontWeight: 600,
                                    display: "flex", alignItems: "center", gap: 6 }}>
                                  <i className="ti ti-eye" style={{ fontSize: 13 }} aria-hidden="true" />
                                  Consultar horarios de este trimestre
                                </button>
                              )}
                            </>
                          ) : (
                            <div style={{ color: "#94A3B8", fontSize: 13 }}>Sin datos cargados para este trimestre.</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── TAB: COMPARAR ── */}
        {tab === "comparar" && (
          <div style={{ ...S.card, padding: 20 }}>
            <ComparadorPanel trimestres={trimestres} detalles={detalles} />
            {Object.keys(detalles).length === 0 && trimestres.filter(t => t.estado !== "activo").length >= 2 && (
              <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 12, textAlign: "center",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <i className="ti ti-info-circle" style={{ fontSize: 13 }} aria-hidden="true" />
                Expande los trimestres en la pestaña Historial para cargar sus estadísticas y poder comparar.
              </p>
            )}
          </div>
        )}

      </div>
    </>
  );
}
