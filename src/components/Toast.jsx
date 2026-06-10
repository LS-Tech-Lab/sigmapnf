import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function Toast({ message, type = "success", onClose }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onClose(), 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [message, onClose]);

  const bgColors = { success: "#059669", error: "#DC2626", warning: "#D97706", info: "#2563EB" };
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };

  return (
    <div
      style={{
        position: "fixed", top: 20, right: 20, zIndex: 9999,
        background: bgColors[type] || bgColors.success,
        color: "#fff", padding: "14px 20px", borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)", fontSize: 14,
        fontWeight: 500, maxWidth: 420,
        display: "flex", alignItems: "flex-start", gap: 12,
        animation: "slideIn 0.3s ease", cursor: "pointer", lineHeight: 1.4
      }}
      onClick={onClose}
    >
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icons[type] || icons.success}</span>
      <span style={{ flex: 1, wordBreak: "break-word" }}>{message}</span>
      <button
        onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); onClose(); }}
        style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", cursor: "pointer", fontSize: 16, padding: "2px 6px", borderRadius: 4, opacity: 0.9, fontWeight: 700, flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  );
}
