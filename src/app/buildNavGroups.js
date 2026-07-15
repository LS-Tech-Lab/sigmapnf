// ── Grupos de navegación ──────────────────────────────────────────────────────
// ADMIN-3 (auditoría 10 de julio): el grupo "Sistema" (Historial, Registros,
// Usuarios y Roles) se movió fuera de Horarios, al nuevo módulo de
// Administración (src/app/AdminModulo.jsx). Ver docs/AUDITORIA_INDICE.md.
// Los ítems que quedan aquí ya no dependen de ningún permiso — por eso esta
// función ya no recibe `permisos` (lo recibía antes de ADMIN-3, cuando los
// ítems movidos sí necesitaban filtrarse).
function buildNavGroups() {
  // Fix UX-20 (auditoría 14 de julio): "horarios" recupera hasBadge=true.
  // El badge de conflictos (HorariosSidebar.jsx) leía item.hasBadge, pero
  // ningún ítem lo tenía en true desde ADMIN-3 — el conteo de conflictos se
  // calculaba y nunca se mostraba. Ver docs/AUDITORIA_INDICE.md.
  const grupos = [
    {
      label: "Consulta",
      items: [
        { id: "resumen",   icon: "ti-layout-dashboard", label: "Resumen"   },
        { id: "horarios",  icon: "ti-calendar-event",   label: "Horarios", hasBadge: true },
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
