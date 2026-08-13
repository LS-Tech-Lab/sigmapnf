// Paleta institucional (mismo criterio que TRAYECTO_COLORS en constants/index.js:
// hex fijo, no var(--...) -- recharts necesita el valor resuelto para el SVG).
export const CHART_COLORS = [
  "#2563eb", // --brand-500
  "#059669", // --color-success
  "#7C3AED", // --color-role-coord
  "#d97706", // --color-warning
  "#dc2626", // --color-danger (quinto color, ESTAD-2 -- solo un color de paleta, no implica "error")
];

// Resta `n` días a una fecha "YYYY-MM-DD", anclada en UTC -- mismo patrón
// que el cálculo de `lunes` en ReporteRango.jsx, para no reintroducir el
// desfase de timezone que ya se corrigió ahí (fechaHoyVE/utils/time.js).
export function restarDias(fechaStr, n) {
  const d = new Date(`${fechaStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// "2026-08-09" -> "09/08", para las etiquetas del eje X del gráfico de
// tendencia (formato largo sería ilegible con 30 días en pantalla).
export function formatFechaCorta(fechaStr) {
  if (!fechaStr) return "";
  const [, mes, dia] = fechaStr.split("-");
  return `${dia}/${mes}`;
}

// Toma las primeras `n` filas de una serie ya ordenada DESC por el server
// (ver reporte_estadisticas_academicas, 0084) y arma `etiqueta` a partir de
// `labelKey` para el eje de categoría del gráfico de barras -- trunca
// nombres largos para que quepan en el ancho fijo del eje Y.
export function topN(rows, n, valueKey, labelKey) {
  return (rows || []).slice(0, n).map(r => ({
    ...r,
    [valueKey]: Number(r[valueKey] || 0),
    etiqueta: truncar(String(r[labelKey] ?? "—"), 22),
  }));
}

function truncar(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
