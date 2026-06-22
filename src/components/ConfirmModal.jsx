import React, { useEffect, useRef } from "react";

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

  const overlay = {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(0,0,0,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "0 16px",
  };

  const modal = {
    background: "#fff", borderRadius: 12, padding: "24px 28px",
    maxWidth: 420, width: "100%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
    fontFamily: "system-ui,-apple-system,sans-serif",
  };

  const btnBase = {
    padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: "pointer", border: "none",
  };

  return (
    <div style={overlay} onClick={onCancel} role="presentation">
      <div style={modal} onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        {/* Ícono + Título */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <i className={`ti ${danger ? "ti-alert-triangle" : "ti-help-circle"}`}
            style={{ fontSize: 22, color: danger ? "#DC2626" : "#2563EB" }} aria-hidden="true" />
          <h2 id="confirm-modal-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0F172A" }}>{title}</h2>
        </div>

        {/* Mensaje */}
        {message && (
          <p style={{ margin: "0 0 22px", fontSize: 14, color: "#4B5563", lineHeight: 1.6 }}>
            {message}
          </p>
        )}

        {/* Botones */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            ref={cancelBtnRef}
            style={{ ...btnBase, background: "#F1F5F9", color: "#334155" }}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            style={{
              ...btnBase,
              background: danger ? "#DC2626" : "#2563EB",
              color: "#fff",
            }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
