/**
 * useAppData — estado y operaciones centrales de la aplicación: carga de
 * horarios, nombres de docentes/materias, edición, backup/restauración,
 * carga de Excel, conflictos, toasts y modal de confirmación.
 *
 * Este archivo orquesta sub-hooks que viven divididos en:
 *   - useToast.js            notificaciones tipo toast
 *   - useConfirmModal.js     modal de confirmación reutilizable
 *   - useNombresCache.js     nombres display de programas/docentes/materias
 *   - useDataSync.js         fetch de horarios, offline, realtime, derivados
 *   - useUpload.js           carga de Excel
 *   - nameEditing.js         edición/unificación de nombres (no es un hook)
 *   - backupActions.js       backup, restauración y borrado (no es un hook)
 *
 * La API pública que devuelve este hook es idéntica a la del useAppData.js
 * original: ningún componente que lo consume necesita cambiar.
 */

import { useState, useEffect, useCallback } from "react";
import { validarVersionCache } from "../../utils/cache";
import useConflictos from "../useConflictos";

import useToast from "./useToast";
import useConfirmModal from "./useConfirmModal";
import useNombresCache from "./useNombresCache";
import useDataSync from "./useDataSync";
import useUpload from "./useUpload";
import { createNameEditingActions } from "./nameEditing";
import { createHorarioEditingActions } from "./horarioEditing";
import { createBackupActions } from "./backupActions";

export default function useAppData(lapso, logAudit = null, userId = null) {
  useEffect(() => { validarVersionCache(); }, []);

  const [selectedPrograma, setSelectedPrograma] = useState("todos");
  const [conflictsRefreshKey, setConflictsRefreshKey] = useState(0);

  const { toast, showToast, hideToast } = useToast();
  const { confirmModal, openConfirm, closeConfirm } = useConfirmModal();

  const {
    programasDisponibles, docenteNames, docenteCedulas, docenteCedulaFuentes, materiaNames,
    setDocenteNames, setDocenteCedulas, setMateriaNames,
    fetchProgramas, fetchDocenteNames, fetchMateriaNames, invalidarCacheDocentes,
    getDocName, getDocCedula, getDocCedulaFuente, getMateriaName,
  } = useNombresCache(userId, showToast);

  const {
    data, loading, setLoading, isSyncing, error, setError,
    isOffline, lastSync, fetchHorarios,
    byDocente, byMateria, allTrayectos, stats,
  } = useDataSync({
    lapso, selectedPrograma, showToast,
    fetchDocenteNames, fetchMateriaNames, fetchProgramas,
    setConflictsRefreshKey,
    userId,
  });

  const { conflicts, usingFallback: usingFallbackConflicts, refetchConflictos } = useConflictos({
    lapso, selectedPrograma, data, refreshKey: conflictsRefreshKey,
  });

  const { saveDocenteName, saveDocenteCedula: saveDocenteCedulaBase, saveMateriaName } = createNameEditingActions({
    logAudit, showToast, selectedPrograma, setDocenteNames, setMateriaNames,
    fetchDocenteNames, fetchMateriaNames, fetchHorarios, setConflictsRefreshKey,
  });

  // Envuelve saveDocenteCedula para actualizar el estado local de cédulas
  // aquí mismo (nameEditing.js no tiene acceso directo a setDocenteCedulas
  // de useNombresCache, así que devuelve el valor y lo aplicamos acá).
  const saveDocenteCedula = useCallback(async (rawName, cedula) => {
    const res = await saveDocenteCedulaBase(rawName, cedula);
    if (res.success) {
      setDocenteCedulas(prev => {
        const next = { ...prev };
        if (res.cedulaLimpia) next[rawName] = res.cedulaLimpia; else delete next[rawName];
        return next;
      });
    }
    return res;
  }, [saveDocenteCedulaBase, setDocenteCedulas]);

  // UX-14: edición/borrado in-line de bloques de horario desde TurnoGrid.
  const { saveClase, deleteClase } = createHorarioEditingActions({
    logAudit, showToast, fetchHorarios, selectedPrograma,
  });

  const { uploading, setUploading, handleFileUpload, previewData, cancelPreview, confirmPreview } = useUpload({
    lapso, selectedPrograma, showToast, setError,
    fetchHorarios, fetchProgramas, fetchDocenteNames, fetchMateriaNames, invalidarCacheDocentes,
    setConflictsRefreshKey,
    logAudit,
  });

  const { clearAllData, exportarDatos, importarDatos: importarDatosBase } = createBackupActions({
    lapso, selectedPrograma, showToast, openConfirm, closeConfirm,
    setLoading, fetchHorarios, fetchProgramas, fetchDocenteNames, fetchMateriaNames,
    logAudit,
  });

  // Misma firma pública que el useAppData.js original: importarDatos(file).
  // setUploading se inyecta aquí para que backupActions.js no necesite
  // conocer el estado de useUpload.
  const importarDatos = useCallback((file) => {
    importarDatosBase(file, { setUploading });
  }, [importarDatosBase, setUploading]);

  return {
    loading, isSyncing, uploading, error, selectedPrograma, setSelectedPrograma,
    programasDisponibles, data, docenteNames, docenteCedulas, docenteCedulaFuentes, materiaNames,
    byDocente, byMateria, conflicts, usingFallbackConflicts, refetchConflictos, stats, allTrayectos,
    isOffline, lastSync, toast, showToast, hideToast,
    confirmModal, openConfirm, closeConfirm,
    handleFileUpload, exportarDatos, importarDatos, clearAllData,
    previewData, cancelPreview, confirmPreview,
    saveDocenteName, saveDocenteCedula, saveMateriaName, getDocName, getDocCedula, getDocCedulaFuente, getMateriaName,
    saveClase, deleteClase,
    logAudit,
  };
}
