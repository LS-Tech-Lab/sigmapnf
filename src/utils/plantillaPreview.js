// plantillaPreview.js — Fase 2 del editor de plantillas (12 ago 2026).
//
// La vista previa de TabPlantillas.jsx reutiliza el MISMO
// plantillaReporte() (membrete + reporte-print.css) que usa la impresión
// real en PlanillaImprimibleBase.jsx -- no hay una plantilla de preview
// separada que se pueda desincronizar de lo que realmente se imprime.
// Lo único propio de este archivo son los datos de muestra (no hay
// horario real disponible en el panel admin, que no está atado a
// ninguna sede/día en particular) y las dimensiones en px para escalar
// el <iframe> dentro del modal.
//
// Aviso de precisión: el iframe se dimensiona al tamaño de página real
// en px (96 CSS px/pulgada) y se achica con `transform: scale()` para
// caber en el modal -- reproduce fielmente tipografía/colores/tabla
// porque reporte-print.css no tiene reglas exclusivas de @media print
// más allá de ocultar botones, pero NO emula paginación real (si el
// contenido de una plantilla con muchas columnas visibles desborda el
// ancho, se ve tal cual se vería impreso, incluyendo el desborde -- eso
// es información útil, no un bug de la preview).
import { plantillaReporte } from "./reportePlantilla";

// Mismas clases/secciones que la foto de referencia que trajo LS
// (12 ago) -- suficiente variedad para ver el efecto de reordenar u
// ocultar columnas sin depender de un horario real cargado.
const BLOQUES_MUESTRA = [
  { hora: "1:30PM-3:45PM", asignatura: "Acreditable", seccion: "4511121", profesor: "Jeniree Saavedra", aula: "Lab 1" },
  { hora: "3:45PM-6:00PM", asignatura: "Seminario de Formación Sociocrítica I", seccion: "4511121", profesor: "Eduglae Fernández", aula: "Aula 3" },
  { hora: "3:45PM-6:00PM", asignatura: "Acreditable", seccion: "4512221", profesor: "Jeniree Saavedra", aula: "Lab 1" },
];

const CAMPOS_PREVIEW = {
  hora:          { getValor: b => b.hora },
  asignatura:    { getValor: b => b.asignatura },
  seccion:       { getValor: b => b.seccion, center: true },
  profesor:      { getValor: b => b.profesor },
  actividad:     { blank: true },
  firma_entrada: { blank: true },
  firma_salida:  { blank: true },
  aula:          { getValor: b => b.aula },
  observacion:   { blank: true },
};

const ESC = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Dimensiones de página en px a 96 CSS px/pulgada -- ver el comentario
 *  de "oficio" en reporte-print.css (215.9×330mm, no el Legal de EE.UU.). */
export const DIMENSIONES_PAGINA_PX = {
  "carta-vertical":    { w: 816,  h: 1056 },
  "carta-horizontal":  { w: 1056, h: 816 },
  "oficio-vertical":   { w: 816,  h: 1247 },
  "oficio-horizontal": { w: 1247, h: 816 },
};

export function construirHtmlPreview({ columnas, orientacion, tamanoPagina, layout, reporteConfig }) {
  const columnasVisibles = (columnas || [])
    .filter(c => c.visible !== false && CAMPOS_PREVIEW[c.campo])
    .slice()
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

  const theadHtml = columnasVisibles.map(c => `<th>${ESC(c.etiqueta)}</th>`).join("");
  const filas = BLOQUES_MUESTRA.map(b => {
    const celdas = columnasVisibles.map(c => {
      const spec = CAMPOS_PREVIEW[c.campo];
      if (spec.blank) return `<td class="td-center"><div class="firma-box"></div></td>`;
      return `<td${spec.center ? ' class="td-center"' : ''}>${ESC(spec.getValor(b))}</td>`;
    }).join("");
    return `<tr>${celdas}</tr>`;
  }).join("");

  const seccionesHtml = `
    <div class="subtitulo">Vista previa · Lunes · Turno: Diurno · Trimestre 2-2026</div>
    <table>
      <thead><tr>${theadHtml || '<th>Sin columnas visibles</th>'}</tr></thead>
      <tbody>${filas || `<tr><td class="td-empty">Sin columnas visibles</td></tr>`}</tbody>
    </table>`;

  return plantillaReporte({
    config: reporteConfig,
    titulo: "Control de Asistencia Docentes",
    subtitulo: "Vista previa",
    seccionesHtml,
    pie: `Total de bloques: ${BLOQUES_MUESTRA.length}`,
    orientacion,
    tamanoPagina,
    layout,
  });
}
