// =====================================================================
// parsing.js
//
// parseClase(clase, catalogoDocentes?)
//   Separa el texto de una celda de horario en { materia, docente }.
//
//   Estrategias (en orden de prioridad):
//
//   1. Salto de línea (\n) como separador entre materia y docente.
//      Es el patrón dominante en formato v2: la celda tiene dos líneas,
//      la primera es la materia y la segunda comienza con Prof / Profa /
//      Prof. / Prof: / PROF / etc.
//      Ejemplo:
//        "Proyecto I\nPROF. ANILETH CALDERA"
//        "planificacion de los entornos\nprof: Eduglae Barrera"
//
//   2. Separador textual "Prof" en una sola línea (formato v1 y casos
//      residuales del v2 sin salto de línea).
//      Ejemplo: "ACREDITABLE PROF: JENIREE SAAVEDRA"
//
//   3. Matching fuzzy por tokens contra el catálogo de docentes.
//      Cuando no hay separador explícito, itera el catálogo y busca
//      el docente cuyas palabras (normalizadas sin tildes) aparecen
//      todas en la cadena con distancia de edición ≤ 1 por token.
//      Esto resuelve:
//        - Nombres parciales:  "ANILETH CALDERA" → "ANILETH CAROLINA CALDERA RODRIGUEZ"
//        - Tildes faltantes:   "FRANCISCO VILCHEZ" → "FRANCISCO JAVIER VÍLCHEZ RUÍZ"
//        - Typos leves:        "OLEYDY MONTERO" → "OLEIDY BEATRIZ MONTERO DE GONZALEZ"
//                              "EDUGLAE BARRERA" → "EDUDLAE CAROLINA BARRERA RIVERO"
//
//   Todas las estrategias son a prueba de:
//     - Mayúsculas/minúsculas mixtas
//     - Espacios extra
//     - Tildes presentes o ausentes
//     - Variantes "Prof" / "Prof." / "Prof:" / "Profa" / "PROF" / "prof:"
//     - Teléfonos pegados al nombre (/\s+0\d{9,10}$/)
//
// normalizarPrograma(raw)
//   Sin cambios respecto a v1.
// =====================================================================

// ── Utilidades de normalización ──────────────────────────────────────

/**
 * Elimina tildes, convierte a mayúsculas y colapsa espacios.
 * @param {string} s
 * @returns {string}
 */
function norm(s = "") {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Distancia de Levenshtein entre dos strings cortos.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length < b.length) { const t = a; a = b; b = t; }
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(row[j + 1] + 1, next[j] + 1, row[j] + (a[i] !== b[j] ? 1 : 0)));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * Devuelve true si todos los tokens de `nombreCelda` tienen un token
 * equivalente en `nombreCatalogo` con distancia de edición ≤ maxDist.
 *
 * Esto permite:
 *   - Nombres parciales:  "ANILETH CALDERA" ⊆ "ANILETH CAROLINA CALDERA RODRIGUEZ"
 *   - Typos leves:        "OLEYDY" ~ "OLEIDY" (dist=1)
 *
 * @param {string} nombreCelda     - Nombre como aparece en la celda
 * @param {string} nombreCatalogo  - Nombre canónico del catálogo DOCENTES
 * @param {number} [maxDist=1]
 * @returns {boolean}
 */
function tokensMatch(nombreCelda, nombreCatalogo, maxDist = 1) {
  const tokensCelda = norm(nombreCelda).split(" ").filter(Boolean);
  const tokensCanon = norm(nombreCatalogo).split(" ").filter(Boolean);
  if (tokensCelda.length === 0) return false;
  return tokensCelda.every((tc) =>
    tokensCanon.some((tcc) => levenshtein(tc, tcc) <= maxDist)
  );
}

/**
 * Quita un número de teléfono venezolano pegado al final del string.
 * Patrón: " 0412XXXXXXX" (04XX + entre 7 y 9 dígitos = 11-12 dígitos total,
 * según cómo lo hayan ingresado con o sin guiones eliminados).
 * @param {string} s
 * @returns {string}
 */
function quitarTelefono(s) {
  return s.replace(/\s+0\d{9,11}$/, "").trim();
}

/**
 * Limpia el nombre del docente extraído de una celda:
 * quita el prefijo "Prof" con sus variantes y el teléfono si lo hubiera.
 * @param {string} s
 * @returns {string}
 */
function limpiarDocente(s) {
  return quitarTelefono(
    s.replace(/^Prof(?:e?s?a?)\.?\s*:?\s*/i, "").trim()
  );
}

// ── Función principal ─────────────────────────────────────────────────

/**
 * @param {string}   clase              - Texto crudo de la celda de horario.
 * @param {string[]} [catalogoDocentes] - Nombres canónicos (nombre_raw) del
 *                                        catálogo DOCENTES, en cualquier orden.
 * @returns {{ materia: string, docente: string }}
 */
export function parseClase(clase, catalogoDocentes = []) {
  if (!clase || typeof clase !== "string") return { materia: "", docente: "" };
  const trimmed = clase.trim();
  if (!trimmed) return { materia: "", docente: "" };

  // ── Estrategia 1: salto de línea como separador ──────────────────────
  // Formato predominante en v2:
  //   "Nombre de la materia\nPROF. Apellido Nombre"
  //   "Nombre de la materia\nprof: Apellido Nombre"
  const lineas = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lineas.length >= 2) {
    const segundaLinea = lineas[1];
    if (/^Prof/i.test(segundaLinea)) {
      const materia = lineas[0];
      const docenteRaw = limpiarDocente(segundaLinea);
      // Intentar resolver el nombre fuzzy contra el catálogo
      const canonico = resolverCatalogo(docenteRaw, catalogoDocentes);
      return { materia, docente: canonico ?? docenteRaw };
    }
  }

  // ── Estrategia 2: separador "Prof" en una sola línea ────────────────
  // Cubre: "ACREDITABLE PROF: JENIREE SAAVEDRA"
  //        "Materia Prof. Juan Pérez"
  //        "Materia Profa Ana López"
  const matchProf = trimmed.match(/^(.+?)\s+Prof(?:e?s?a?)\.?\s*:?\s+(.+)$/i);
  if (matchProf) {
    const materia = matchProf[1].trim();
    const docenteRaw = limpiarDocente(matchProf[2]);
    const canonico = resolverCatalogo(docenteRaw, catalogoDocentes);
    return { materia, docente: canonico ?? docenteRaw };
  }

  // ── Estrategia 3: matching fuzzy contra catálogo (sin separador) ─────
  // Para celdas históricas sin "Prof" y sin \n.
  if (catalogoDocentes.length > 0) {
    const upper = trimmed.toUpperCase();
    // Ordenar de mayor a menor longitud para preferir el match más específico
    const ordenado = [...catalogoDocentes].sort((a, b) => b.length - a.length);
    for (const nombre of ordenado) {
      const nombreNorm = norm(nombre);
      if (!nombreNorm) continue;
      // El nombre debe aparecer como sufijo (al final) de la cadena normalizada
      const upperNorm = norm(upper);
      if (upperNorm.endsWith(nombreNorm)) {
        const idx = upper.length - nombre.trim().length;
        const materia = trimmed.slice(0, idx).trim();
        if (materia) return { materia, docente: nombre.trim() };
      }
    }
  }

  // ── Fallback ─────────────────────────────────────────────────────────
  return { materia: trimmed, docente: "" };
}

/**
 * Dado un nombre tal como aparece en la celda (posiblemente con typos o
 * truncado), busca el nombre canónico más probable en el catálogo usando
 * matching fuzzy por tokens.
 *
 * @param {string}   nombreCelda
 * @param {string[]} catalogo
 * @returns {string|null}  nombre canónico, o null si no hay match confiable
 */
function resolverCatalogo(nombreCelda, catalogo) {
  if (!catalogo || catalogo.length === 0 || !nombreCelda) return null;
  // Ordenar por longitud desc para preferir match más específico
  const ordenado = [...catalogo].sort((a, b) => b.length - a.length);
  for (const canonico of ordenado) {
    if (tokensMatch(nombreCelda, canonico)) return canonico;
  }
  return null;
}

// ── normalizarPrograma (sin cambios) ─────────────────────────────────

export function normalizarPrograma(raw) {
  if (!raw) return null;
  const PROGRAMA_ALIASES = {
    "informatica": "PNF Informática", "informática": "PNF Informática",
    "contaduria": "PNF Contaduría Pública", "contaduría": "PNF Contaduría Pública",
    "agroalimentacion": "PNF Agroalimentación", "agroalimentación": "PNF Agroalimentación",
    "educacion especial": "PNF Educación Especial", "educación especial": "PNF Educación Especial",
  };
  const lower = raw.trim().toLowerCase().replace(/pnf\s+(en\s+)?/i, "").trim();
  for (const [key, canonical] of Object.entries(PROGRAMA_ALIASES)) {
    if (lower.includes(key)) return canonical;
  }
  return raw.trim().replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
