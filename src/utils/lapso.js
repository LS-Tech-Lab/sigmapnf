/**
 * Utilidades para manejo de trimestres académicos.
 *
 * El año académico se divide en 3 trimestres: 1-YYYY, 2-YYYY, 3-YYYY.
 * Las fechas exactas las define la programación académica aprobada;
 * aquí solo se maneja la numeración y el cálculo orientativo.
 */

/**
 * Calcula el trimestre actual basado en la fecha del sistema.
 * Distribución orientativa: 1→Ene-Abr, 2→May-Ago, 3→Sep-Dic.
 * @param {Date} [fecha]
 * @returns {string} Ej: "2-2026"
 */
export function getCurrentLapso(fecha = new Date()) {
  const mes = fecha.getMonth() + 1;
  const anio = fecha.getFullYear();
  let numero;
  if (mes >= 1 && mes <= 4)      numero = 1;
  else if (mes >= 5 && mes <= 8) numero = 2;
  else                           numero = 3;
  return `${numero}-${anio}`;
}

/**
 * Genera lista de trimestres: los 2 anteriores + el actual + los 2 siguientes.
 * @param {string} [trimestre] - Ej: "2-2026"
 * @returns {string[]}
 */
export function getLapsosDisponibles(trimestre = getCurrentLapso()) {
  const [num, anio] = parseLapso(trimestre);

  let pn = num, py = anio;
  for (let i = 0; i < 2; i++) {
    pn--;
    if (pn < 1) { pn = 3; py--; }
  }

  const lista = [];
  let n = pn, y = py;
  for (let i = 0; i < 5; i++) {
    lista.push(`${n}-${y}`);
    n++;
    if (n > 3) { n = 1; y++; }
  }

  return lista;
}

/**
 * Parsea un string de trimestre.
 * @param {string} lapso - Ej: "2-2026"
 * @returns {[number, number]} [numero, año]
 */
export function parseLapso(lapso) {
  const parts = lapso.split("-");
  return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
}

/**
 * Formatea un trimestre para mostrar al usuario.
 * @param {string} lapso - Ej: "2-2026"
 * @returns {string} Ej: "Trimestre 2 · 2026"
 */
export function formatLapso(lapso) {
  const [num, anio] = parseLapso(lapso);
  return `Trimestre ${num} · ${anio}`;
}

/**
 * Calcula el trimestre siguiente a partir de uno dado.
 * Regla: 1→2→3→1 (el año incrementa al pasar de 3→1)
 * @param {string} lapso - Ej: "3-2026"
 * @returns {string} Ej: "1-2027"
 */
export function getSiguienteLapso(lapso) {
  let [num, anio] = parseLapso(lapso);
  num++;
  if (num > 3) { num = 1; anio++; }
  return `${num}-${anio}`;
}

/**
 * Valida el formato de un string trimestre.
 * @param {string} lapso
 * @returns {boolean}
 */
export function isValidLapso(lapso) {
  if (!lapso || typeof lapso !== "string") return false;
  const parts = lapso.split("-");
  if (parts.length !== 2) return false;
  const [num, anio] = [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  return num >= 1 && num <= 3 && anio >= 2000 && anio <= 2100;
}

/**
 * Compara dos trimestres.
 * @returns {number} negativo si a < b, 0 si iguales, positivo si a > b
 */
export function compareLapsos(a, b) {
  const [na, ya] = parseLapso(a);
  const [nb, yb] = parseLapso(b);
  if (ya !== yb) return ya - yb;
  return na - nb;
}
