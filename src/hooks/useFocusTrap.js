// useFocusTrap.js
// UX-3: hook reutilizable que atrapa el foco de teclado dentro de un modal
// mientras está abierto. Generaliza el patrón que ya usaba ConfirmModal
// (useEffect + document.addEventListener) agregando el manejo de Tab /
// Shift+Tab para que el foco no escape al contenido detrás del overlay.
//
// Uso:
//   const dialogRef = useRef(null);
//   useFocusTrap(dialogRef, open);
//   <div ref={dialogRef} role="dialog">...</div>

import { useEffect } from "react";

const SELECTOR_FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function useFocusTrap(containerRef, isOpen) {
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const container = containerRef.current;

    const getFocusable = () =>
      Array.from(container.querySelectorAll(SELECTOR_FOCUSABLE)).filter(
        (el) => el.offsetParent !== null // ignora elementos ocultos
      );

    const handleKeyDown = (e) => {
      if (e.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activo = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab en el primer elemento → ir al último
        if (activo === first || !container.contains(activo)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab en el último elemento → volver al primero
        if (activo === last || !container.contains(activo)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, containerRef]);
}
