import React, { useState, useEffect } from "react";
import { TURNOS_CONFIG } from "../../../constants";
import { supabase } from "../../../lib/supabase";
import ConfirmBorrarSesionModal from "./ConfirmBorrarSesionModal";

// Fix ARCH-18 (auditoría 12 de julio): extraído de AdminQRPanel.jsx sin
// cambios de lógica — mismo patrón ya usado en ARCH-11/ARCH-13 (extraer un
// bloque autocontenido a su propio archivo, dejando el panel principal como
// orquestador). El modal de confirmación de borrado vive en su propio
// archivo presentacional (ConfirmBorrarSesionModal.jsx).
export default function HistorialSesiones({ fecha, sessionIdActiva, permisos = {}, showToast }) {
  const [sesiones,     setSesiones]     = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [expandido,    setExpandido]    = useState(false);
  const [conteosPorId, setConteosPorId] = useState({});
  // ADMIN-2: borrado de sesiones QR ya cerradas (solo admin, permiso
  // puedeBorrarSesiones). No borra asistencias_diarias — ver RPC
  // admin_borrar_qr_sesiones (0053): qr_session_id queda en NULL.
  const [confirmBorrar, setConfirmBorrar] = useState(null); // sesión a borrar, o null
  const [borrando,      setBorrando]      = useState(false);

  useEffect(() => {
    if (!expandido) return;
    const fetchHistorial = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("qr_sessions")
        .select("id, turno, programa, created_at, activa")
        .eq("fecha", fecha)
        .order("created_at", { ascending: false });
      const sesionesData = data || [];
      setSesiones(sesionesData);
      if (sesionesData.length > 0) {
        const ids = sesionesData.map(s => s.id);
        const { data: registros } = await supabase
          .from("asistencias_diarias")
          .select("qr_session_id, tipo")
          .in("qr_session_id", ids);
        const conteos = {};
        ids.forEach(id => { conteos[id] = { entradas: 0, salidas: 0 }; });
        (registros || []).forEach(r => {
          if (!conteos[r.qr_session_id]) return;
          if (r.tipo === "ENTRADA") conteos[r.qr_session_id].entradas++;
          if (r.tipo === "SALIDA")  conteos[r.qr_session_id].salidas++;
        });
        setConteosPorId(conteos);
      }
      setLoading(false);
    };
    fetchHistorial();
  }, [fecha, expandido, sessionIdActiva]);

  const handleBorrar = async () => {
    if (!confirmBorrar) return;
    setBorrando(true);
    const { error } = await supabase.rpc("admin_borrar_qr_sesiones", {
      p_ids: [confirmBorrar.id],
    });
    setBorrando(false);
    if (error) {
      showToast?.(error.message || "No se pudo borrar la sesión.", "error");
    } else {
      setSesiones(prev => prev.filter(s => s.id !== confirmBorrar.id));
      showToast?.("Sesión QR borrada.", "success");
    }
    setConfirmBorrar(null);
  };

  const sesionesAnteriores = sesiones.filter(s => s.id !== sessionIdActiva);

  return (
    <div className="qrp-hist">
      <button onClick={() => setExpandido(v => !v)} className="qrp-hist-toggle">
        <span className="qrp-hist-toggle-left">
          <i className="ti ti-history qrp-ic-14" aria-hidden="true" />
          Historial de sesiones hoy
        </span>
        <i className={`ti ti-chevron-${expandido ? "up" : "down"} qrp-ic-12`} aria-hidden="true" />
      </button>

      {expandido && (
        <div className="qrp-hist-body">
          {loading ? (
            <div className="qrp-hist-loading">Cargando…</div>
          ) : sesionesAnteriores.length === 0 ? (
            <div className="qrp-hist-empty">
              {sesiones.length === 0 ? "No hay sesiones anteriores para esta fecha." : "Esta es la única sesión del día."}
            </div>
          ) : sesionesAnteriores.map((s, i) => {
            const c     = conteosPorId[s.id] || { entradas: 0, salidas: 0 };
            const total = c.entradas + c.salidas;
            const turnoConf = TURNOS_CONFIG.find(t => t.id === s.turno);
            return (
              <div key={s.id} className={`qrp-hist-row ${i < sesionesAnteriores.length - 1 ? "qrp-hist-row-sep" : ""}`}>
                <span className={`qrp-hist-dot ${s.activa ? "qrp-hist-dot--on" : "qrp-hist-dot--off"}`} />
                <div className="qrp-flex-main">
                  <div className="qrp-hist-title">
                    {turnoConf?.label || s.turno}
                    {s.programa && <span className="qrp-hist-prog"> · {s.programa.replace("PNF ", "")}</span>}
                  </div>
                  <div className="qrp-hist-sub">
                    Iniciada {new Date(s.created_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    <span className={s.activa ? "qrp-hist-status--on" : "qrp-hist-status--off"}>
                      {s.activa ? "activa" : "cerrada"}
                    </span>
                  </div>
                </div>
                <div className="qrp-hist-count">
                  <div className={`qrp-hist-count-n ${total > 0 ? "qrp-hist-count-n--pos" : "qrp-hist-count-n--zero"}`}>{total}</div>
                  <div className="qrp-hist-count-sub">{c.entradas}E · {c.salidas}S</div>
                </div>
                {/* ADMIN-2: solo admin (puedeBorrarSesiones), y solo sesiones
                    ya cerradas — una activa se cierra primero desde el panel. */}
                {permisos.puedeBorrarSesiones && !s.activa && (
                  <button
                    onClick={() => setConfirmBorrar(s)}
                    className="qrp-hist-borrar-btn"
                    title="Borrar esta sesión"
                    aria-label="Borrar esta sesión"
                  >
                    <i className="ti ti-trash qrp-ic-14" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmBorrarSesionModal
        sesion={confirmBorrar}
        borrando={borrando}
        onConfirm={handleBorrar}
        onCancel={() => setConfirmBorrar(null)}
      />
    </div>
  );
}
