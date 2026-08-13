// reportePlantilla.js — ADMIN-6 (auditoría 1 ago 2026)
//
// Extraído y generalizado de exportPDF.js (que hasta ahora tenía
// "UNERMB"/una "U" de placeholder hardcodeados). Único punto donde se arma
// el membrete HTML de los 3 documentos imprimibles del sistema: Reporte
// Diario, Reporte por Rango (ambos en exportPDF.js) y Planilla Imprimible
// (PlanillaImprimibleBase.jsx).
//
// Diseñado para ser reusable por futuros documentos institucionales
// (constancias, etc.) — cualquier módulo nuevo que necesite el mismo
// membrete solo tiene que llamar a plantillaReporte() con su propio
// `seccionesHtml`.
//
// Corrección (12 ago, Fase 3 del editor de plantillas): un comentario
// anterior acá decía que color_clase usaba una clase CSS "porque el CSP
// style-src 'self' bloquea estilos inline". Verificado y es INCORRECTO:
// esta ventana se abre con `window.open("", "_blank")` + `document.write()`
// -- no hay respuesta HTTP de por medio, así que las cabeceras CSP de
// vercel.json (que solo aplican a rutas servidas por Vercel) nunca le
// llegan, y el HTML generado tampoco trae su propio `<meta
// http-equiv="Content-Security-Policy">`. Inline `style=""` funciona sin
// problema en esta ventana. El motivo real de usar clases en vez de
// inline es higiene contra inyección: `config` viene de una tabla
// editable por un admin (configuracion_reportes) y un valor de texto
// arbitrario interpolado crudo dentro de un `style="color:${valor}"`
// podría romper el atributo o el documento igual que cualquier otro caso
// sin ESC() (mismo espíritu que SEC-25) -- mapear a una clase conocida
// (o, para `layout` más abajo, validar que sea un número finito) es lo
// que cierra esa puerta, no el CSP.
//
// Seguridad: todo texto de `config` (nombre_institucion, subtitulo_1/2,
// pie_texto, firma_label) pasa por ESC() antes de interpolarse, exactamente
// igual que cualquier otro dato de usuario en la app — mismo criterio que
// SEC-25, sin importar que estos valores vengan de un formulario
// admin-only. `logo_base64` NO se escapa (es un atributo src, no texto),
// pero su formato ya fue validado por un CHECK constraint en la tabla
// (solo data URIs image/png|jpeg|webp) — ver migración 0056.

const ESC = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Valores de respaldo: los mismos que exportPDF.js tenía hardcodeados
// antes de ADMIN-6. Se usan si configuracion_reportes no cargó (fila
// ausente, error de red, etc.) — un reporte nunca debería quedar sin
// membrete por un fallo de este fetch secundario.
export const CONFIG_REPORTE_DEFAULT = {
  nombre_institucion: "UNERMB",
  subtitulo_1: "Programas Nacionales de Formación",
  subtitulo_2: "Control de Asistencia Docente",
  pie_texto: "Documento generado automáticamente por el sistema SigmaPNF",
  firma_label: "Firma y sello del Coordinador(a)",
  logo_base64: null,
  // Migración 0092 (13 ago): segundo logo, distinto del institucional --
  // se muestra junto al ícono de la Planilla de Asistencia por Turno.
  logo_coordinacion_base64: null,
  color_clase: "rp-color--azul",
};

const CLASES_COLOR_VALIDAS = new Set([
  "rp-color--azul", "rp-color--verde", "rp-color--teal",
  "rp-color--morado", "rp-color--rojo", "rp-color--ambar",
]);

// Fase 2 del editor de plantillas (12 ago, migración 0091): `orientacion`/
// `tamano_pagina` ya existían en plantillas_impresion desde la Fase 1
// pero nada los leía todavía -- el @page de reporte-print.css quedaba
// fijo en A4 horizontal sin importar lo que dijera la plantilla. Mismo
// truco que color_clase (mapear a una clase conocida en vez de
// interpolar el valor crudo -- ver la corrección de arriba, no es por
// CSP): una clase rp-page--<tamaño>-<orientacion> definida en
// reporte-print.css vía @page con nombre. Completamente opcional --
// ReporteAsistencias/ReporteRango (exportPDF.js) no pasan estos
// parámetros y siguen usando el @page sin nombre de siempre (A4
// horizontal), cero cambio de comportamiento para ellos.
const PAGINAS_VALIDAS = new Set([
  "rp-page--carta-vertical", "rp-page--carta-horizontal",
  "rp-page--oficio-vertical", "rp-page--oficio-horizontal",
]);
function resolverClasePagina(tamanoPagina, orientacion) {
  if (!tamanoPagina && !orientacion) return null; // caller no pidió nada -- sin cambio de @page
  const tamano = tamanoPagina === "oficio" ? "oficio" : "carta"; // default: carta
  const orient = orientacion === "vertical" ? "vertical" : "horizontal"; // default: horizontal
  const clase = `rp-page--${tamano}-${orient}`;
  return PAGINAS_VALIDAS.has(clase) ? clase : null;
}

// Fase 3 del editor de plantillas (12 ago, migración 0091, columna
// `layout` reservada desde la Fase 1): reposiciona libremente los 3
// bloques del membrete/pie -- `izq` (logo + texto institucional), `der`
// (título/subtítulo/fecha) y `pie` (texto de pie + firma). El resto del
// documento (la tabla de datos) sigue en flujo normal, sin reposicionar
// -- mover eso libremente no lo pidió LS y complica mucho el diseñador
// para poco beneficio real.
//
// SEGURO interpolar `x`/`y` directo en `style="left:${x}mm"` porque acá
// SÍ se valida que sean números finitos dentro del canvas antes de
// tocar el string -- lo que evita la inyección no es el mecanismo (clase
// vs. inline) sino la validación. Un valor inválido para un bloque hace
// que ESE bloque caiga a su posición por defecto (sin `style`, ver
// `layoutStyleInline`) en vez de romper todo el documento.
const ALTURA_MEMBRETE_MM = 40;
const ALTURA_PIE_MM = 30;

function sanitizarMm(valor, maximoMm) {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, 0), maximoMm);
}

/** Construye el atributo `style=""` (con el espacio inicial incluido, o
 *  cadena vacía) para un bloque de `layout.bloques`, o cadena vacía si
 *  no hay layout, el bloque no está definido, o sus coordenadas no son
 *  números válidos -- en todos esos casos el bloque cae al flujo normal
 *  (flex) de reporte-print.css, exactamente el comportamiento previo a
 *  la Fase 3. `anchoMm`/`altoMm` acotan el arrastre al tamaño real del
 *  canvas de esa plantilla (varía con orientación/tamaño de página).
 */
function layoutStyleInline(bloques, nombreBloque, anchoMm, altoMm) {
  const punto = bloques?.[nombreBloque];
  if (!punto) return "";
  const x = sanitizarMm(punto.x, anchoMm);
  const y = sanitizarMm(punto.y, altoMm);
  if (x === null || y === null) return "";
  return ` style="position:absolute;left:${x}mm;top:${y}mm"`;
}

// Dimensiones de página en mm y márgenes reales del @page con nombre
// correspondiente (reporte-print.css) -- de acá sale el ancho/alto de
// "lienzo" disponible para el layout libre de la Fase 3. Si algún día se
// tocan los márgenes de reporte-print.css, hay que actualizar esta tabla
// también (es la única duplicación real entre los dos archivos).
const PAGINA_MM = {
  "carta-vertical":    { w: 215.9, h: 279.4, marginX: 12, marginY: 14 },
  "carta-horizontal":  { w: 279.4, h: 215.9, marginX: 14, marginY: 12 },
  "oficio-vertical":   { w: 215.9, h: 330,   marginX: 12, marginY: 14 },
  "oficio-horizontal": { w: 330,   h: 215.9, marginX: 14, marginY: 12 },
};
export function anchoContenidoMm(tamanoPagina, orientacion) {
  const tamano = tamanoPagina === "oficio" ? "oficio" : "carta";
  const orient = orientacion === "vertical" ? "vertical" : "horizontal";
  return PAGINA_MM[`${tamano}-${orient}`].w - PAGINA_MM[`${tamano}-${orient}`].marginX * 2;
}

/**
 * plantillaReporte({ config, titulo, subtitulo, seccionesHtml, pie })
 *
 * Arma el HTML completo (<!DOCTYPE> a </html>) de la ventana de impresión,
 * con el membrete institucional configurable + el contenido específico del
 * documento (`seccionesHtml`, ya armado por el caller).
 *
 * `config` es opcional — si se omite o viene incompleto, cada campo cae a
 * CONFIG_REPORTE_DEFAULT campo por campo (no todo-o-nada), para que un
 * admin que solo cambió el logo no pierda los textos por defecto.
 */
export function plantillaReporte({ config = {}, titulo, subtitulo, seccionesHtml, pie, orientacion, tamanoPagina, layout }) {
  const cfg = { ...CONFIG_REPORTE_DEFAULT, ...config };

  // Defensa en profundidad: aunque la tabla ya tiene un CHECK constraint
  // limitando color_clase a un enum fijo, no confiar ciegamente en que el
  // valor que llegó del cliente pasó por ahí (podría venir de un mock de
  // test, un fallback mal armado, etc.) — si no es una clase conocida, cae
  // al default en vez de emitir una clase arbitraria en el HTML.
  const colorClase = CLASES_COLOR_VALIDAS.has(cfg.color_clase) ? cfg.color_clase : CONFIG_REPORTE_DEFAULT.color_clase;
  const paginaClase = resolverClasePagina(tamanoPagina, orientacion);
  const bodyClase = paginaClase ? `${colorClase} ${paginaClase}` : colorClase;

  // Fase 3: mismo ancho de "lienzo" que ve el admin en el editor de
  // TabPlantillas.jsx -- si esto y ese ancho difieren, el bloque se
  // vería en un lugar distinto al que el admin arrastró.
  const anchoMm = anchoContenidoMm(tamanoPagina, orientacion);
  const membreteWrapperStyle = layout?.bloques ? ` style="position:relative;height:${ALTURA_MEMBRETE_MM}mm"` : "";
  const pieWrapperStyle = layout?.bloques ? ` style="position:relative;height:${ALTURA_PIE_MM}mm"` : "";
  const izqStyle = layoutStyleInline(layout?.bloques, "izq", anchoMm, ALTURA_MEMBRETE_MM);
  const derStyle = layoutStyleInline(layout?.bloques, "der", anchoMm, ALTURA_MEMBRETE_MM);
  const pieStyle = layoutStyleInline(layout?.bloques, "pie", anchoMm, ALTURA_PIE_MM);

  const ahora = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });

  // Logo: imagen real si hay una configurada, si no la "letra" de
  // placeholder (primera letra del nombre de institución) — mismo look
  // que tenía el "U" hardcodeado antes, ahora derivado del nombre real.
  const inicial = ESC((cfg.nombre_institucion || "?").trim().charAt(0).toUpperCase() || "?");
  const logoHtml = cfg.logo_base64
    ? `<img class="membrete-logo-img" src="${ESC(cfg.logo_base64)}" alt="${ESC(cfg.nombre_institucion)}" />`
    : `<div class="membrete-logo">${inicial}</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${ESC(titulo)}</title>
  <link rel="stylesheet" href="/reporte-print.css"/>
</head>
<body class="${bodyClase}">
  <div class="membrete"${membreteWrapperStyle}>
    <div class="membrete-izq"${izqStyle}>
      ${logoHtml}
      <div class="membrete-texto">
        <h1>${ESC(cfg.nombre_institucion)}</h1>
        <p>${ESC(cfg.subtitulo_1)}</p>
        <p>${ESC(cfg.subtitulo_2)}</p>
      </div>
    </div>
    <div class="membrete-der"${derStyle}>
      <div>${ESC(titulo)}</div>
      <div class="pdf-subtitulo-valor">${ESC(subtitulo)}</div>
      <div>Generado: ${ahora}</div>
    </div>
  </div>

  ${seccionesHtml}

  <div class="rp-pie-canvas"${pieWrapperStyle}>
    <div class="pie"${pieStyle}>
      <div>${ESC(pie ?? cfg.pie_texto)}</div>
      <div class="firma-bloque">
        <div class="firma-linea"></div>
        <div class="pdf-firma-label">${ESC(cfg.firma_label)}</div>
      </div>
    </div>
  </div>

  <script src="/reporte-print.js"></script>
</body>
</html>`;
}

/** Abre una ventana nueva del mismo origen e imprime el HTML dado.
 *  Común a los 3 documentos — antes duplicado entre exportPDF.js
 *  (abrirVentanaPDF, sin auto-print) y PlanillaImprimibleBase.jsx
 *  (con auto-print vía setTimeout). Se deja el auto-print opcional
 *  porque exportPDF.js nunca lo tuvo (el usuario dispara Ctrl+P o el
 *  botón de imprimir del propio navegador) y no hay que cambiarle ese
 *  comportamiento ya conocido por los usuarios actuales.
 */
export function abrirVentanaImpresion(html, { autoPrint = false } = {}) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  if (autoPrint) { win.focus(); setTimeout(() => win.print(), 400); }
  return true;
}
