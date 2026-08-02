// reportePlantilla.js — ADMIN-6 (auditoría 1 ago 2026)
//
// Extraído y generalizado de exportPDF.js (que hasta ahora tenía
// "UNERMB"/una "U" de placeholder hardcodeados). Único punto donde se arma
// el membrete HTML de los 3 documentos imprimibles del sistema: Reporte
// Diario, Reporte por Rango (ambos en exportPDF.js) y Planilla Imprimible
// (PlanillaImprimibleBase.jsx, que antes tenía su propia plantilla HTML
// duplicada con estilos <style> INLINE — casi con certeza bloqueados en
// silencio por el mismo CSP `style-src 'self'` que forzó externalizar
// reporte-print.css el 14 de julio, ver ese comentario ahí. Unificar acá
// corrige ese bug latente como efecto colateral, no solo evita la
// duplicación).
//
// Diseñado para ser reusable por futuros documentos institucionales
// (constancias, etc.) — cualquier módulo nuevo que necesite el mismo
// membrete solo tiene que llamar a plantillaReporte() con su propio
// `seccionesHtml`.
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
  color_clase: "rp-color--azul",
};

const CLASES_COLOR_VALIDAS = new Set([
  "rp-color--azul", "rp-color--verde", "rp-color--teal",
  "rp-color--morado", "rp-color--rojo", "rp-color--ambar",
]);

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
export function plantillaReporte({ config = {}, titulo, subtitulo, seccionesHtml, pie }) {
  const cfg = { ...CONFIG_REPORTE_DEFAULT, ...config };

  // Defensa en profundidad: aunque la tabla ya tiene un CHECK constraint
  // limitando color_clase a un enum fijo, no confiar ciegamente en que el
  // valor que llegó del cliente pasó por ahí (podría venir de un mock de
  // test, un fallback mal armado, etc.) — si no es una clase conocida, cae
  // al default en vez de emitir una clase arbitraria en el HTML.
  const colorClase = CLASES_COLOR_VALIDAS.has(cfg.color_clase) ? cfg.color_clase : CONFIG_REPORTE_DEFAULT.color_clase;

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
<body class="${colorClase}">
  <div class="membrete">
    <div class="membrete-izq">
      ${logoHtml}
      <div class="membrete-texto">
        <h1>${ESC(cfg.nombre_institucion)}</h1>
        <p>${ESC(cfg.subtitulo_1)}</p>
        <p>${ESC(cfg.subtitulo_2)}</p>
      </div>
    </div>
    <div class="membrete-der">
      <div>${ESC(titulo)}</div>
      <div class="pdf-subtitulo-valor">${ESC(subtitulo)}</div>
      <div>Generado: ${ahora}</div>
    </div>
  </div>

  ${seccionesHtml}

  <div class="pie">
    <div>${ESC(pie ?? cfg.pie_texto)}</div>
    <div class="firma-bloque">
      <div class="firma-linea"></div>
      <div class="pdf-firma-label">${ESC(cfg.firma_label)}</div>
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
