import { timeToMin } from './time';
import { BLOQUES_DIURNO, BLOQUES_VESPERTINO } from '../constants';

export function getTurnoByCodigo(sheetName) {
  if (!sheetName) return null;
  const digits = sheetName.replace(/\D/g, "");
  if (digits.length < 2) return null;
  const penultimo = digits[digits.length - 2];
  if (penultimo === "1") return "DIURNO";
  if (penultimo === "2") return "VESPERTINO";
  return null;
}

export function normalizeTurno(t) {
  if (!t) return null;
  const u = t.toUpperCase().trim();
  if (u === "MATUTINO" || u === "DIURNO") return "DIURNO";
  if (u === "VESPETINO" || u === "VESPERTINO") return "VESPERTINO";
  return null;
}

export function getTurnoFromHora(horaStr) {
  const raw = horaStr ? horaStr.replace(/\s/g, "").split(/[-–]/)[0] : "";
  const min = timeToMin(raw);
  if (min >= timeToMin("7:00AM") && min <= timeToMin("12:00PM")) return "DIURNO";
  if (min >= timeToMin("1:00PM") && min <= timeToMin("5:30PM")) return "VESPERTINO";
  return null;
}

export function getTurnoDeRegistro(d) {
  return normalizeTurno(d.turno) || getTurnoByCodigo(d.sheet) || getTurnoFromHora(d.hora) || "DIURNO";
}

// Mejora 4: eliminado el import() dinámico (devolvía una Promise, nunca funcionó).
// BLOQUES_DIURNO y BLOQUES_VESPERTINO ya están importados estáticamente al tope del archivo.
export function getBloquesForTurno(turno) {
  return turno === "VESPERTINO" ? BLOQUES_VESPERTINO : BLOQUES_DIURNO;
}

export function findStartBlock(bloques, horaStr) {
  const raw = horaStr ? horaStr.replace(/\s/g, "").split(/[-–]/)[0] : "";
  const min = timeToMin(raw);
  let best = 0, bestDiff = Infinity;
  bloques.forEach((b, i) => {
    const diff = Math.abs(timeToMin(b.inicio) - min);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}
