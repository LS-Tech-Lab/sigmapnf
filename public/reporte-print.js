// Dispara la impresión automática de la ventana de reporte (PDF vía
// window.print()). Extraído de exportPDF.js el 14 de julio por el mismo
// motivo que reporte-print.css: CSP `script-src 'self'` bloquea scripts
// inline, y la ventana emergente de exportPDF.js hereda el CSP del
// documento que la abrió. Ver el comentario completo en reporte-print.css.
// ⚠️ NO volver a inlinear este script dentro de exportPDF.js.
window.onload = () => window.print();
