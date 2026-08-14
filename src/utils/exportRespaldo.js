// ADMIN-3 (12 ago): respaldo automático previo a borrados administrativos
// destructivos (auditoría, asistencias por rango, sesiones QR). Antes cada
// borrado ("Borrar rango" en ReporteRango, "Borrar seleccionados" en
// TabSesiones/TabAuditoria) no dejaba ningún respaldo local si el admin no
// pulsaba el botón CSV por separado. Este util centraliza la descarga
// dual CSV+JSON y se llama SIEMPRE antes de confirmar un borrado, no como
// paso opcional.
//
// JSON además del CSV porque el CSV pierde estructura anidada (ej.
// datos_antes/datos_despues de audit_logs) — el JSON es el respaldo fiel,
// el CSV es para abrir rápido en una hoja de cálculo.

function descargarBlob(contenido, tipoMime, nombreArchivo) {
  // Defensivo: la descarga es un efecto secundario del respaldo, no debe
  // poder tumbar el flujo de borrado que la invoca (ver
  // exportarRespaldoPrevioABorrado) si el navegador/entorno no soporta
  // URL.createObjectURL por alguna razón.
  try {
    const blob = new Blob([contenido], { type: tipoMime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(`No se pudo generar el respaldo "${nombreArchivo}":`, e);
  }
}

// Convierte un array de objetos planos a CSV. Los valores objeto/array
// (ej. datos_antes JSONB) se serializan como JSON dentro de la celda en
// vez de romper las columnas.
function aCSV(filas) {
  if (!filas || filas.length === 0) return "";
  const headers = Object.keys(filas[0]);
  const lineas = filas.map(fila =>
    headers.map(h => {
      const v = fila[h];
      const texto = v === null || v === undefined ? "" :
        (typeof v === "object" ? JSON.stringify(v) : String(v));
      return `"${texto.replace(/"/g, '""')}"`;
    }).join(",")
  );
  return [headers.join(","), ...lineas].join("\n");
}

// Descarga un respaldo CSV + JSON de `filas` con el mismo nombre base.
// `filas`: array de objetos planos (los registros que se van a borrar).
// `nombreBase`: sin extensión, ej. "auditoria_2026-08-12_seleccion".
export function exportarRespaldoPrevioABorrado(filas, nombreBase) {
  if (!filas || filas.length === 0) return;

  const csv = aCSV(filas);
  descargarBlob("\uFEFF" + csv, "text/csv;charset=utf-8;", `${nombreBase}.csv`);

  const json = JSON.stringify(filas, null, 2);
  descargarBlob(json, "application/json;charset=utf-8;", `${nombreBase}.json`);
}
