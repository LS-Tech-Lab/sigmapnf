// Motor de exportación a CSV del módulo de Reporte de Asistencias.
// Extraído de ReporteAsistencias.jsx.

import { supabase } from "../../../lib/supabase";
import { rangoFechas } from "./helpers";

// ── Exportar CSV con nombre_display cruzado (MEJORA #8) ─────────────────────
export async function exportarCSV(docentesAgrupados, fecha, turno, sedeActiva = null) {
  // Cruzar cédulas contra la tabla docentes para obtener nombre_display oficial
  const cedulas = docentesAgrupados.map(d => d.cedula).filter(Boolean);
  let nombreDisplay = {};
  if (cedulas.length > 0) {
    // SEDE-16: catálogo de docentes independiente por sede (0061) -- sin
    // este filtro el cruce podía traer el nombre_display de un docente
    // homónimo de OTRA sede.
    let query = supabase.from("docentes").select("cedula, nombre_display").in("cedula", cedulas);
    if (sedeActiva) query = query.eq("sede_id", sedeActiva);
    const { data: docentesDB } = await query;
    (docentesDB || []).forEach(d => {
      if (d.cedula && d.nombre_display) nombreDisplay[d.cedula] = d.nombre_display;
    });
  }

  const headers = [
    "Cédula",
    "Nombre (ingresado por docente)",
    "Nombre oficial (sistema)",
    "¿Coincide?",
    "Estado",
    "Hora entrada",
    "Hora salida",
    "Turno",
    "Programa",
  ];

  const lines = docentesAgrupados.map(d => {
    const oficial  = nombreDisplay[d.cedula] || "";
    const coincide = oficial
      ? (oficial.trim().toLowerCase() === (d.nombre || "").trim().toLowerCase() ? "✓" : "✗ REVISAR")
      : "sin registro";
    return [
      d.cedula,
      d.nombre,
      oficial || "—",
      coincide,
      d.estado === "completo"    ? "Entrada y salida" :
      d.estado === "solo_entrada" ? "Solo entrada" :
      d.estado === "solo_salida"  ? "Solo salida (anómalo)" : "—",
      d.horaEntrada ? new Date(d.horaEntrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) : "—",
      d.horaSalida  ? new Date(d.horaSalida).toLocaleTimeString("es-VE",  { hour: "2-digit", minute: "2-digit" }) : "—",
      turno,
      d.programa || "—",
    ];
  });

  const csvContent = [headers, ...lines]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `asistencias_${turno.toLowerCase()}_${fecha}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportarCSVRango(docentes, inicio, fin, turno) {
  const diasHabiles = rangoFechas(inicio, fin).length;
  const headers = ["Cédula", "Nombre", "Días asistidos", "Días hábiles", "% Asistencia", "Horas estimadas", "Programa(s)"];
  const lines = docentes.map(d => {
    const pct = diasHabiles > 0 ? Math.round((d.diasAsistidos / diasHabiles) * 100) : 0;
    return [d.cedula, d.nombre, d.diasAsistidos, diasHabiles, `${pct}%`, `~${d.horasEstimadas}h`, d.programas.join(" / ") || "—"];
  });
  const csv = [headers, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: `reporte_rango_${turno.toLowerCase()}_${inicio}_${fin}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
