// Motor de exportación a PDF del módulo de Reporte de Asistencias.
// No usa librerías externas: abre una ventana nueva con HTML/CSS impreso
// vía window.print(). Extraído de ReporteAsistencias.jsx.

// ── MEJORA #10: motor de PDF (sin librerías externas) ────────────────────────
function abrirVentanaPDF({ titulo, subtitulo, columnas, filas, pie }) {
  const esc = s => String(s ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><title>${esc(titulo)}</title>
<style>
  @page{size:A4 landscape;margin:18mm 14mm}
  body{font-family:Arial,sans-serif;font-size:10pt;color:#111}
  .hdr{text-align:center;margin-bottom:16px;border-bottom:2px solid #1E3A8A;padding-bottom:10px}
  .hdr h1{margin:0 0 4px;font-size:14pt;color:#1E3A8A}.hdr p{margin:0;font-size:9pt;color:#555}
  table{width:100%;border-collapse:collapse;font-size:9pt}
  th{background:#1E3A8A;color:#fff;padding:6px 8px;text-align:left}
  td{padding:5px 8px;border-bottom:1px solid #E5E7EB}
  tr:nth-child(even) td{background:#F8FAFC}
  .ftr{margin-top:24px;display:flex;justify-content:space-between;font-size:9pt;color:#555}
  .firma{margin-top:48px;border-top:1px solid #111;width:200px;padding-top:4px;font-size:8pt}
  @media print{button{display:none}}
</style></head><body>
<div class="hdr"><h1>UNERMB · PNF · ${esc(titulo)}</h1><p>${esc(subtitulo)}</p></div>
<table><thead><tr>${columnas.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${filas.map(f => `<tr>${f.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
<div class="ftr">
  <div>Generado: ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}</div>
  <div>${esc(pie)}</div>
</div>
<div class="firma">Firma y sello del coordinador</div>
<script>window.onload=()=>window.print()<\/script>
</body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

export function exportarPDFDiario(docentesAgrupados, fecha, turno, programa) {
  const columnas = ["Cédula", "Nombre docente", "Estado", "Entrada", "Salida", "Programa"];
  const filas = docentesAgrupados.map(d => [
    d.cedula, d.nombre,
    d.estado === "completo" ? "Entrada y Salida" : d.estado === "solo_entrada" ? "Solo Entrada" : "Solo Salida",
    d.horaEntrada ? new Date(d.horaEntrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) : "—",
    d.horaSalida  ? new Date(d.horaSalida).toLocaleTimeString("es-VE",  { hour: "2-digit", minute: "2-digit" }) : "—",
    d.programa?.replace("PNF ", "") || "—",
  ]);
  const [y, m, dd] = fecha.split("-");
  abrirVentanaPDF({
    titulo:    `Control de Asistencia – ${turno}`,
    subtitulo: `Fecha: ${dd}-${m}-${y}${programa ? " · " + programa : ""}`,
    columnas, filas,
    pie: `Total docentes: ${docentesAgrupados.length}`,
  });
}

export function exportarPDFRango(docentes, inicio, fin, turno, diasHabiles) {
  const columnas = ["Cédula", "Nombre", "Días asistidos", "Días hábiles", "% Asistencia", "Horas est.", "Programa(s)"];
  const filas = docentes.map(d => {
    const pct = diasHabiles > 0 ? Math.round((d.diasAsistidos / diasHabiles) * 100) : 0;
    return [d.cedula, d.nombre, d.diasAsistidos, diasHabiles, `${pct}%`, `~${d.horasEstimadas}h`, d.programas.join(" / ") || "—"];
  });
  const fmt = iso => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
  abrirVentanaPDF({
    titulo:    `Reporte de Asistencia – ${turno}`,
    subtitulo: `Período: ${fmt(inicio)} al ${fmt(fin)}`,
    columnas, filas,
    pie: `Total docentes: ${docentes.length} · Días hábiles en rango: ${diasHabiles}`,
  });
}
