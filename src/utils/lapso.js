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

  // Retroceder 2 posiciones desde el actual
  let pn = num, py = anio;
  for (let i = 0; i < 2; i++) {
    pn--;
    if (pn < 1) { pn = 3; py--; }
  }

  // Generar 5 consecutivos desde ese punto
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
