import { timeToMin, partesHoraNormalizadas, minToTime } from './time';
import { BLOQUES_DIURNO, BLOQUES_VESPERTINO, BLOQUES_MIXTO } from '../constants';

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
  // Caso particular PNF Agroalimentación (Cabimas): un solo turno continuo
  // de 7:00 AM a 4:00 PM (sin el corte 12:00-1:00 que separan DIURNO/
  // VESPERTINO en el resto de los PNF). Viene explícito en la celda TURNO
  // de la hoja de horario (ver hoja CONFIGURACIÓN del Excel estándar).
  if (u === "MIXTO") return "MIXTO";
  return null;
}

export function getTurnoFromHora(horaStr) {
  const [inicioStr] = partesHoraNormalizadas(horaStr);
  const min = timeToMin(inicioStr);
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
  if (turno === "VESPERTINO") return BLOQUES_VESPERTINO;
  if (turno === "MIXTO") return BLOQUES_MIXTO;
  return BLOQUES_DIURNO;
}

export function findStartBlock(bloques, horaStr) {
  const [inicioStr] = partesHoraNormalizadas(horaStr);
  const min = timeToMin(inicioStr);
  let best = 0, bestDiff = Infinity;
  bloques.forEach((b, i) => {
    const diff = Math.abs(timeToMin(b.inicio) - min);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}

// Caso particular PNF Agroalimentación: sus bloques NO son los 45 min fijos
// de BLOQUES_DIURNO/VESPERTINO (arrancan a las 7:00 en vez de 7:30, y no
// sabemos si la institución reajusta las horas cada trimestre). En vez de
// mantener una tabla de bloques hardcodeada por programa, la grilla se
// construye a partir de los horarios REALES presentes en los datos:
//
//   1. Se parte de los límites de `bloquesBase` (BLOQUES_DIURNO/VESPERTINO/
//      MIXTO) como esqueleto — así una grilla sin datos cargados todavía
//      se sigue viendo igual que antes.
//   2. Se agrega el inicio y fin real de cada clase de ese turno que no
//      coincida ya con un límite existente (ej. una clase que empieza a
//      las 7:00 en vez de 7:30 agrega un límite nuevo antes del primero).
//   3. Se ordenan todos los límites y se arma un bloque por cada tramo
//      consecutivo.
//
// Con esto, un programa con horas estándar (que ya coinciden con
// bloquesBase) renderiza exactamente la misma grilla de siempre — el
// cambio es 100% aditivo y no requiere configurar nada por programa.
export function buildBloquesDinamicos(bloquesBase, filtered, turnoLabel) {
  const puntos = new Set();
  (bloquesBase || []).forEach(b => {
    const im = timeToMin(b.inicio), fm = timeToMin(b.fin);
    if (im) puntos.add(im);
    if (fm) puntos.add(fm);
  });
  (filtered || []).forEach(d => {
    if (getTurnoDeRegistro(d) !== turnoLabel) return;
    const [inicioStr, finStr] = partesHoraNormalizadas(d.hora);
    const iMin = timeToMin(inicioStr);
    const fMin = finStr ? timeToMin(finStr) : 0;
    if (iMin) puntos.add(iMin);
    if (fMin && fMin > iMin) puntos.add(fMin);
  });

  const ordenados = [...puntos].sort((a, b) => a - b);
  if (ordenados.length < 2) return bloquesBase || [];

  const bloques = [];
  for (let i = 0; i < ordenados.length - 1; i++) {
    const inicioMin = ordenados[i], finMin = ordenados[i + 1];
    const inicio = minToTime(inicioMin), fin = minToTime(finMin);
    bloques.push({ inicio, fin, label: `${inicio} – ${fin}` });
  }
  return bloques;
}

// Cuántas filas de `bloques` (dinámicos o fijos) ocupa una clase, a partir
// de su fin REAL — no de una división fija de 45 min como countBlocks() en
// time.js (que asume ese tamaño de bloque siempre). Como buildBloquesDinamicos
// ya garantiza que el fin real de cada clase es un límite exacto entre dos
// bloques, esto siempre encuentra una fila cuyo `fin` cubre exactamente el
// fin de la clase, sin truncar ni pisar filas de más.
export function countBlocksEnBloques(bloques, horaStr, startIndex) {
  if (!bloques || !bloques.length) return 1;
  const [, finStr] = partesHoraNormalizadas(horaStr);
  if (!finStr) return 1;
  const finMin = timeToMin(finStr);
  if (!finMin) return 1;
  const bi = startIndex ?? findStartBlock(bloques, horaStr);
  let span = 1;
  for (let i = bi; i < bloques.length; i++) {
    span = i - bi + 1;
    if (timeToMin(bloques[i].fin) >= finMin) break;
  }
  return span;
}
