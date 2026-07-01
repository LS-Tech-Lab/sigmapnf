// =====================================================================
// conflictos.js — Mejora 9: lógica de detección de conflictos extraída
// a un módulo puro y testeable.
//
// Antes: calcularConflictosLocal vivía como función privada dentro de
// useConflictos.js, sin exportar. No se podía probar sin montar el
// hook completo (lo que requiere mockear useState/useEffect/supabase).
//
// Ahora: se exporta calcularConflictosLocal(data) como función pura
// que solo depende de utils/parsing y utils/time. useConflictos.js la
// importa y la usa exactamente igual que antes; el comportamiento del
// hook no cambia, solo se vuelve testeable.
// =====================================================================

import { DAYS } from "../constants";
import { timeToMin } from "./time";
import { parseClase } from "./parsing";

/**
 * Convierte un string de hora ("7:00AM - 7:45AM" o solo "7:00AM") en
 * un rango { inicio, fin } expresado en minutos desde medianoche.
 * Si no hay hora de fin, asume un bloque de 45 minutos por defecto.
 *
 * @param {string} hora
 * @returns {{inicio: number, fin: number} | null}
 */
export function parseRango(hora) {
  if (!hora) return null;
  const parts  = hora.trim().split(/[-–]/);
  const inicio = timeToMin(parts[0]?.trim());
  if (inicio === 0) return null;
  const fin = parts[1] ? timeToMin(parts[1]?.trim()) : inicio + 45;
  return { inicio, fin: fin > inicio ? fin : inicio + 45 };
}

/**
 * Determina si dos rangos horarios se solapan (intersección estricta).
 * @param {{inicio:number, fin:number}} a
 * @param {{inicio:number, fin:number}} b
 */
export function solapan(a, b) {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/**
 * Determina si dos entradas de horario están en conflicto.
 * Si ambas tienen un rango parseable, compara solapamiento real.
 * Si alguna no tiene rango (formato no reconocido), cae a comparar
 * el texto de hora tal cual, para no perder falsos positivos.
 */
export function tienenConflicto(entA, entB) {
  const ra = parseRango(entA.hora);
  const rb = parseRango(entB.hora);
  if (ra && rb) return solapan(ra, rb);
  return entA.hora?.trim() === entB.hora?.trim();
}

/**
 * Calcula los conflictos de horario (mismo docente, mismo día, horas
 * solapadas) a partir de un arreglo plano de registros de horarios.
 *
 * Es el fallback local usado por useConflictos cuando la RPC SQL
 * conflictos_horario_detalle no está disponible. Complejidad O(n²)
 * por docente y día — aceptable para el fallback, ya que el camino
 * principal es la función SQL.
 *
 * @param {Array<{clase: string, dia: string, hora: string}>} data
 * @returns {Array<{docente: string, dia: string, hora: string, entries: Array}>}
 */
export function calcularConflictosLocal(data) {
  const byDocente = {};
  (data || []).forEach((d) => {
    // Prioridad: relación real docentes.nombre_raw (garantizada por FK) >
    // parseClase(clase) como último recurso para filas legacy sin
    // docente_id vinculado. Agrupar por texto libre podía tratar dos
    // variantes de tipeo del mismo docente como personas distintas,
    // ocultando choques de horario reales.
    const docente = d.docentes?.nombre_raw || parseClase(d.clase).docente;
    if (docente) {
      if (!byDocente[docente]) byDocente[docente] = [];
      byDocente[docente].push(d);
    }
  });

  const issues = [];

  Object.entries(byDocente).forEach(([doc, entries]) => {
    DAYS.forEach((day) => {
      const enDia = entries.filter((e) => e.dia === day);
      if (enDia.length < 2) return;

      for (let i = 0; i < enDia.length; i++) {
        for (let j = i + 1; j < enDia.length; j++) {
          const a = enDia[i], b = enDia[j];
          if (!tienenConflicto(a, b)) continue;

          const grupoExistente = issues.find(
            (c) => c.docente === doc && c.dia === day &&
              (c.entries.includes(a) || c.entries.includes(b))
          );
          if (grupoExistente) {
            if (!grupoExistente.entries.includes(a)) grupoExistente.entries.push(a);
            if (!grupoExistente.entries.includes(b)) grupoExistente.entries.push(b);
          } else {
            issues.push({ docente: doc, dia: day, hora: a.hora, entries: [a, b] });
          }
        }
      }
    });
  });

  return issues;
}
