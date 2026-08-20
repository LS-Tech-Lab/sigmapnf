// useFocusTrap.js
// UX-3: hook reutilizable que atrapa el foco de teclado dentro de un modal
// mientras está abierto. Generaliza el patrón que ya usaba ConfirmModal
// (useEffect + document.addEventListener) agregando el manejo de Tab /
// Shift+Tab para que el foco no escape al contenido detrás del overlay.
//
// UX-65 (auditoría E2E, 19 ago): el hook atrapaba el foco DENTRO del modal
// mientras estaba abierto, pero no lo devolvía a ningún lado al cerrarse
// (por Cancelar, X, Escape o al completar la acción) — un usuario de
// teclado quedaba con el foco perdido en <body>, sin indicación visual de
// dónde retomar la navegación. Mismo hueco que UX-48 ya había identificado
// y corregido puntualmente en AdminMenu.jsx/UserMenu.jsx (dropdowns, con
// un triggerRef pasado a mano); acá se generaliza para los ~12 modales que
// ya usan este hook (ModalUsuario, ModalRol, ModalEditarClase,
// UploadPreviewModal, ModalCambiarPassword, ConfirmModal, etc.) en un solo
// punto, sin tocar cada call site.
//
// Mecanismo: al abrir (isOpen pasa a true), se guarda una referencia al
// elemento que tenía el foco justo antes (document.activeElement) — casi
// siempre el botón que abrió el modal. Al cerrar (isOpen pasa a false, o
// el componente se desmonta con el modal todavía abierto), se le devuelve
// el foco, SOLO si sigue existiendo en el DOM y es enfocable (un modal
// puede cerrarse a la vez que la lista que lo abrió cambia, p. ej. tras
// borrar la fila que tenía el botón — en ese caso no hay a dónde volver,
// y forzar el foco a un elemento desmontado no tiene efecto ni falla).
//
// Uso (sin cambios para los call sites existentes):
//   const dialogRef = useRef(null);
//   useFocusTrap(dialogRef, open);
//   <div ref={dialogRef} role="dialog">...</div>

import { useEffect, useRef } from "react";

const SELECTOR_FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function useFocusTrap(containerRef, isOpen) {
  const elementoDisparadorRef = useRef(null);

  // Efecto separado del trap de Tab: debe correr también en el momento
  // exacto en que isOpen pasa a false (para restaurar el foco), mientras
  // que el trap de abajo simplemente no hace nada si !isOpen. Un solo
  // efecto combinado complicaría el cleanup sin necesidad.
  useEffect(() => {
    if (isOpen) {
      elementoDisparadorRef.current = document.activeElement;
      return;
    }

    // Nota: no se filtra por offsetParent (heurística de "visible" que sí
    // usa getFocusable() más abajo) — un navegador real ya rechaza en
    // silencio .focus() sobre un elemento no enfocable (oculto/deshabilitado),
    // así que el chequeo sería redundante acá; el único caso que importa
    // evitar es apuntar a un nodo que ya no está en el documento.
    const disparador = elementoDisparadorRef.current;
    if (disparador && typeof disparador.focus === "function" && document.body.contains(disparador)) {
      disparador.focus();
    }
    elementoDisparadorRef.current = null;
  }, [isOpen]);

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
