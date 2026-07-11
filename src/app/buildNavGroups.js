// ── Grupos de navegación ──────────────────────────────────────────────────────
// Se recalculan según permisos en el componente App
//
// ADMIN-3 (auditoría 10 de julio): el grupo "Sistema" (Historial, Registros,
// Usuarios y Roles) se movió fuera de Horarios, al nuevo módulo de
// Administración (src/app/AdminModulo.jsx). Ver docs/AUDITORIA_INDICE.md.
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
      ],
    },
  ];

  return grupos;
}

export default buildNavGroups;
