import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import useFocusTrap from "../hooks/useFocusTrap";
import "./ConfirmModal.css";

/**
 * Modal de confirmación propio para operaciones destructivas.
 * Reemplaza window.confirm() — no bloquea el thread y es coherente con el diseño.
 *
 * Props:
 *   open       {boolean}  — si se muestra o no
 *   title      {string}   — título del diálogo
 *   message    {string}   — cuerpo descriptivo
 *   confirmLabel {string} — texto del botón de acción (default "Confirmar")
 *   danger     {boolean}  — si true, el botón de acción es rojo
 *   onConfirm  {fn}       — callback al aceptar
 *   onCancel   {fn}       — callback al cancelar / cerrar
 */
export default function ConfirmModal({
  open,
  title = "¿Estás seguro?",
  message,
  confirmLabel = "Confirmar",
  danger = false,
  onConfirm,
  onCancel,
}) {
  const cancelBtnRef = useRef(null);
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);

  // Accesibilidad: cerrar con Escape y enfocar el botón "Cancelar" al abrir
  // (acción más segura por defecto para operaciones destructivas).
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => { if (e.key === "Escape") onCancel?.(); };
    document.addEventListener("keydown", handleKeyDown);
    cancelBtnRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="cm-overlay" onClick={onCancel} role="presentation">
      <div className="cm-modal" ref={dialogRef} onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        {/* Ícono + Título */}
        <div className="cm-header">
          <i className={`ti ${danger ? "ti-alert-triangle" : "ti-help-circle"} cm-icon ${danger ? "cm-icon--danger" : "cm-icon--info"}`}
            aria-hidden="true" />
          <h2 id="confirm-modal-title" className="cm-title">{title}</h2>
        </div>

        {/* Mensaje */}
        {message && (
          <p className="cm-message">
            {message}
          </p>
        )}

        {/* Botones */}
        <div className="cm-actions">
          <button
            ref={cancelBtnRef}
            className="cm-btn cm-btn--cancel"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            className={`cm-btn ${danger ? "cm-btn--danger" : "cm-btn--primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Fix ARCH-20 (auditoría 12 de julio): PropTypes agregado como contrato de
// props — no cambia comportamiento. Refleja 1:1 el JSDoc de props ya
// existente arriba en este archivo.
ConfirmModal.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string,
  message: PropTypes.string,
  confirmLabel: PropTypes.string,
  danger: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
