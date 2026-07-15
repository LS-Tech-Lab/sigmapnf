/**
 * ProgramaLogo.jsx
 * Logo dinámico para el sidebar que cambia según el programa seleccionado.
 * - "todos" → logo-coordinacion.png
 * - Cada PNF → SVG icónico con color propio del programa
 *
 * Props:
 *   programa  {string}  valor de selectedPrograma ("todos" | "PNF Informática" | …)
 *   size      {number}  ancho/alto en px (default 32)
 */

import React from "react";

// ── Paleta por programa ──────────────────────────────────────────────────────
const PROGRAMA_META = {
  "todos": {
    label:   "Coordinación",
    color1:  "#1E3A8A",
    color2:  "#2563EB",
    useImg:  true,
    img:     "/logo-coordinacion.png",
  },
  "PNF Informática": {
    label:   "Informática",
    color1:  "#1D4ED8",
    color2:  "#38BDF8",
    useImg:  true,
    img:     "/logo-informatica.png",
  },
  "PNF Contaduría Pública": {
    label:   "Contaduría",
    color1:  "#065F46",
    color2:  "#34D399",
    useImg:  true,
    img:     "/logo-contaduria.png",
  },
  "PNF Agroalimentación": {
    label:   "Agroalimentación",
    color1:  "#14532D",
    color2:  "#86EFAC",
    useImg:  true,
    img:     "/logo-agroalimentacion.png",
  },
  "PNF Educación Especial": {
    label:   "Educ. Especial",
    color1:  "#581C87",
    color2:  "#C084FC",
    useImg:  true,
    img:     "/logo-educacion.png",
  },
};

// ── Componente principal ─────────────────────────────────────────────────────
// Fix UX-5/SEC-3 (auditoría QA 5/jul/2026, Fase 2): los 2 usos reales en todo el
// repo (HorariosLayout.jsx) siempre llaman con size={32} — no hay caso real
// de tamaño variable, así que --pl-size/--pl-radius se fijan en CSS en vez
// de inline. El gradiente color1/color2 depende de `programa`, un dominio
// fijo de 5 claves (PROGRAMA_META, arriba) — se resuelve con
// programaClass() + clases .pl-container--<programa> en vez de style inline.
function programaClass(programa) {
  const slugs = {
    "todos": "todos",
    "PNF Informática": "informatica",
    "PNF Contaduría Pública": "contaduria",
    "PNF Agroalimentación": "agroalimentacion",
    "PNF Educación Especial": "educacion-especial",
  };
  return `pl-container--${slugs[programa] || "todos"}`;
}

export default function ProgramaLogo({ programa = "todos", size = 32 }) {
  const meta = PROGRAMA_META[programa] || PROGRAMA_META["todos"];

  if (meta.useImg) {
    return (
      <div className={`pl-container ${programaClass(programa)}`}>
        <img
          src={meta.img}
          alt={meta.label}
          className="pl-img"
          draggable={false}
        />
      </div>
    );
  }

  const Icon = meta.icon;
  return (
    <div
      className={`pl-container pl-container--icon ${programaClass(programa)}`}
      title={meta.label}
    >
      <Icon size={size * 0.78} />
    </div>
  );
}
