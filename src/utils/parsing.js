// =====================================================================
// parsing.js
//
// parseClase(clase, catalogoDocentes?)
//   Separa el texto de una celda de horario en { materia, docente }.
//
//   Estrategia (en orden de prioridad):
//
//   1. Separador textual "Prof / Profa / Profes" (comportamiento original).
//      Cubre la mayoría de celdas en formato v1.
//
//   2. Matching por catálogo de docentes (nuevo formato v2).
//      Si el separador no encontró un docente Y se provee un catálogo
//      (array de strings con nombres canónicos), busca cuál nombre del
//      catálogo aparece en la cadena y lo usa como punto de corte.
//      Esto resuelve celdas como:
//        "PROYECTO II ANILETH CALDERA"
//        "Proyecto IV GLORIA FALCON"
//      donde el nombre del docente no va precedido de "Prof".
//
//   El catálogo se pasa como argumento opcional para no acoplar este
//   módulo a Supabase ni al estado global — la llamada en useUpload
//   ya tendrá los nombres disponibles en memoria.
//
// normalizarPrograma(raw)
//   Sin cambios respecto a v1.
// =====================================================================

/**
 * @param {string} clase           - Texto crudo de la celda de horario.
 * @param {string[]} [catalogoDocentes] - Nombres canónicos (nombre_raw) del
 *                                        catálogo DOCENTES, en cualquier orden.
 * @returns {{ materia: string, docente: string }}
 */
export function parseClase(clase, catalogoDocentes = []) {
  if (!clase || typeof clase !== "string") return { materia: "", docente: "" };
  const trimmed = clase.trim();
  if (!trimmed) return { materia: "", docente: "" };

  // ── Estrategia 1: separador "Prof / Profa / Profes" ─────────────────────
  // Orden de alternancia importante: "Profes?" antes que "Prof" evita que
  // "Profe"/"Profes" colapse prematuramente; "Profa?" cubre "Prof"/"Profa".
  const parts = trimmed.split(/\s+(?:Profes?\.?|Profa\.?|Prof\.?)\s+/i);
  if (parts.length >= 2) {
    return { materia: parts[0].trim(), docente: parts[1].trim() };
  }

  // ── Estrategia 2: matching por catálogo canónico ─────────────────────────
  // Solo se intenta si se proveyó un catálogo con al menos un nombre.
  if (catalogoDocentes.length > 0) {
    const upper = trimmed.toUpperCase();

    // Ordenar por longitud descendente para evitar que un apellido corto
    // haga match dentro de un nombre más largo (ej. "LEON" dentro de "VALDELON").
    const ordenado = [...catalogoDocentes].sort((a, b) => b.length - a.length);

    for (const nombre of ordenado) {
      const nombreUpper = nombre.trim().toUpperCase();
      if (!nombreUpper) continue;

      const idx = upper.indexOf(nombreUpper);
      if (idx === -1) continue;

      // Verificar que el match empiece en un límite de palabra
      const charAntes = idx > 0 ? upper[idx - 1] : " ";
      if (charAntes !== " ") continue;

      // materia = todo lo que precede al nombre del docente, sin trailing spaces
      const materia = trimmed.slice(0, idx).trim();
      const docente = trimmed.slice(idx).trim();

      if (materia) return { materia, docente };
    }
  }

  // ── Fallback: sin docente identificable ─────────────────────────────────
  return { materia: trimmed, docente: "" };
}

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
  return raw.trim().replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
