import React, { useEffect, useRef } from 'react';
import './Toast.css';

const TIPOS_VALIDOS = ["success", "error", "warning", "info"];

export default function Toast({ message, type = "success", onClose }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onClose(), 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [message, onClose]);

  const tipo = TIPOS_VALIDOS.includes(type) ? type : "success";

  return (
    <div
      onClick={onClose}
      role={tipo === "success" ? "status" : "alert"}
      aria-live={tipo === "success" ? "polite" : "assertive"}
      className={`toast toast--${tipo}`}
    >
      {/* Barra lateral de color */}
      <div className="toast-bar" />

      {/* Texto */}
      <span className="toast-text">
        {message}
      </span>

      {/* Botón cerrar */}
      <button
        onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); onClose(); }}
        className="toast-close"
      >×</button>
    </div>
  );
}
