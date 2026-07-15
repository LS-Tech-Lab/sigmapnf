// Motor de exportación a PDF del módulo de Reporte de Asistencias.
// Sin librerías externas: abre ventana nueva con HTML/CSS y window.print().

const ESC = s => String(s ?? "—")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FMT_FECHA = iso => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const FMT_HORA = iso => iso
  ? new Date(iso).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
  : "—";

function abrirVentanaPDF(html) {
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

function plantilla({ titulo, subtitulo, seccionesHtml, pie }) {
  const ahora = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
  // Fix (14 de julio): el <style>/<script> de esta plantilla iban inline.
  // El CSP del proyecto usa `script-src 'self'` y `style-src 'self'` (sin
  // 'unsafe-inline' — ver SEC-3/UX-5 en AUDITORIA_INDICE.md), y esta ventana
  // emergente (about:blank del mismo origen, ver abrirVentanaPDF) hereda
  // ese CSP. El navegador bloqueaba ambos bloques en silencio: el reporte
  // se veía como HTML sin estilos (texto plano) y no se disparaba la
  // impresión automática. Servidos como archivos externos desde
  // `public/` (mismo origen), `'self'` sí los permite — ver
  // reporte-print.css / reporte-print.js. NO volver a inlinearlos aquí.
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${ESC(titulo)}</title>
  <link rel="stylesheet" href="/reporte-print.css"/>
</head>
<body>
  <div class="membrete">
    <div class="membrete-izq">
      <div class="membrete-logo">U</div>
      <div class="membrete-texto">
        <h1>UNERMB</h1>
        <p>Programas Nacionales de Formación</p>
        <p>Control de Asistencia Docente</p>
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
    <div>${ESC(pie)}</div>
    <div class="firma-bloque">
      <div class="firma-linea"></div>
      <div class="pdf-firma-label">Firma y sello del Coordinador(a)</div>
    </div>
  </div>

  <script src="/reporte-print.js"></script>
</body>
</html>`;
}

export function exportarPDFDiario(docentesAgrupados, fecha, turno, programa, ausentes = []) {
  const turnoLabel = turno === "TODOS" ? "Todos los turnos" : turno.charAt(0) + turno.slice(1).toLowerCase();
  const conSalida  = docentesAgrupados.filter(d => d.estado === "completo").length;
  const soloEntrad = docentesAgrupados.filter(d => d.estado === "solo_entrada").length;
  const total      = docentesAgrupados.length;

  const statsHtml = `
    <div class="stats">
      <div class="stat-box"><div class="stat-num stat-num--azul">${total}</div><div class="stat-lbl">Presentes</div></div>
      <div class="stat-box"><div class="stat-num stat-num--verde">${conSalida}</div><div class="stat-lbl">Entrada y salida</div></div>
      <div class="stat-box"><div class="stat-num stat-num--ambar">${soloEntrad}</div><div class="stat-lbl">Solo entrada</div></div>
      <div class="stat-box"><div class="stat-num stat-num--rojo">${ausentes.filter(a => !a.sinVincular).length}</div><div class="stat-lbl">Ausentes</div></div>
    </div>`;

  const filasPresentes = docentesAgrupados.map(d => {
    const badge = d.estado === "completo"
      ? `<span class="badge-completo">Entrada y Salida</span>`
      : `<span class="badge-entrada">Solo Entrada</span>`;
    return `<tr>
      <td class="td-cedula">${ESC(d.cedula)}</td>
      <td class="td-bold">${ESC(d.nombre)}</td>
      <td>${badge}</td>
      <td class="td-bold">${FMT_HORA(d.horaEntrada)}</td>
      <td class="td-bold">${FMT_HORA(d.horaSalida)}</td>
      <td class="td-muted">${ESC(d.programa?.replace("PNF ", "") || "—")}</td>
    </tr>`;
  }).join("");

  const tablaPresentes = `
    <div class="seccion-titulo">Docentes presentes (${total})</div>
    <table>
      <thead><tr>
        <th>Cédula</th><th>Nombre docente</th><th>Estado</th>
        <th>Entrada</th><th>Salida</th><th>Programa</th>
      </tr></thead>
      <tbody>${filasPresentes || `<tr><td colspan="6" class="td-empty">Sin registros</td></tr>`}</tbody>
    </table>`;

  let tablaAusentes = "";
  const ausentesConf = ausentes.filter(a => !a.sinVincular);
  if (ausentesConf.length > 0) {
    const filas = ausentesConf.map(a => {
      const clases = a.clases.map(c => {
        const mat = c.clase?.split("|")?.[0]?.trim() || c.clase;
        return `${mat} (${c.sheet} · ${c.hora})`;
      }).join(", ");
      return `<tr>
        <td class="td-bold">${ESC(a.nombre)}</td>
        <td class="td-cedula-ausente">${ESC(a.cedula)}</td>
        <td class="td-muted-sm">${ESC(clases)}</td>
        <td class="td-muted">${ESC(a.programa?.replace("PNF ", "") || "—")}</td>
      </tr>`;
    }).join("");
    tablaAusentes = `
      <div class="seccion-titulo seccion-titulo--rojo">Ausentes con cédula vinculada (${ausentesConf.length})</div>
      <table>
        <thead><tr><th>Nombre</th><th>Cédula</th><th>Clases asignadas</th><th>Programa</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>`;
  }

  const seccionesHtml = `
    <div class="subtitulo">${ESC(turnoLabel)} · ${FMT_FECHA(fecha)}${programa ? " · " + programa : ""}</div>
    ${statsHtml}
    ${tablaPresentes}
    ${tablaAusentes}`;

  abrirVentanaPDF(plantilla({
    titulo:       "Reporte Diario de Asistencia",
    subtitulo:    `${turnoLabel} · ${FMT_FECHA(fecha)}`,
    seccionesHtml,
    pie:          `Total presentes: ${total} · Ausentes confirmados: ${ausentesConf.length}`,
  }));
}

export function exportarPDFRango(docentes, inicio, fin, turno, diasHabiles) {
  const turnoLabel = turno === "TODOS" ? "Todos los turnos" : turno.charAt(0) + turno.slice(1).toLowerCase();

  const filas = docentes.map(d => {
    const pct = diasHabiles > 0 ? Math.round((d.diasAsistidos / diasHabiles) * 100) : 0;
    const pctClase = pct >= 75 ? "td-pct--alta" : pct >= 50 ? "td-pct--media" : "td-pct--baja";
    return `<tr>
      <td class="td-cedula">${ESC(d.cedula)}</td>
      <td class="td-bold">${ESC(d.nombre)}</td>
      <td class="td-center-bold">${d.diasAsistidos}</td>
      <td class="td-center">${diasHabiles}</td>
      <td class="td-pct ${pctClase}">${pct}%</td>
      <td class="td-center">~${d.horasEstimadas}h</td>
      <td class="td-muted-8">${ESC(d.programas?.join(" / ") || "—")}</td>
    </tr>`;
  }).join("");

  const seccionesHtml = `
    <div class="subtitulo">${ESC(turnoLabel)} · ${FMT_FECHA(inicio)} al ${FMT_FECHA(fin)}</div>
    <div class="seccion-titulo">Resumen por docente (${docentes.length})</div>
    <table>
      <thead><tr>
        <th>Cédula</th><th>Nombre</th><th>Días asist.</th>
        <th>Días hábiles</th><th>% Asistencia</th><th>Horas est.</th><th>Programa(s)</th>
      </tr></thead>
      <tbody>${filas || `<tr><td colspan="7" class="td-empty">Sin registros</td></tr>`}</tbody>
    </table>`;

  abrirVentanaPDF(plantilla({
    titulo:       "Reporte de Asistencia por Rango",
    subtitulo:    `${turnoLabel} · ${FMT_FECHA(inicio)} al ${FMT_FECHA(fin)}`,
    seccionesHtml,
    pie:          `Total docentes: ${docentes.length} · Días hábiles en rango: ${diasHabiles}`,
  }));
}
