import React, { useEffect, useRef } from 'react';

export default function Toast({ message, type = "success", onClose }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onClose(), 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [message, onClose]);

  const palette = {
    success: { bg: "#F0FDF4", border: "#16A34A", bar: "#16A34A", text: "#14532D" },
    error:   { bg: "#FEF2F2", border: "#DC2626", bar: "#DC2626", text: "#7F1D1D" },
    warning: { bg: "#FFFBEB", border: "#D97706", bar: "#D97706", text: "#78350F" },
    info:    { bg: "#EFF6FF", border: "#2563EB", bar: "#2563EB", text: "#1E3A8A" },
  };

  const c = palette[type] || palette.success;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", top: 20, right: 20, zIndex: 9999,
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 10,
        boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
        maxWidth: 380, minWidth: 260,
        display: "flex", alignItems: "stretch",
        animation: "slideIn 0.25s ease",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      {/* Barra lateral de color */}
      <div style={{ width: 4, background: c.bar, flexShrink: 0 }} />

      {/* Texto */}
      <span style={{
        flex: 1, padding: "13px 14px",
        fontSize: 13, fontWeight: 500,
        color: c.text, lineHeight: 1.5,
        wordBreak: "break-word",
      }}>
        {message}
      </span>

      {/* Botón cerrar */}
      <button
        onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); onClose(); }}
        style={{
          background: "none", border: "none",
          color: c.text, opacity: 0.5,
          cursor: "pointer", fontSize: 18,
          padding: "0 12px", flexShrink: 0,
          lineHeight: 1,
        }}
      >×</button>
    </div>
  );
}
