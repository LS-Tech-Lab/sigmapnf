import React, { useState, useEffect } from "react";
import { formatLapso, isValidLapso } from "../../utils/lapso";
import { duracion } from "./historialUtils";

// Fix ARCH-13 (auditoría 9 de julio): extraído de HistorialView.jsx sin
// cambios de lógica. Modal de cierre / creación de trimestre.
//
// ASIST-6 (12 ago, pedido de LS): se agrega modo="editar" -- hasta ahora
// no existía forma de corregir fecha_inicio/fecha_fin de un trimestre ya
// activo sin pasar por "Cerrar" (que además cambia estado a 'cerrado') o
// por "Nuevo trimestre" (bloqueado si el lapso ya está activo, ver
// handleCrear en HistorialView.jsx). `trimestre` es la fila completa que
// se está editando/cerrando -- antes modo="cerrar" NO precargaba
// fecha_inicio (solo fecha_fin), así que cerrar sin retocar ese campo a
// mano lo dejaba en blanco y el upsert lo ponía en NULL silenciosamente.
export default function ModalTrimestre({ modo, lapsoSugerido, trimestre, onConfirm, onCancel, loading }) {
  const esCrear  = modo === "crear";
  const esEditar = modo === "editar";
  const [lapso,       setLapso]       = useState(lapsoSugerido || trimestre?.lapso || "");
  const [fechaInicio, setFechaInicio] = useState(trimestre?.fecha_inicio || "");
  const [fechaFin,    setFechaFin]    = useState(trimestre?.fecha_fin || "");
  const [observacion, setObservacion] = useState(trimestre?.notas || "");

  useEffect(() => {
    if (esCrear || esEditar) return;
    // modo="cerrar": precarga con los valores reales del trimestre que se
    // está cerrando (antes fechaInicio quedaba vacío) -- fecha_fin solo
    // se sugiere como hoy si el trimestre no trae una todavía.
    setFechaInicio(trimestre?.fecha_inicio || "");
    setFechaFin(trimestre?.fecha_fin || new Date().toISOString().slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esCrear, esEditar, trimestre?.lapso]);

  const valido = esCrear
    ? isValidLapso(lapso) && fechaInicio?.trim()
    : fechaInicio?.trim() && fechaFin?.trim();

  const confirmClase = !valido
    ? "hist-modal__confirm--disabled"
    : esCrear ? "hist-modal__confirm--crear" : esEditar ? "hist-modal__confirm--crear" : "hist-modal__confirm--cerrar";

  return (
    <div className="hist-modal-overlay">
      <div className="hist-modal">

        <div className="hist-modal__icon-wrap">
          <i className={`ti ${esCrear ? "ti-school" : esEditar ? "ti-calendar-cog" : "ti-lock"} hist-modal__icon ${esCrear || esEditar ? "hist-modal__icon--crear" : "hist-modal__icon--cerrar"}`}
             aria-hidden="true" />
        </div>
        <h2 className="hist-modal__title">
          {esCrear ? "Activar nuevo trimestre" : esEditar ? `Editar fechas de ${formatLapso(lapsoSugerido)}` : `Cerrar trimestre ${formatLapso(lapsoSugerido)}`}
        </h2>
        <p className="hist-modal__desc">
          {esCrear
            ? "Completa los datos del nuevo período académico."
            : esEditar
              ? "Corrige las fechas del trimestre. El estado (activo/cerrado) no cambia."
              : "El trimestre pasará al historial como solo lectura. Completa la información antes de cerrar."}
        </p>

        <div className="hist-modal__fields">

          {esCrear && (
            <div>
              <label className="hist-label">Código del trimestre *</label>
              <input value={lapso} onChange={e => setLapso(e.target.value)}
                placeholder="ej: 3-2026"
                className="hist-field__input" />
              <span className="hist-field__hint">Formato: [número]-[año] → 1-2027, 2-2027, 3-2027…</span>
            </div>
          )}

          <div>
            <label className="hist-label">{esCrear ? "Fecha de inicio *" : "Fecha de inicio *"}</label>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
              className="hist-field__input" />
          </div>

          <div>
            <label className="hist-label">{esCrear ? "Fecha estimada de culminación" : "Fecha de culminación *"}</label>
            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
              className="hist-field__input" />
            {fechaInicio && fechaFin && (
              <span className="hist-field__hint hist-field__hint--accent">
                Duración: {duracion(fechaInicio, fechaFin)}
              </span>
            )}
          </div>

          <div>
            <label className="hist-label">Observaciones {esCrear ? "" : "(opcional)"}</label>
            <textarea value={observacion} onChange={e => setObservacion(e.target.value)}
              placeholder={esCrear
                ? "Notas sobre este período, sede, modalidad, etc."
                : esEditar
                  ? "Motivo de la corrección, ej: fecha de inicio real distinta a la planificada…"
                  : "Ej: Trimestre extendido por paro nacional, actividades suspendidas en semana 8…"}
              rows={3}
              className="hist-field__input hist-field__input--textarea" />
          </div>
        </div>

        <div className="hist-modal__actions">
          <button onClick={onCancel} className="hist-modal__cancel">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm({ lapso: esCrear ? lapso : lapsoSugerido, fechaInicio, fechaFin, observacion })}
            disabled={!valido || loading}
            className={`hist-modal__confirm ${confirmClase}`}>
            {loading ? "Procesando…" : (
              <>
                <i className={`ti ${esCrear ? "ti-circle-check" : esEditar ? "ti-device-floppy" : "ti-lock"} hist-modal__confirm-icon`}
                   aria-hidden="true" />
                {esCrear ? `Activar ${lapso || "…"}` : esEditar ? "Guardar cambios" : "Confirmar cierre"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
