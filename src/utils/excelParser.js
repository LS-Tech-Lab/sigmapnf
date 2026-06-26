
import * as XLSX from "xlsx";
import { getTurnoByCodigo, normalizeTurno } from "./turno";
import { normalizarPrograma } from "./parsing";
import { normalizarPrograma, parseClase } from "./parsing";

export const TEMPLATE_VERSION = 2;

@@ -298,7 +298,7 @@ export function parseHojaMalla(workbook) {
}

// ── Función principal ────────────────────────────────────────────────────────
export async function parseExcelFile(file, { lapso = null, selectedPrograma = "todos" } = {}) {
export async function parseExcelFile(file, { lapso = null, selectedPrograma = "todos", catalogoDocentes = [] } = {}) {
const binaryStr = await leerArchivo(file);
const workbook  = XLSX.read(binaryStr, { type: "binary" });

@@ -364,6 +364,8 @@ export async function parseExcelFile(file, { lapso = null, selectedPrograma = "t
const horaCompleta = calcularHora(json, i, horaColIdx, merge);
if (!horaCompleta) continue;

        const { materia, docente } = parseClase(clase, catalogoDocentes);

rows.push({
sheet:    sheetName,
programa: programaFinal,
@@ -375,6 +377,8 @@ export async function parseExcelFile(file, { lapso = null, selectedPrograma = "t
dia,
hora:     horaCompleta,
clase,
          materia:  materia || null,
          docente:  docente || null,
lapso:    lapso || null,
});
}
