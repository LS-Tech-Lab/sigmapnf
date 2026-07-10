import React from "react";

// Fix ARCH-10 (auditoría 9 de julio): extraído de HistorialView.jsx sin
// cambios de lógica. Compartido por HistorialView, ModalTrimestre,
// ComparadorPanel y HistorialLista.

export function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" });
}

export function duracion(inicio, fin) {
  if (!inicio || !fin) return null;
  const dias = Math.round((new Date(fin) - new Date(inicio)) / 86400000);
  if (dias < 7) return `${dias} días`;
  const sem = Math.round(dias / 7);
  return `${sem} semana${sem !== 1 ? "s" : ""}`;
}

const ESTADO_BADGE = {
  activo:    { clase: "hist-badge--activo",    label: "Activo"    },
  cerrado:   { clase: "hist-badge--cerrado",   label: "Cerrado"   },
  archivado: { clase: "hist-badge--archivado", label: "Archivado" },
};

export function StatusBadge({ estado }) {
  const c = ESTADO_BADGE[estado] || ESTADO_BADGE.cerrado;
  return <span className={`hist-badge ${c.clase}`}>{c.label}</span>;
}
