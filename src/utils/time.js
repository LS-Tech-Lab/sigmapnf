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
