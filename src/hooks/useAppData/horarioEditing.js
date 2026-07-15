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

export function createHorarioEditingActions({ logAudit, showToast, fetchHorarios, selectedPrograma }) {
  // payload esperado: { dia, hora, aula, trayecto?, docente_id, materia_id, clase }
  // `clase` se reescribe con el mismo formato "<materia>\nProf. <docente>"
  // que ya reconoce parseClase() (estrategia 1, separador de salto de
  // línea), para que las pantallas que leen el texto crudo de `clase`
  // directamente (GlobalSearch, PlanillaImprimibleBase, VistaAusentes,
  // ConflictosView, historialUtils, SeccionesView) queden consistentes con
  // el docente/materia elegidos en el modal, sin tener que tocar esas 6
  // pantallas.
  const saveClase = async (id, payload) => {
    try {
      const { error } = await supabase.from("horarios").update(payload).eq("id", id);
      if (error) {
        showToast("Error al guardar: " + error.message, "error");
        return { success: false };
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
      showToast("Error al guardar: " + err.message, "error");
      return { success: false };
    }
  };

  const deleteClase = async (id, resumen) => {
    try {
      const { error } = await supabase.from("horarios").delete().eq("id", id);
      if (error) {
        showToast("Error al eliminar: " + error.message, "error");
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
