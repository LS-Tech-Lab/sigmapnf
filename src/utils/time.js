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

// Fix (bug preexistente, encontrado al investigar un reporte de la grilla
// de Horarios): separa un `hora` tipo "3:15PM-5:30PM" en sus dos partes,
// pero primero corrige el formato compartido "3:15-5:30PM" (sin AM/PM en
// el inicio — atajo común cuando ambas horas caen en el mismo AM/PM,
// típico de carga manual/Excel). Sin esto, `timeToMin("3:15")` no matchea
// el regex (que exige el sufijo AM/PM) y devuelve 0 EN SILENCIO — ese 0 se
// usaba tal cual en countBlocks/findStartBlock, lo que posicionaba la
// clase en el primer bloque del turno (el más "cercano" a medianoche) con
// un span estirado hasta cubrir toda la grilla. Síntoma real reportado:
// al editar y mover UNA clase de día, la clase SIGUIENTE (con este
// formato de hora) se veía "subir" a ocupar toda la columna desde la
// primera fila, aunque su horario real fuera correcto y no hubiera
// cambiado — el bug no era de la clase movida, era de cómo se posicionaba
// la clase con formato de hora irregular que quedaba al lado.
// Fix 2 (caso PNF Agroalimentación, turno "MIXTO"): el atajo de arriba
// asume que inicio y fin caen en el MISMO AM/PM — cierto siempre en
// DIURNO/VESPERTINO porque esos turnos se cortan justo en 12:00/1:00 y
// ningún bloque cruza el mediodía. El turno MIXTO es continuo (7:00am-
// 4:00pm) y SÍ tiene un bloque que cruza el mediodía ("11:30 - 12:15 PM",
// el mismo formato compartido que usa la plantilla institucional para
// TODOS los demás bloques) — con el atajo ciego, "11:30" heredaba el "PM"
// del fin y se leía como 11:30 PM (¡casi medianoche!), mandando la clase
// fuera de la grilla entera. Mismo problema para cualquier rango
// mergeado que cruce el mediodía (ej. "11:30 - 1:45 PM").
//
// Ahora se valida el resultado: el atajo solo se usa si arma un inicio
// ANTES del fin (duración positiva); si no, el inicio real está en el
// AM/PM contrario al del fin.
export function partesHoraNormalizadas(horaStr) {
  if (!horaStr) return ["", ""];
  const parts = horaStr.trim().split(/[-–]/);
  if (parts.length < 2) return [parts[0]?.trim() || "", ""];
  let inicio = parts[0].trim();
  const fin = parts[1].trim();
  if (!/AM|PM/i.test(inicio)) {
    const sufijo = fin.match(/AM|PM/i)?.[0];
    if (sufijo) {
      const candidato = `${inicio}${sufijo}`;
      if (timeToMin(candidato) < timeToMin(fin)) {
        inicio = candidato;
      } else {
        const opuesto = sufijo.toUpperCase() === "PM" ? "AM" : "PM";
        inicio = `${inicio}${opuesto}`;
      }
    }
  }
  return [inicio, fin];
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
  const [inicioStr, finStr] = partesHoraNormalizadas(horaStr);
  if (!finStr) return 1;
  const inicioMin = timeToMin(inicioStr);
  const finMin = timeToMin(finStr);
  if (!finMin || finMin <= inicioMin) return 1;
  return Math.max(1, Math.ceil((finMin - inicioMin) / 45));
}

// Inverso de timeToMin: minutos desde medianoche -> "7:00AM" / "12:15PM"
// (mismo formato compacto que usan BLOQUES_DIURNO/VESPERTINO/MIXTO). Se
// usa para construir filas de grilla dinámicas a partir de horas reales
// (ver buildBloquesDinamicos en turno.js), no solo desde los bloques fijos.
export function minToTime(min) {
  const total = ((min % 1440) + 1440) % 1440; // por si acaso llega negativo
  let hh = Math.floor(total / 60);
  const mi = total % 60;
  const ap = hh >= 12 ? "PM" : "AM";
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(mi).padStart(2, "0")}${ap}`;
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
  const [inicioStr] = partesHoraNormalizadas(d.hora.trim());
  return timeToMin(inicioStr);
}
