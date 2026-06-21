// Modal de confirmación reutilizable (borrar datos, restaurar backup, etc).
// Extraído de useAppData.js.

import { useState, useCallback } from "react";

export default function useConfirmModal() {
  const [confirmModal, setConfirmModal] = useState(null);

  const openConfirm = useCallback(({ title, message, confirmLabel, danger, onConfirm }) => {
    setConfirmModal({ title, message, confirmLabel, danger, onConfirm });
  }, []);

  const closeConfirm = useCallback(() => setConfirmModal(null), []);

  return { confirmModal, openConfirm, closeConfirm };
}
