// Mejora 6: guard defensivo — si clase es null/undefined/vacío, devuelve vacíos
// en lugar de lanzar una excepción que tumbaría toda la app.
export function parseClase(clase) {
  if (!clase || typeof clase !== "string") return { materia: "", docente: "" };
  const trimmed = clase.trim();
  if (!trimmed) return { materia: "", docente: "" };
  const parts = trimmed.split(/\s+(?:Profes?\.?|Prof\.?)\s+/i);
  return { materia: parts[0].trim(), docente: parts[1] ? parts[1].trim() : "" };
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
