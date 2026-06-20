export function timeToMin(s) {
  if (!s) return 0;
  const m = s.replace(/\s/g, "").match(/^(\d+):(\d+)(AM|PM)$/i);
  if (!m) return 0;
  let hh = parseInt(m[1]), mi = parseInt(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && hh !== 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  return hh * 60 + mi;
}

// FIX (fecha-hoy-timezone):
// Varios archivos calculaban "hoy" con `new Date().toISOString().slice(0,10)`,
// que da la fecha en UTC, NO en hora de Venezuela (America/Caracas, UTC-4).
// Venezuela está 4 horas detrás de UTC, así que entre las 8:00pm y la
// medianoche (hora de Venezuela), UTC ya cambió de día — `hoy` calculaba
// la fecha de MAÑANA en vez de la de hoy.
//
// Síntoma real reportado: en "Configuración de la sesión" (Panel QR), el
// selector de fecha usa `min={hoy}` — si `hoy` se adelantó un día por este
// bug, el día real de hoy quedaba ANTES del mínimo permitido (bloqueado en
// el calendario), mientras que el día siguiente (el que el sistema creía
// que era "hoy") sí se podía seleccionar. Por eso un sábado se veía
// bloqueado pero el domingo sí estaba disponible: dependía de a qué hora
// de la noche se abriera el panel.
//
// Esta función usa el nombre de zona horaria IANA ("America/Caracas") en
// vez de matemática manual de offset, para quedar protegida ante cualquier
// cambio futuro de huso horario y ser consistente con horaActualVE() en
// AdminQRPanel.jsx, que ya usa el mismo enfoque.
export function fechaHoyVE() {
  // en-CA formatea como YYYY-MM-DD, igual que el formato que usan los
  // <input type="date"> y las columnas `fecha` de la base de datos.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
}

export function countBlocks(horaStr) {
  if (!horaStr) return 1;
  const parts = horaStr.trim().split(/[-–]/);
  if (parts.length < 2) return 1;
  const inicioMin = timeToMin(parts[0].trim());
  const finMin = timeToMin(parts[1].trim());
  if (!finMin || finMin <= inicioMin) return 1;
  return Math.max(1, Math.ceil((finMin - inicioMin) / 45));
}

export function getHoraDisplayDeRegistro(d) {
  if (!d || !d.hora) return "—";
  const horaStr = d.hora.trim();
  const parts = horaStr.split(/[-–]/);
  if (parts.length >= 2) {
    const inicio = parts[0].trim().replace(/(\d)(AM|PM)/gi, '$1 $2');
    const fin = parts[1].trim().replace(/(\d)(AM|PM)/gi, '$1 $2');
    return `${inicio} – ${fin}`;
  }
  return horaStr.replace(/(\d)(AM|PM)/gi, '$1 $2');
}

export function getHoraMin(d) {
  if (!d || !d.hora) return 0;
  return timeToMin(d.hora.trim().split(/[-–]/)[0].trim());
}
