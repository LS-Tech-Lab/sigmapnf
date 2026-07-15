import React from "react";
import { TURNOS_CONFIG } from "../../../constants";

// Fix ARCH-18 (auditoría 12 de julio): extraído de AdminQRPanel.jsx
// (dentro de HistorialSesiones) sin cambios de lógica — es puramente
// presentacional. El estado (confirmBorrar, borrando) y el handler
// (handleBorrar) siguen viviendo en HistorialSesiones.jsx, que los pasa
// por props.
export default function ConfirmBorrarSesionModal({ sesion, borrando, onConfirm, onCancel }) {
  if (!sesion) return null;

  return (
    <div className="qrp-modal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="modal-borrar-sesion-title">
      <div className="qrp-modal">
        <div className="qrp-modal-header">
          <div className="qrp-modal-icon">
            <i className="ti ti-trash-x qrp-ic-danger-22" aria-hidden="true" />
          </div>
          <div>
            <div id="modal-borrar-sesion-title" className="qrp-modal-title">¿Borrar esta sesión QR?</div>
            <div className="qrp-modal-subtitle">Esta acción no se puede deshacer</div>
          </div>
        </div>
        <p className="qrp-modal-body">
          Se borrará el registro de la sesión ({TURNOS_CONFIG.find(t => t.id === sesion.turno)?.label || sesion.turno}).
          Las asistencias ya registradas <strong>no se pierden</strong>: solo dejan de estar vinculadas a esta sesión.
        </p>
        <div className="qrp-modal-actions">
          <button onClick={onCancel} className="qrp-btn-cancel" disabled={borrando}>Cancelar</button>
          <button onClick={onConfirm} className="qrp-btn-danger" disabled={borrando}>
            {borrando ? "Borrando…" : "Sí, borrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
