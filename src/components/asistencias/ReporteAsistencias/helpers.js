// Constantes y funciones puras compartidas por las vistas del módulo de
// Reporte de Asistencias (vista diaria, vista por rango, vista de ausentes).
// Extraído de ReporteAsistencias.jsx.

import { TURNOS_CONFIG } from "../../../constants";

// FIX (turno-todos-reporte): se agrega "TODOS" como opción de filtro,
// además de los turnos reales que existen en el módulo QR (DIURNO/VESPERTINO).
// MEJORA #11: lista dinámica desde TURNOS_CONFIG — si se activa NOCTURNO
// en constants/index.js, aparece automáticamente en el filtro del reporte.
export const TURNOS_FILTRO = [...TURNOS_CONFIG.filter(t => t.habilitado).map(t => t.id), "TODOS"];

// Intervalo de refresco de respaldo (ver FIX realtime-fallback-polling-reporte
// y FIX reporte-refresco-molesto). Solo es red de seguridad: Realtime ya está
// confirmado activo, así que no hace falta que sea agresivo.
export const POLL_FALLBACK_MS = 60000;

// ── Días de la semana según fecha ISO ───────────────────────────────────────
const DIAS_ISO = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
export function diaSemana(fechaISO) {
  // Parsear como fecha local para evitar desfase de zona horaria
  const [y, m, d] = fechaISO.split("-").map(Number);
  return DIAS_ISO[new Date(y, m - 1, d).getDay()];
}

// ── Agrupar filas por cédula → un objeto por docente ────────────────────────
export function agruparPorDocente(rows) {
  const map = {};
  rows.forEach(r => {
    if (!map[r.cedula_docente]) {
      map[r.cedula_docente] = {
        cedula: r.cedula_docente,
        nombre: r.nombre_docente,
        programa: r.programa,
        horaEntrada: null,
        horaSalida: null,
        estado: null,
      };
    }
    const d = map[r.cedula_docente];
    if (r.tipo === "ENTRADA") d.horaEntrada = r.hora_registro;
    if (r.tipo === "SALIDA")  d.horaSalida  = r.hora_registro;
    // Nombre más reciente gana (por si cambió)
    d.nombre = r.nombre_docente;
  });

  Object.values(map).forEach(d => {
    if (d.horaEntrada && d.horaSalida)  d.estado = "completo";
    else if (d.horaEntrada)             d.estado = "solo_entrada";
    else                                d.estado = "solo_salida";
  });

  return Object.values(map).sort((a, b) => {
    // Primero los que solo tienen entrada (pendientes de salida), luego completos, luego anómalos
    const orden = { solo_entrada: 0, completo: 1, solo_salida: 2 };
    return (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) ||
      (a.horaEntrada || "").localeCompare(b.horaEntrada || "");
  });
}

// ── MEJORA #9: helper de días hábiles ────────────────────────────────────────
export function rangoFechas(inicio, fin) {
  const dias = [];
  const cur  = new Date(inicio + "T00:00:00");
  const end  = new Date(fin   + "T00:00:00");
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) dias.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dias;
}
