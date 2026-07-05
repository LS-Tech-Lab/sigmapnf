/**
 * usuarios/shared.jsx
 *
 * Constantes, helpers y micro-componentes compartidos por todos los
 * sub-módulos de Gestión de Usuarios y Roles.
 */

import './shared.css';

// ─── Catálogo de permisos ─────────────────────────────────────────────────────
export const GRUPOS_PERMISOS = [
  {
    grupo: "Horarios",
    icono: "ti-calendar-event",
    items: [
      { key: "puedeVerTodo",             label: "Ver todos los programas",   desc: "Puede cambiar entre todos los PNF sin restricción" },
      { key: "puedeEditarHorarios",      label: "Editar horarios",           desc: "Arrastrar y colocar bloques, editar in-line" },
      { key: "puedeBorrarHorarios",      label: "Borrar horarios",           desc: "Eliminar bloques y vaciar trimestres completos" },
      { key: "puedeGestionarTrimestres", label: "Gestionar trimestres",      desc: "Cambiar el lapso activo, crear/eliminar trimestres" },
    ],
  },
  {
    grupo: "Catálogos académicos",
    icono: "ti-book-2",
    items: [
      { key: "puedeEditarDocentes",  label: "Editar docentes",  desc: "Crear, renombrar y agregar cédulas a docentes" },
      { key: "puedeEditarMaterias",  label: "Editar materias",  desc: "Crear y renombrar unidades curriculares" },
      { key: "puedeImportarExcel",   label: "Importar Excel",   desc: "Cargar horarios desde archivo .xlsx" },
    ],
  },
  {
    grupo: "Respaldo de datos",
    icono: "ti-database",
    items: [
      { key: "puedeHacerBackup",     label: "Exportar backup",  desc: "Descargar JSON con todos los datos del sistema" },
      { key: "puedeRestaurarBackup", label: "Restaurar backup", desc: "Sobrescribir datos desde un archivo de respaldo" },
    ],
  },
  {
    grupo: "Módulo QR",
    icono: "ti-qrcode",
    items: [
      { key: "puedeGestionarQR",          label: "Gestionar QR",              desc: "Abrir sesiones QR, ver proyección, cerrar sesiones" },
      { key: "puedeVerReporteAsistencias", label: "Ver reporte de asistencias", desc: "Consultar y exportar el historial de asistencias" },
    ],
  },
  {
    grupo: "Administración",
    icono: "ti-shield-lock",
    items: [
      { key: "puedeGestionarUsuarios", label: "Gestionar usuarios", desc: "Crear, editar, activar/desactivar cuentas" },
      { key: "puedeGestionarRoles",    label: "Gestionar roles",    desc: "Crear/editar roles y definir sus permisos" },
      { key: "puedeVerLogs",           label: "Ver registros",      desc: "Consultar el historial de acciones del sistema" },
      { key: "puedeVerAuditoria",      label: "Ver auditoría",      desc: "Ver quién hizo qué y cuándo" },
    ],
  },
];

export const TODOS_LOS_PERMISOS = GRUPOS_PERMISOS.flatMap(g => g.items.map(i => i.key));

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const hex2rgba = (hex, a) => {
  const r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

export const COLORES_PRESET = [
  "var(--color-role-coord)", "var(--brand-600)", "#0F766E", "var(--color-text-mid)", "var(--color-success)",
  "var(--color-danger)", "var(--color-warning)", "#0891B2", "#9333EA", "#BE185D",
];

export const EMOJIS_PRESET = ["👤", "👑", "🏛️", "📋", "📷", "🔑", "🛡️", "📊", "🎓", "🖥️", "📌", "⚙️"];

// ─── Micro-componentes ────────────────────────────────────────────────────────
export function Badge({ color, children }) {
  const c = color || "var(--color-text-mid)";
  return (
    <span className="shared-badge" style={{ '--badge-bg': hex2rgba(c, 0.12), '--badge-color': c, '--badge-border': hex2rgba(c, 0.25) }}>
      {children}
    </span>
  );
}

export function Spinner() {
  return <div className="shared-spinner" />;
}

export function ModalConfirm({ titulo, mensaje, onConfirm, onCancel, peligro = true }) {
  return (
    <div className="shared-confirm-backdrop">
      <div className="shared-confirm-dialog">
        <h3 className="shared-confirm-title">{titulo}</h3>
        <p className="shared-confirm-msg">{mensaje}</p>
        <div className="shared-confirm-actions">
          <button onClick={onCancel} className="shared-confirm-cancel">Cancelar</button>
          <button onClick={onConfirm} className={`shared-confirm-btn${peligro ? '' : ' shared-confirm-btn--safe'}`}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}
