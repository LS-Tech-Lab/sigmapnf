// Edición y borrado in-line de bloques de horario (UX-14).
// No es un hook: es una fábrica de funciones, mismo patrón que
// nameEditing.js — recibe sus dependencias ya resueltas desde
// useAppData/index.js.
//
// RLS ya exige puedeEditarHorarios/puedeBorrarHorarios a nivel de base de
// datos (migración 0045) para UPDATE/DELETE sobre `horarios`; el gating de
// permisos en la UI (ver HorariosLayout.jsx) es una segunda barrera de UX,
// no la única defensa.

import { supabase } from "../../lib/supabase";
import { logger } from "../../utils/logger";
// Fix SEC-38 (auditoría de estrés operacional, 10 de agosto): las 2
// concatenaciones de error.message de abajo bypasseaban el filtro de
// errorMessages.js.
import { mensajeAmigable } from "../../utils/errorMessages";

export function createHorarioEditingActions({ logAudit, showToast, fetchHorarios, selectedPrograma }) {
  // payload esperado: { dia, hora, aula, trayecto?, docente_id, materia_id, clase }
  // `clase` se reescribe con el mismo formato "<materia>\nProf. <docente>"
  // que ya reconoce parseClase() (estrategia 1, separador de salto de
  // línea), para que las pantallas que leen el texto crudo de `clase`
  // directamente (GlobalSearch, PlanillaImprimibleBase, VistaAusentes,
  // ConflictosView, historialUtils, SeccionesView) queden consistentes con
  // el docente/materia elegidos en el modal, sin tener que tocar esas 6
  // pantallas.
  //
  // Fix ARCH-29 (auditoría 2 ago): `expectedUpdatedAt` es el valor de
  // `updated_at` con el que ModalEditarClase cargó el formulario (viene de
  // la fila `entry` ya en memoria, no de una consulta nueva). Si se pasa,
  // el UPDATE se condiciona a que nadie más haya tocado la fila desde
  // entonces (`.eq("updated_at", expectedUpdatedAt)`) — bloqueo optimista,
  // sin locks ni tablas nuevas. La columna la refresca un trigger
  // server-side (migración 0057), el cliente nunca la escribe.
  //
  // Si `expectedUpdatedAt` no llega (undefined/null — ej. una fila cargada
  // antes de que `updated_at` existiera en caché, o un caller futuro que
  // todavía no lo pasa) se degrada al comportamiento anterior: UPDATE sin
  // condición extra, para no bloquear guardados legítimos por un dato que
  // no se tiene. El guard es una mejora incremental, no un requisito duro.
  const saveClase = async (id, payload, expectedUpdatedAt) => {
    try {
      let query = supabase.from("horarios").update(payload).eq("id", id);
      if (expectedUpdatedAt) {
        query = query.eq("updated_at", expectedUpdatedAt);
      }
      // .select("id") obliga a la consulta a devolver las filas realmente
      // afectadas por el UPDATE — es lo que permite distinguir "se guardó"
      // de "el WHERE no matcheó ninguna fila" (0 filas ≠ error en Postgres/
      // PostgREST: un UPDATE que no toca nada no es un error).
      const { data, error } = await query.select("id");

      if (error) {
        showToast("Error al guardar: " + mensajeAmigable(error), "error");
        return { success: false };
      }

      // Con guard activo (expectedUpdatedAt) y 0 filas devueltas: alguien
      // más editó (o borró) esta fila entre que se abrió el formulario y
      // se confirmó el guardado. En vez de sobreescribir en silencio,
      // se avisa y se recarga con el estado real — ver UX-24.
      if (expectedUpdatedAt && (!data || data.length === 0)) {
        showToast(
          "Otro usuario modificó esta clase mientras la editabas. Se recargó con los datos más recientes — tu cambio no se guardó, intenta de nuevo.",
          "warning"
        );
        await fetchHorarios(selectedPrograma);
        return { success: false, conflict: true };
      }

      showToast("Clase actualizada.", "success");
      logAudit?.({
        accion: "EDITAR_HORARIO",
        entidad: "horarios",
        resumen: `Horario #${id} editado (día ${payload.dia}, ${payload.hora}${payload.aula ? `, aula ${payload.aula}` : ""})`,
      });
      await fetchHorarios(selectedPrograma);
      return { success: true };
    } catch (err) {
      logger.error("saveClase:", err);
      showToast("Error al guardar: " + mensajeAmigable(err), "error");
      return { success: false };
    }
  };

  const deleteClase = async (id, resumen) => {
    try {
      const { error } = await supabase.from("horarios").delete().eq("id", id);
      if (error) {
        showToast("Error al eliminar: " + mensajeAmigable(error), "error");
        return { success: false };
      }
      showToast("Clase eliminada.", "success");
      logAudit?.({ accion: "BORRAR_HORARIO", entidad: "horarios", resumen: resumen || `Horario #${id} eliminado` });
      await fetchHorarios(selectedPrograma);
      return { success: true };
    } catch (err) {
      logger.error("deleteClase:", err);
      showToast("Error al eliminar: " + err.message, "error");
      return { success: false };
    }
  };

  return { saveClase, deleteClase };
}
