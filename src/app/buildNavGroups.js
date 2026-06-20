// ── Grupos de navegación ──────────────────────────────────────────────────────
// Se recalculan según permisos en el componente App
function buildNavGroups(permisos) {
  const grupos = [
    {
      label: "Consulta",
      items: [
        { id: "resumen",    emoji: "📊", label: "Resumen"   },
        { id: "horarios",  emoji: "📅", label: "Horarios"   },
        { id: "secciones", emoji: "🏫", label: "Secciones"  },
      ],
    },
    {
      label: "Académico",
      items: [
        { id: "docentes",    emoji: "👥", label: "Docentes"    },
        { id: "materias",    emoji: "📖", label: "Materias"    },
        { id: "asistencias", emoji: "🖨️", label: "Asistencias" },
      ],
    },
  ];

  const sistema = { label: "Sistema", items: [] };
  sistema.items.push({ id: "historial", emoji: "🗂️", label: "Historial" });
  if (permisos.puedeVerLogs) {
    sistema.items.push({ id: "logs", emoji: "🔐", label: "Registros" });
  }
  if (permisos.puedeGestionarUsuarios) {
    sistema.items.push({ id: "usuarios", emoji: "👑", label: "Usuarios" });
  }
  grupos.push(sistema);

  return grupos;
}

export default buildNavGroups;
