// ========== Constantes globales ==========
export const DAYS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];

// Trimestres académicos: 3 por año (1-YYYY, 2-YYYY, 3-YYYY).
// Las fechas exactas las define la programación académica aprobada.
// La lógica de cálculo dinámico está en src/utils/lapso.js

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

export const ROL_SIDEBAR = {
  admin:          { label: "Administrador",  color: "#A78BFA" },
  coordinador:    { label: "Coordinador",    color: "#60A5FA" },
  secretario:     { label: "Secretario",     color: "#34D399" },
  administrativo: { label: "Administrativo", color: "#94A3B8" },
  operador_qr:    { label: "Operador QR",    color: "#34D399" },
};

export const NAV_ITEMS = [
  { id: "resumen",    icon: "ti-layout-dashboard", label: "Resumen" },
  { id: "horarios",  icon: "ti-calendar-event",   label: "Horarios" },
  { id: "secciones", icon: "ti-school",           label: "Secciones" },
  { id: "docentes",  icon: "ti-users",            label: "Docentes" },
  { id: "materias",  icon: "ti-book-2",           label: "Materias" },
  { id: "asistencias", icon: "ti-printer",        label: "Asistencias" },
  { id: "conflictos", icon: "ti-alert-triangle",  label: "Conflictos", hasBadge: true }, // badge = nº de conflictos detectados
];

export const S = {
  card: { background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 1px 2px rgba(15,23,42,0.04)", overflow: "hidden" },
  th: { padding: "11px 14px", fontSize: 11, fontWeight: 700, color: "#475569", textAlign: "left", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC", textTransform: "uppercase", letterSpacing: "0.06em" },
  td: { padding: "11px 14px", fontSize: 13, borderTop: "1px solid #F1F5F9", color: "#334155" },
  badge: (bg, col) => ({ background: bg, color: col, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }),
  btn: (active) => ({
    padding: "7px 16px", borderRadius: 8, border: "1px solid",
    borderColor: active ? "#2563EB" : "#E2E8F0", background: active ? "#EFF6FF" : "#fff",
    color: active ? "#1D4ED8" : "#334155", cursor: "pointer", fontSize: 13,
    fontWeight: active ? 600 : 500, transition: "all 0.15s",
  }),
  select: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", color: "#0F172A", cursor: "pointer", fontWeight: 500 },
  input: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", color: "#0F172A", outline: "none", fontWeight: 500 },
};

export const responsiveCSS = `
 @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
 @media(max-width:768px){.hamburger-btn{display:block!important}.sidebar-aside{transform:translateX(-100%);position:fixed!important;z-index:300;height:100vh;transition:transform .25s}.sidebar-aside.open{transform:translateX(0)}.sidebar-overlay{display:block!important}.main-content{margin-left:0!important}.stats-grid-4{grid-template-columns:repeat(2,1fr)!important}.stats-grid-2{grid-template-columns:1fr!important}.docentes-layout,.materias-layout,.secciones-layout{flex-direction:column!important;height:auto!important}.docentes-left-panel,.materias-left-panel,.secciones-left-panel{width:100%!important;max-height:220px}.global-search{width:160px!important}}
 @media(max-width:480px){.stats-grid-4{grid-template-columns:1fr 1fr!important}.header-stats{display:none}}
`;

// ── MEJORA #11: Configuración de turnos ─────────────────────────────────────
// Para activar el turno NOCTURNO, cambia `habilitado: false` a `true`.
// No se requiere modificar ningún otro archivo.
export const TURNOS_CONFIG = [
  {
    id:         "DIURNO",
    label:      "☀️ Diurno",
    hora:       "7:30 AM – 12:00 PM",
    finMin:     720,   // 12:00 en minutos desde medianoche
    habilitado: true,
  },
  {
    id:         "VESPERTINO",
    label:      "🌆 Vespertino",
    hora:       "1:00 PM – 5:30 PM",
    finMin:     1050,  // 17:30
    habilitado: true,
  },
  {
    id:         "NOCTURNO",
    label:      "🌙 Nocturno",
    hora:       "6:00 PM – 9:30 PM",
    finMin:     1290,  // 21:30
    habilitado: false, // Cambiar a true cuando la institución active este turno
  },
];
