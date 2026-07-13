/**
 * useAppShell.js
 *
 * Estado de UI del shell de la aplicación. Agrupa:
 *
 *  - Sidebar: hovered, pinned (persistido en localStorage), mobileOpen, adminOpen
 *  - Modales globales: userMenuOpen, cambiarPwdOpen
 *  - Detección de Supabase caído (Fix #19): si user sigue en `undefined`
 *    tras 8 s, marca supabaseDown = true para mostrar la pantalla de error.
 *  - Confirmación de cambio de correo: detecta el redirect de Supabase y
 *    emite un toast de éxito a través de showToast al resolverse.
 *
 * El estado de navegación interna (view, lapso, docenteNav…) vive en App.jsx
 * porque lo necesita directamente HorariosLayout vía props.
 */

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function useAppShell({ user, showToast }) {
  // ── Sidebar ────────────────────────────────────────────────────────────────
  const [hovered,    setHovered]    = useState(false);
  const [pinned,     setPinned]     = useState(
    () => localStorage.getItem("sb_pinned") === "1"
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminOpen,  setAdminOpen]  = useState(false);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem("sb_pinned", next ? "1" : "0");
  };

  // ── Modales globales ───────────────────────────────────────────────────────
  const [userMenuOpen,   setUserMenuOpen]   = useState(false);
  const [cambiarPwdOpen, setCambiarPwdOpen] = useState(false);

  // ── Fix #19: Supabase caído / anon key expirada ───────────────────────────
  const [supabaseDown, setSupabaseDown] = useState(false);

  useEffect(() => {
    if (user !== undefined) return;
    const id = setTimeout(() => {
      if (user === undefined) setSupabaseDown(true);
    }, 8000);
    return () => clearTimeout(id);
  }, [user]);

  // ── Confirmación de cambio de correo (redirect de Supabase) ───────────────
  // Supabase redirige a la app sin params después de verificar el token.
  // Detectamos el redirect comparando el email de la sesión activa con el
  // email pendiente guardado en localStorage al solicitar el cambio.
  // El toast se lanza aquí (no en un useEffect anidado en App) tan pronto
  // como showToast esté disponible y el estado sea "success".
  const [emailChangeStatus, setEmailChangeStatus] = useState(null); // null | "success"
  const [emailChangePending, setEmailChangePending] = useState(null); // null | string (email nuevo)

  // Paso 1: al montar, verificar si hay un cambio de correo pendiente
  useEffect(() => {
    const pendingEmail = localStorage.getItem("sigma_email_change_pending");
    if (!pendingEmail) return;

    (async () => {
      const { data: refreshData } = await supabase.auth.refreshSession();
      const sessionEmail = refreshData?.session?.user?.email?.toLowerCase();
      if (sessionEmail && sessionEmail === pendingEmail) {
        localStorage.removeItem("sigma_email_change_pending");
        setEmailChangeStatus("success");
        setEmailChangePending(refreshData?.session?.user?.email ?? "");
      }
    })();
  }, []); // solo al montar

  // Paso 2: lanzar el toast cuando showToast ya esté disponible
  useEffect(() => {
    if (emailChangeStatus === "success" && showToast && emailChangePending) {
      showToast("¡Correo actualizado! Tu nuevo correo es: " + emailChangePending, "success");
      setEmailChangeStatus(null);
      setEmailChangePending(null);
    }
  }, [emailChangeStatus, showToast, emailChangePending]);

  return {
    // Sidebar
    hovered, setHovered,
    pinned, togglePin,
    mobileOpen, setMobileOpen,
    adminOpen, setAdminOpen,
    // Modales
    userMenuOpen, setUserMenuOpen,
    cambiarPwdOpen, setCambiarPwdOpen,
    // Estado de servicio
    supabaseDown, setSupabaseDown,
  };
}
