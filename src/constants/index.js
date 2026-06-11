// ========== Constantes globales ==========
export const DAYS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];

// Lapsos académicos: 3 por año (1 = Ene-Abr, 2 = May-Ago, 3 = Sep-Dic)
// Este valor se calcula dinámicamente en utils/lapso.js y se gestiona desde App.jsx
// No se hardcodea aquí, pero se exporta el mapeo de rangos de meses como referencia.
export const LAPSO_MESES = {
  1: { label: "Ene – Abr", inicio: 1, fin: 4 },
  2: { label: "May – Ago", inicio: 5, fin: 8 },
  3: { label: "Sep – Dic", inicio: 9, fin: 12 },
};

export const ALL_TRAYECTOS = [
  "INICIAL",
  "1-1", "1-2", "1-3",
  "2-1", "2-2", "2-3",
  "3-1", "3-2", "3-3",
  "4-1", "4-2", "4-3"
];

export const DEFAULT_PROGRAMAS = [
  "PNF Informática",
  "PNF Contaduría Pública",
  "PNF Agroalimentación",
  "PNF Educación Especial"
];

export const TRAYECTO_COLORS = {
  "INICIAL": "#8B5CF6",
  "1-1": "#2563EB", "1-2": "#1D4ED8", "1-3": "#1E40AF",
  "2-1": "#DC2626", "2-2": "#B91C1C", "2-3": "#991B1B",
  "3-1": "#D97706", "3-2": "#B45309", "3-3": "#92400E",
  "4-1": "#059669", "4-2": "#047857", "4-3": "#065F46",
};

export const TRAYECTO_BG = {
  "INICIAL": "#F5F3FF",
  "1-1": "#EFF6FF", "1-2": "#DBEAFE", "1-3": "#BFDBFE",
  "2-1": "#FEF2F2", "2-2": "#FEE2E2", "2-3": "#FECACA",
  "3-1": "#FFFBEB", "3-2": "#FEF3C7", "3-3": "#FDE68A",
  "4-1": "#ECFDF5", "4-2": "#D1FAE5", "4-3": "#A7F3D0",
};

export const BLOQUES_DIURNO = [
  { inicio: "7:30AM", fin: "8:15AM", label: "7:30 – 8:15 AM" },
  { inicio: "8:15AM", fin: "9:00AM", label: "8:15 – 9:00 AM" },
  { inicio: "9:00AM", fin: "9:45AM", label: "9:00 – 9:45 AM" },
  { inicio: "9:45AM", fin: "10:30AM", label: "9:45 – 10:30 AM" },
  { inicio: "10:30AM", fin: "11:15AM", label: "10:30 – 11:15 AM" },
  { inicio: "11:15AM", fin: "12:00PM", label: "11:15 AM – 12:00 PM" },
];

export const BLOQUES_VESPERTINO = [
  { inicio: "1:00PM", fin: "1:45PM", label: "1:00 – 1:45 PM" },
  { inicio: "1:45PM", fin: "2:30PM", label: "1:45 – 2:30 PM" },
  { inicio: "2:30PM", fin: "3:15PM", label: "2:30 – 3:15 PM" },
  { inicio: "3:15PM", fin: "4:00PM", label: "3:15 – 4:00 PM" },
  { inicio: "4:00PM", fin: "4:45PM", label: "4:00 – 4:45 PM" },
  { inicio: "4:45PM", fin: "5:30PM", label: "4:45 – 5:30 PM" },
];

export const NAV_ITEMS = [
  { id: "resumen", emoji: "📊", label: "Resumen" },
  { id: "horarios", emoji: "📅", label: "Horarios" },
  { id: "secciones", emoji: "🏫", label: "Secciones" },
  { id: "docentes", emoji: "👥", label: "Docentes", hasBadge: true },
  { id: "materias", emoji: "📖", label: "Materias" },
  { id: "asistencias", emoji: "🖨️", label: "Asistencias" },
  { id: "conflictos", emoji: "⚠️", label: "Conflictos", hasBadge: true },
];

export const S = {
  card: { background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", overflow: "hidden" },
  th: { padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#374151", textAlign: "left", borderBottom: "2px solid #E5E7EB", background: "#F9FAFB", textTransform: "uppercase", letterSpacing: "0.05em" },
  td: { padding: "10px 14px", fontSize: 13, borderTop: "1px solid #F3F4F6", color: "#374151" },
  badge: (bg, col) => ({ background: bg, color: col, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }),
  btn: (active) => ({
    padding: "7px 16px", borderRadius: 20, border: "1px solid",
    borderColor: active ? "#2563EB" : "#E5E7EB", background: active ? "#EFF6FF" : "#fff",
    color: active ? "#1D4ED8" : "#374151", cursor: "pointer", fontSize: 13,
    fontWeight: active ? 600 : 500, transition: "all 0.15s",
  }),
  select: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff", color: "#111827", cursor: "pointer", fontWeight: 500 },
  input: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff", color: "#111827", outline: "none", fontWeight: 500 },
};

export const responsiveCSS = `
 @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
 @media(max-width:768px){.hamburger-btn{display:block!important}.sidebar-aside{transform:translateX(-100%);position:fixed!important;z-index:300;height:100vh;transition:transform .25s}.sidebar-aside.open{transform:translateX(0)}.sidebar-overlay{display:block!important}.main-content{margin-left:0!important}.stats-grid-4{grid-template-columns:repeat(2,1fr)!important}.stats-grid-2{grid-template-columns:1fr!important}.docentes-layout,.materias-layout,.secciones-layout{flex-direction:column!important;height:auto!important}.docentes-left-panel,.materias-left-panel,.secciones-left-panel{width:100%!important;max-height:220px}.global-search{width:160px!important}}
 @media(max-width:480px){.stats-grid-4{grid-template-columns:1fr 1fr!important}.header-stats{display:none}}
`;
