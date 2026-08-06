// UX-31 (auditoría 6 de agosto): el trigger `autocompletar_sede_id` (0063)
// devuelve un mensaje pensado para quien lee la migración, no para un
// coordinador bajo presión en medio de una carga de horarios:
//
//   "No se pudo determinar la sede para esta fila: tu perfil no tiene una
//    sede fija asignada. Si tu rol ve todas las sedes, manda sede_id
//    explícito."
//
// Varios puntos del cliente concatenan `error.message` directo en el toast
// (ver ModalEditarClase.jsx, nameEditing.js). Esta función intercepta ESE
// mensaje puntual y lo traduce; cualquier otro error de Postgres se
// devuelve tal cual, sin inventar traducciones para casos no verificados.
export function mensajeAmigable(error) {
  const msg = error?.message || "";
  if (msg.includes("no tiene una") && msg.includes("sede fija asignada")) {
    return "Tu cuenta no tiene una sede asignada todavía. Contacta a un administrador antes de continuar.";
  }
  return msg;
}
