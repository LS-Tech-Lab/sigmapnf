// Backup, restauración y borrado masivo de datos. Extraído de useAppData.js.
// No es un hook: es una fábrica de funciones que recibe las dependencias
// (fetchers, setters, showToast, openConfirm/closeConfirm) ya resueltas por
// useAppData/index.js.

import { supabase } from "../../lib/supabase";
import { limpiarCache } from "../../utils/cache";

export function createBackupActions({
  lapso, selectedPrograma, showToast, openConfirm, closeConfirm,
  setLoading, fetchHorarios, fetchProgramas, fetchDocenteNames, fetchMateriaNames,
}) {
  const clearAllData = () => {
    const scope = selectedPrograma !== "todos" ? `el programa "${selectedPrograma}"` : "TODOS los programas";
    openConfirm({
      title: "Borrar datos",
      message: `Se eliminarán los horarios de ${scope} del trimestre ${lapso || "actual"}. Se recomienda hacer un backup antes. Esta acción no se puede deshacer.`,
      confirmLabel: "Sí, borrar",
      danger: true,
      onConfirm: async () => {
        closeConfirm();
        setLoading(true);

        const programaParam = selectedPrograma !== "todos" ? selectedPrograma : null;
        const { error: rpcError } = await supabase.rpc("borrar_horarios", {
          p_lapso:    lapso    || null,
          p_programa: programaParam,
        });

        if (rpcError) {
          const noExiste = rpcError.code === "PGRST202" || rpcError.message?.includes("Could not find");
          if (noExiste) {
            console.warn("borrar_horarios no disponible, usando DELETE directo:", rpcError.message);
            let query = supabase.from("horarios").delete();
            if (lapso) query = query.eq("lapso", lapso);
            if (selectedPrograma !== "todos") query = query.eq("programa", selectedPrograma);
            else query = query.neq("id", 0);
            const { error: delError } = await query;
            if (delError) { showToast("❌ Error al borrar.", "error"); setLoading(false); return; }
          } else {
            showToast("❌ Error al borrar.", "error");
            setLoading(false);
            return;
          }
        }

        showToast("✅ Datos eliminados.", "success");
        limpiarCache();
        await fetchHorarios(selectedPrograma);
        await fetchProgramas(lapso);
        setLoading(false);
      },
    });
  };

  const exportarDatos = async () => {
    try {
      showToast("📦 Preparando backup...", "info");
      const [horariosRes, docentesRes, materiasRes] = await Promise.all([
        lapso
          ? supabase.from("horarios").select("*").eq("lapso", lapso)
          : supabase.from("horarios").select("*"),
        supabase.from("docentes").select("*"),
        supabase.from("materias").select("*"),
      ]);
      const backup = {
        version: "2.0",
        fecha: new Date().toISOString(),
        lapso: lapso || "todos",
        programa: selectedPrograma,
        horarios: horariosRes.data || [],
        docentes: docentesRes.data || [],
        materias: materiasRes.data || [],
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-horarios-${lapso || "todos"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("✅ Backup descargado correctamente", "success");
    } catch (err) {
      console.error("Error al exportar:", err);
      showToast("❌ Error al crear backup: " + err.message, "error");
    }
  };

  const importarDatos = (file, { setUploading }) => {
    openConfirm({
      title: "Restaurar backup",
      message: "Esto REEMPLAZARÁ todos los datos del trimestre actual con el contenido del archivo. ¿Continuar?",
      confirmLabel: "Sí, restaurar",
      danger: true,
      onConfirm: async () => {
        closeConfirm();
        setUploading(true);
        try {
          const text = await file.text();
          const backup = JSON.parse(text);

          // Validación superficial: claves principales
          if (!backup.horarios || !backup.docentes || !backup.materias)
            throw new Error("El archivo no tiene el formato correcto de backup (faltan claves horarios / docentes / materias)");

          // Validación profunda: deben ser arrays
          if (!Array.isArray(backup.horarios))
            throw new Error("El backup está malformado: 'horarios' no es un array");
          if (!Array.isArray(backup.docentes))
            throw new Error("El backup está malformado: 'docentes' no es un array");
          if (!Array.isArray(backup.materias))
            throw new Error("El backup está malformado: 'materias' no es un array");

          // Validación de campos mínimos en cada registro
          const camposHorario = ["lapso", "programa", "dia", "hora", "clase"];
          const horarioInvalido = backup.horarios.find(
            h => !h || typeof h !== "object" || camposHorario.some(c => !(c in h))
          );
          if (horarioInvalido)
            throw new Error(`Registro de horario inválido o incompleto: ${JSON.stringify(horarioInvalido)}`);

          const horarioConTipoInvalido = backup.horarios.find(
            h => typeof h.dia !== "string" || typeof h.hora !== "string" || typeof h.clase !== "string"
          );
          if (horarioConTipoInvalido)
            throw new Error("Registro de horario con tipos de campo incorrectos (dia / hora / clase deben ser texto)");

          const camposDocente = ["nombre_raw"];
          const docenteInvalido = backup.docentes.find(
            d => !d || typeof d !== "object" || camposDocente.some(c => !(c in d))
          );
          if (docenteInvalido)
            throw new Error(`Registro de docente inválido o incompleto: ${JSON.stringify(docenteInvalido)}`);

          const camposMateria = ["nombre_raw"];
          const materiaInvalida = backup.materias.find(
            m => !m || typeof m !== "object" || camposMateria.some(c => !(c in m))
          );
          if (materiaInvalida)
            throw new Error(`Registro de materia inválido o incompleto: ${JSON.stringify(materiaInvalida)}`);

          const horariosConLapso = backup.horarios.map(h => ({
            ...h, lapso: lapso || h.lapso || null,
          }));

          const { data: rpcData, error: rpcError } = await supabase.rpc("restaurar_backup", {
            p_lapso:    lapso || null,
            p_horarios: horariosConLapso,
            p_docentes: backup.docentes,
            p_materias: backup.materias,
          });

          if (rpcError) {
            const noExiste = rpcError.code === "PGRST202" || rpcError.message?.includes("Could not find");
            if (noExiste) {
              console.warn("restaurar_backup no disponible, usando flujo multi-llamada:", rpcError.message);
              let delQuery = supabase.from("horarios").delete();
              if (lapso) delQuery = delQuery.eq("lapso", lapso);
              else delQuery = delQuery.neq("id", 0);
              await delQuery;
              await supabase.from("docentes").delete().neq("id", 0);
              await supabase.from("materias").delete().neq("id", 0);
              if (horariosConLapso.length > 0) await supabase.from("horarios").insert(horariosConLapso);
              if (backup.docentes.length > 0) await supabase.from("docentes").upsert(backup.docentes, { onConflict: "nombre_raw" });
              if (backup.materias.length > 0) await supabase.from("materias").upsert(backup.materias, { onConflict: "nombre_raw" });
            } else {
              throw new Error(rpcError.message);
            }
          }

          const insertados = rpcData?.horarios_insertados ?? horariosConLapso.length;
          limpiarCache();
          showToast(`✅ Backup restaurado: ${insertados} clases`, "success");
          await fetchHorarios(selectedPrograma);
          await fetchProgramas(lapso);
          await fetchDocenteNames();
          await fetchMateriaNames();
        } catch (err) {
          console.error("Error al importar:", err);
          showToast("❌ Error al restaurar backup: " + err.message, "error");
        } finally {
          setUploading(false);
        }
      },
    });
  };

  return { clearAllData, exportarDatos, importarDatos };
}
