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
//
// Fix UX-32 (auditoría 6 de agosto): UX-31 solo cubría el mensaje del
// trigger de sede — cualquier otro error de Postgres (violación de
// constraint único, de foreign key) llegaba crudo al toast. Bajo carga
// real (docente duplicado en una carga de Excel, borrado de un registro
// referenciado en otra tabla) un usuario no técnico bajo presión temporal
// no puede actuar sobre "duplicate key value violates unique constraint
// 'horarios_pkey'". Se generaliza el patrón de UX-31 a una lista de reglas
// (match/mensaje) en vez de un solo `if`, conservando la misma filosofía:
// nunca se inventa una traducción para un patrón no cubierto explícitamente
// — el fallback sigue devolviendo el mensaje original tal cual.
const TRADUCCIONES = [
  {
    match: (msg) => msg.includes("no tiene una") && msg.includes("sede fija asignada"),
    mensaje:
      "Tu cuenta no tiene una sede asignada todavía. Contacta a un administrador antes de continuar.",
  },
  {
    match: (msg) => msg.includes("duplicate key value violates unique constraint"),
    mensaje: "Ya existe un registro con esos mismos datos. Verifica antes de guardar de nuevo.",
  },
  {
    match: (msg) => msg.includes("violates foreign key constraint"),
    mensaje:
      "Ese registro está siendo usado por otro dato del sistema y no se puede eliminar todavía.",
  },
];

export function mensajeAmigable(error) {
  const msg = error?.message || "";
  const regla = TRADUCCIONES.find((r) => r.match(msg));
  return regla ? regla.mensaje : msg;
}
