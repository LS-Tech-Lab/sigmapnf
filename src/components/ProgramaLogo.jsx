/**
 * ProgramaLogo.jsx
 * Logo dinámico para el sidebar que cambia según el programa seleccionado.
 * - "todos" → logo-coordinacion.png
 * - Cada PNF → SVG icónico con color propio del programa
 *
 * Props:
 *   programa  {string}  valor de selectedPrograma ("todos" | "PNF Informática" | …)
 *   size      {number}  ancho/alto en px (default 32)
 *   expanded  {bool}    si el sidebar está expandido (para mostrar nombre)
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

// ── Iconos SVG por programa ──────────────────────────────────────────────────
// Nota: PNF Informática usa imagen (useImg: true), no ícono SVG.

function IconContaduria({ size }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Libro */}
      <rect x="6" y="4" width="20" height="24" rx="2.5" fill="white" fillOpacity="0.15"/>
      <rect x="6" y="4" width="20" height="24" rx="2.5" stroke="white" strokeWidth="1.8" strokeOpacity="0.7"/>
      <line x1="6" y1="4" x2="6" y2="28" stroke="white" strokeWidth="3" strokeOpacity="0.5"/>
      {/* Líneas de texto */}
      <line x1="11" y1="10" x2="22" y2="10" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.8"/>
      <line x1="11" y1="13.5" x2="22" y2="13.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.6"/>
      {/* Tabla / suma */}
      <line x1="11" y1="18" x2="22" y2="18" stroke="white" strokeWidth="1" strokeOpacity="0.4"/>
      <line x1="16.5" y1="18" x2="16.5" y2="25" stroke="white" strokeWidth="1" strokeOpacity="0.4"/>
      <line x1="11" y1="21.5" x2="22" y2="21.5" stroke="white" strokeWidth="1" strokeOpacity="0.4"/>
      {/* Símbolo $ */}
      <text x="14" y="25" fontSize="5.5" fill="white" fillOpacity="0.9" fontWeight="bold" fontFamily="Arial">$</text>
    </svg>
  );
}

function IconAgroalimentacion({ size }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Tallo */}
      <path d="M16 28V14" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.8"/>
      {/* Hoja izquierda */}
      <path d="M16 20C16 20 10 18 9 12C9 12 15 12 16 20Z" fill="white" fillOpacity="0.7"/>
      {/* Hoja derecha */}
      <path d="M16 16C16 16 22 14 23 8C23 8 17 8 16 16Z" fill="white" fillOpacity="0.85"/>
      {/* Sol */}
      <circle cx="23" cy="8" r="3.5" fill="white" fillOpacity="0.3" stroke="white" strokeWidth="1.4" strokeOpacity="0.7"/>
      {/* Rayos */}
      <line x1="23" y1="3" x2="23" y2="1.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.6"/>
      <line x1="27" y1="4.5" x2="28" y2="3.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.6"/>
      <line x1="28.5" y1="8" x2="30" y2="8" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.6"/>
      {/* Tierra */}
      <path d="M10 28C10 28 13 26 16 26C19 26 22 28 22 28" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.5"/>
    </svg>
  );
}

function IconEducacionEspecial({ size }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Persona izquierda */}
      <circle cx="10" cy="8" r="3" fill="white" fillOpacity="0.8"/>
      <path d="M10 11C7.5 11 6 13 6 15V20" stroke="white" strokeWidth="1.7" strokeLinecap="round"/>
      {/* Persona derecha */}
      <circle cx="22" cy="8" r="3" fill="white" fillOpacity="0.8"/>
      <path d="M22 11C24.5 11 26 13 26 15V20" stroke="white" strokeWidth="1.7" strokeLinecap="round"/>
      {/* Estrella / corazón central — manos unidas */}
      <path d="M10 18C10 18 13 22 16 22C19 22 22 18 22 18" stroke="white" strokeWidth="1.7" strokeLinecap="round"/>
      {/* Corazón */}
      <path d="M16 27C16 27 11 23.5 11 21C11 19.3 12.3 18 14 18C14.9 18 15.6 18.5 16 19C16.4 18.5 17.1 18 18 18C19.7 18 21 19.3 21 21C21 23.5 16 27 16 27Z"
        fill="white" fillOpacity="0.85"/>
    </svg>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────
// Fix A3/S3 (auditoría QA 5/jul/2026, Fase 2): los 2 usos reales en todo el
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

export default function ProgramaLogo({ programa = "todos", size = 32, expanded = false }) {
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
