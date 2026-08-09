// useInstallPrompt.js — ADMIN-7 (mejora "PWA completa" para /scan y la
// proyección QR): hook compartido para exponer un botón "Instalar app"
// en vez de depender de que el docente/operador encuentre el menú del
// navegador por su cuenta.
//
// Chrome/Edge/Android disparan `beforeinstallprompt` cuando la página
// cumple los criterios de instalabilidad (manifest válido + SW activo);
// el evento se captura UNA vez y se reutiliza para disparar el prompt
// nativo bajo demanda (con un clic del usuario, nunca automático).
//
// iOS Safari NUNCA dispara ese evento — no existe API programática para
// instalar. `esIOS` se expone aparte para que el caller muestre
// instrucciones manuales ("Compartir → Agregar a inicio") en vez de un
// botón que ahí nunca haría nada.
import { useState, useEffect, useCallback } from "react";

function yaInstalada() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari: única forma de detectar modo standalone, no estándar
    // pero soportada desde siempre en WebKit.
    window.navigator?.standalone === true
  );
}

export default function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState(null);
  const [instalada, setInstalada] = useState(yaInstalada);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      // Evita el mini-infobar automático del navegador — el prompt solo
      // se dispara cuando el usuario toca nuestro botón.
      e.preventDefault();
      setDeferredEvent(e);
    };
    const onInstalled = () => {
      setInstalada(true);
      setDeferredEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const instalar = useCallback(async () => {
    if (!deferredEvent) return false;
    deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    // El evento capturado es de un solo uso — tanto si acepta como si
    // rechaza, hay que esperar un `beforeinstallprompt` nuevo para
    // volver a ofrecerlo (el navegador no lo reemite en la misma sesión
    // tras un rechazo reciente).
    setDeferredEvent(null);
    return outcome === "accepted";
  }, [deferredEvent]);

  const esIOS =
    typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  return {
    puedeInstalar: !!deferredEvent && !instalada,
    instalada,
    esIOS: esIOS && !instalada,
    instalar,
  };
}
