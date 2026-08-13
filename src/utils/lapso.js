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
 *
 * ARCH-41 (9 ago): esto es un cálculo ORIENTATIVO por fecha, no consulta la
 * tabla `trimestres`. NO usar para poblar selectores de UI -- puede ofrecer
 * lapsos que nunca se crearon (sin fila en `trimestres`, sin datos en
 * `horarios`) o excluir uno real que quedó fuera del rango ±2. Los
 * selectores de trimestre deben consultar `trimestres` filtrando por
 * `estado` (ver `PlanillaQR.jsx`). Esta función queda solo para cálculos
 * orientativos internos (p. ej. sugerir un rango en un formulario).
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

/**
 * ASIST-4: rango de fechas [inicio, fin] "seguro para consultar" de un
 * trimestre, a partir de la fila real de `trimestres` (fecha_inicio/
 * fecha_fin -- ver useTrimestreActivo.js). Pensado para presets de
 * reportes ("ver todo el trimestre X"): si el trimestre sigue en curso,
 * `fin` se recorta a `hoy` -- pedir asistencias hasta fecha_fin de un
 * trimestre activo (que suele ser una fecha futura) siempre devolvería
 * vacío para los días que aún no pasaron, y confundiría al usuario más
 * que ayudarlo. Para un trimestre cerrado, se usa el rango completo tal
 * cual quedó.
 * @param {{fecha_inicio: string|null, fecha_fin: string|null, estado?: string}} trimestreInfo
 * @param {string} hoy - fecha de hoy en formato YYYY-MM-DD (ver fechaHoyVE())
 * @returns {{inicio: string, fin: string}|null} null si el trimestre no
 *   trae fechas (fallback heurístico sin fila real en `trimestres`).
 */
export function rangoTrimestre(trimestreInfo, hoy) {
  if (!trimestreInfo?.fecha_inicio || !trimestreInfo?.fecha_fin) return null;
  const fin = trimestreInfo.fecha_fin < hoy ? trimestreInfo.fecha_fin : hoy;
  return { inicio: trimestreInfo.fecha_inicio, fin: fin < trimestreInfo.fecha_inicio ? trimestreInfo.fecha_inicio : fin };
}

/**
 * BUG (ausentes-trimestre-cerrado, ago 2026): resuelve a qué `lapso` real
 * (fila de `trimestres` con fecha_inicio/fecha_fin) pertenece una fecha
 * dada, en vez de asumir "el horario de hoy es el que coincide con el
 * día de la semana" sin importar de qué trimestre viene.
 *
 * Sin esto, una vista que arma el horario del día consultando `horarios`
 * solo por `dia` (ej. VistaAusentes.jsx) sigue mostrando el horario de
 * un trimestre YA CERRADO indefinidamente, porque esas filas nunca se
 * borran (se conservan para reportes históricos) y nada las descarta.
 * `horario_docente_hoy()` (SQL, usado al escanear el QR) ya hace este
 * join contra `trimestres` con `estado = 'activo'` -- esta función lleva
 * el mismo criterio al front, pero por RANGO DE FECHAS en vez de solo
 * "activo", para que también sirva al consultar una fecha histórica
 * dentro de un trimestre ya cerrado (modo consulta).
 *
 * @param {string} fecha - YYYY-MM-DD
 * @param {Array<{lapso: string, fecha_inicio: string|null, fecha_fin: string|null}>} trimestres
 * @returns {string|null} el `lapso` que cubre esa fecha, o null si ninguno
 *   la cubre (ej. el hueco entre el cierre de un trimestre y el inicio
 *   del siguiente).
 */
export function lapsoParaFecha(fecha, trimestres) {
  if (!fecha || !Array.isArray(trimestres)) return null;
  const fila = trimestres.find(t =>
    t.fecha_inicio && t.fecha_fin && fecha >= t.fecha_inicio && fecha <= t.fecha_fin
  );
  return fila?.lapso || null;
}
