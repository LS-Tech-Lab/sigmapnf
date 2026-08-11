import { logger } from "./logger";

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
// (match/mensaje) en vez de un solo `if`.
//
// Fix SEC-38 (auditoría de estrés operacional, 10 de agosto): hasta acá el
// fallback de un mensaje NO cubierto por ninguna regla era devolver el
// mensaje original de Postgres tal cual — pensado para no inventar
// traducciones sobre casos no verificados, pero eso también significa que
// cualquier error no anticipado (ej. `invalid input syntax for type uuid`
// ante un parámetro de URL manipulado, `permission denied for table X`)
// llega crudo al usuario final, filtrando nombres de tabla/columna/tipo
// internos — fuga de información de esquema de bajo riesgo (OWASP A05)
// ante un intento de reconocimiento, no una vulnerabilidad explotable por
// sí sola. Se agregan 2 reglas nuevas para los patrones más comunes de
// input inválido/permiso denegado, y el fallback deja de ser el mensaje
// crudo: pasa a ser un mensaje genérico accionable, con el mensaje
// original preservado únicamente en logger.warn (visible en desarrollo,
// silenciado en producción — mismo criterio que el resto de logger.js)
// para no perder capacidad de diagnóstico interno.
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
  {
    // Fix SEC-38: input inválido (tipo/formato) — ej. un sede_id o
    // programa_id manipulado a mano en la URL/DevTools que no es un UUID
    // válido. No revela a qué columna/tipo corresponde.
    match: (msg) => /invalid input (syntax|value) for/.test(msg),
    mensaje: "Uno de los datos enviados tiene un formato inválido. Verifica e intenta de nuevo.",
  },
  {
    // Fix SEC-38: RLS/GRANT rechazando la operación a nivel de BD — no
    // debe confirmar al usuario ni el nombre de la tabla ni si el
    // registro existe, solo que no tiene permiso.
    match: (msg) => /permission denied for/.test(msg),
    mensaje: "No tienes permiso para realizar esta acción.",
  },
];

// Fix SEC-38: mensaje genérico para cualquier error de Postgres/red no
// cubierto por ninguna regla explícita de arriba — reemplaza el fallback
// anterior (mensaje crudo tal cual). El objetivo no es sonar más amigable,
// es dejar de exponer estructura interna de la base de datos ante un
// patrón de error no anticipado.
const MENSAJE_GENERICO =
  "Ocurrió un error al procesar la solicitud. Si el problema persiste, contacta a soporte.";

export function mensajeAmigable(error) {
  const msg = error?.message || "";
  if (!msg) return msg;

  const regla = TRADUCCIONES.find((r) => r.match(msg));
  if (regla) return regla.mensaje;

  // Fix SEC-38: el mensaje original nunca se pierde — queda disponible
  // para diagnóstico en desarrollo (logger.warn, silenciado en
  // producción), pero deja de mostrarse crudo al usuario final.
  logger.warn("mensajeAmigable: patrón de error no traducido:", msg);
  return MENSAJE_GENERICO;
}
