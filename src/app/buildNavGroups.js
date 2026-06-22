// ── Grupos de navegación ──────────────────────────────────────────────────────
// Se recalculan según permisos en el componente App
function buildNavGroups(permisos) {
  const grupos = [
    {
      label: "Consulta",
      items: [
        { id: "resumen",   icon: "ti-layout-dashboard", label: "Resumen"   },
        { id: "horarios",  icon: "ti-calendar-event",   label: "Horarios"  },
        { id: "secciones", icon: "ti-school",           label: "Secciones" },
      ],
    },
    {
      label: "Académico",
      items: [
        { id: "docentes",    icon: "ti-users",      label: "Docentes"    },
        { id: "materias",    icon: "ti-book-2",      label: "Materias"    },
        { id: "asistencias", icon: "ti-printer",     label: "Asistencias" },
      ],
    },
  ];

  const sistema = { label: "Sistema", items: [] };
  sistema.items.push({ id: "historial", icon: "ti-archive", label: "Historial" });
  if (permisos.puedeVerLogs) {
    sistema.items.push({ id: "logs", icon: "ti-shield-lock", label: "Registros" });
  }
  if (permisos.puedeGestionarUsuarios || permisos.puedeGestionarRoles) {
    sistema.items.push({ id: "usuarios", icon: "ti-crown", label: "Usuarios y Roles" });
  }
  grupos.push(sistema);

  return grupos;
}

export default buildNavGroups;
