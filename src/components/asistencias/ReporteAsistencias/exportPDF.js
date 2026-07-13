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
  // El <\/script> de más abajo escapa la barra a propósito (defensivo: evita
  // que </script> corte el bloque si este archivo se embebiera crudo dentro
  // de un <script> HTML real). eslint-disable/enable en vez de un
  // eslint-disable-next-line: la línea real está dentro de un template
  // literal de muchas líneas, así que un comentario JS no puede insertarse
  // ahí sin volverse parte del HTML generado — solo puede ir por fuera del
  // literal completo.
  /* eslint-disable no-useless-escape */
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${ESC(titulo)}</title>
  <style>
    @page { size: A4 landscape; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #1a1a1a; margin: 0; }

    /* ── Membrete ── */
    .membrete {
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 3px solid #1E3A8A; padding-bottom: 10px; margin-bottom: 12px;
    }
    .membrete-izq { display: flex; align-items: center; gap: 14px; }
    .membrete-logo {
      width: 52px; height: 52px; border-radius: 50%;
      background: linear-gradient(135deg, #1E3A8A, #2563EB);
      display: flex; align-items: center; justify-content: center;
      font-size: 22pt; font-weight: 900; color: #fff; flex-shrink: 0;
    }
    .membrete-texto h1 { margin: 0; font-size: 13pt; color: #1E3A8A; }
    .membrete-texto p  { margin: 2px 0 0; font-size: 8.5pt; color: #555; }
    .membrete-der { text-align: right; font-size: 8.5pt; color: #555; line-height: 1.6; }

    /* ── Subtítulo del reporte ── */
    .subtitulo {
      background: #EFF6FF; border-left: 4px solid #2563EB;
      padding: 7px 12px; border-radius: 0 6px 6px 0;
      font-size: 10pt; font-weight: 700; color: #1D4ED8;
      margin-bottom: 14px;
    }

    /* ── Sección ── */
    .seccion-titulo {
      font-size: 9pt; font-weight: 700; color: #374151;
      text-transform: uppercase; letter-spacing: 0.06em;
      margin: 14px 0 6px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px;
    }

    /* ── Tablas ── */
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 6px; }
    th { background: #1E3A8A; color: #fff; padding: 5px 8px; text-align: left; font-weight: 700; }
    td { padding: 4px 8px; border-bottom: 1px solid #E5E7EB; vertical-align: middle; }
    tr:nth-child(even) td { background: #F8FAFC; }
    .badge-completo  { background: #DCFCE7; color: #166534; padding: 1px 6px; border-radius: 4px; font-size: 7.5pt; font-weight: 700; }
    .badge-entrada   { background: #FEF3C7; color: #92400E; padding: 1px 6px; border-radius: 4px; font-size: 7.5pt; font-weight: 700; }
    .badge-ausente   { background: #FEE2E2; color: #991B1B; padding: 1px 6px; border-radius: 4px; font-size: 7.5pt; font-weight: 700; }

    /* ── Estadísticas ── */
    .stats { display: flex; gap: 10px; margin-bottom: 12px; }
    .stat-box {
      flex: 1; border: 1px solid #E5E7EB; border-radius: 6px;
      padding: 8px 12px; text-align: center;
    }
    .stat-num  { font-size: 18pt; font-weight: 900; line-height: 1; }
    .stat-lbl  { font-size: 7.5pt; color: #555; margin-top: 2px; }

    /* ── Pie y firma ── */
    .pie {
      margin-top: 20px; display: flex;
      justify-content: space-between; align-items: flex-end;
      font-size: 8pt; color: #555;
    }
    .firma-bloque { text-align: center; }
    .firma-linea  { border-top: 1px solid #111; width: 200px; margin: 40px auto 4px; }

    @media print { button { display: none !important; } }
  </style>
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
      <div style="font-weight:700;color:#1E3A8A">${ESC(subtitulo)}</div>
      <div>Generado: ${ahora}</div>
    </div>
  </div>

  ${seccionesHtml}

  <div class="pie">
    <div>${ESC(pie)}</div>
    <div class="firma-bloque">
      <div class="firma-linea"></div>
      <div style="font-size:8pt;color:#374151">Firma y sello del Coordinador(a)</div>
    </div>
  </div>

  <script>window.onload = () => window.print();<\/script>
</body>
</html>`;
  /* eslint-enable no-useless-escape */
}

export function exportarPDFDiario(docentesAgrupados, fecha, turno, programa, ausentes = []) {
  const turnoLabel = turno === "TODOS" ? "Todos los turnos" : turno.charAt(0) + turno.slice(1).toLowerCase();
  const conSalida  = docentesAgrupados.filter(d => d.estado === "completo").length;
  const soloEntrad = docentesAgrupados.filter(d => d.estado === "solo_entrada").length;
  const total      = docentesAgrupados.length;

  const statsHtml = `
    <div class="stats">
      <div class="stat-box"><div class="stat-num" style="color:#2563EB">${total}</div><div class="stat-lbl">Presentes</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#059669">${conSalida}</div><div class="stat-lbl">Entrada y salida</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#D97706">${soloEntrad}</div><div class="stat-lbl">Solo entrada</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#DC2626">${ausentes.filter(a => !a.sinVincular).length}</div><div class="stat-lbl">Ausentes</div></div>
    </div>`;

  const filasPresentes = docentesAgrupados.map(d => {
    const badge = d.estado === "completo"
      ? `<span class="badge-completo">Entrada y Salida</span>`
      : `<span class="badge-entrada">Solo Entrada</span>`;
    return `<tr>
      <td style="font-family:monospace;font-weight:700;color:#1D4ED8">${ESC(d.cedula)}</td>
      <td style="font-weight:600">${ESC(d.nombre)}</td>
      <td>${badge}</td>
      <td style="font-weight:600">${FMT_HORA(d.horaEntrada)}</td>
      <td style="font-weight:600">${FMT_HORA(d.horaSalida)}</td>
      <td style="color:#555">${ESC(d.programa?.replace("PNF ", "") || "—")}</td>
    </tr>`;
  }).join("");

  const tablaPresentes = `
    <div class="seccion-titulo">Docentes presentes (${total})</div>
    <table>
      <thead><tr>
        <th>Cédula</th><th>Nombre docente</th><th>Estado</th>
        <th>Entrada</th><th>Salida</th><th>Programa</th>
      </tr></thead>
      <tbody>${filasPresentes || `<tr><td colspan="6" style="text-align:center;color:#888;padding:16px">Sin registros</td></tr>`}</tbody>
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
        <td style="font-weight:600">${ESC(a.nombre)}</td>
        <td style="font-family:monospace;color:#DC2626;font-weight:700">${ESC(a.cedula)}</td>
        <td style="color:#555;font-size:7.5pt">${ESC(clases)}</td>
        <td style="color:#555">${ESC(a.programa?.replace("PNF ", "") || "—")}</td>
      </tr>`;
    }).join("");
    tablaAusentes = `
      <div class="seccion-titulo" style="color:#991B1B">Ausentes con cédula vinculada (${ausentesConf.length})</div>
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
    const color = pct >= 75 ? "#059669" : pct >= 50 ? "#D97706" : "#DC2626";
    return `<tr>
      <td style="font-family:monospace;font-weight:700;color:#1D4ED8">${ESC(d.cedula)}</td>
      <td style="font-weight:600">${ESC(d.nombre)}</td>
      <td style="text-align:center;font-weight:700">${d.diasAsistidos}</td>
      <td style="text-align:center">${diasHabiles}</td>
      <td style="text-align:center;font-weight:800;color:${color}">${pct}%</td>
      <td style="text-align:center">~${d.horasEstimadas}h</td>
      <td style="color:#555;font-size:8pt">${ESC(d.programas?.join(" / ") || "—")}</td>
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
      <tbody>${filas || `<tr><td colspan="7" style="text-align:center;color:#888;padding:16px">Sin registros</td></tr>`}</tbody>
    </table>`;

  abrirVentanaPDF(plantilla({
    titulo:       "Reporte de Asistencia por Rango",
    subtitulo:    `${turnoLabel} · ${FMT_FECHA(inicio)} al ${FMT_FECHA(fin)}`,
    seccionesHtml,
    pie:          `Total docentes: ${docentes.length} · Días hábiles en rango: ${diasHabiles}`,
  }));
}
