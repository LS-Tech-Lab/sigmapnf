/**
 * useSedeActiva.js
 *
 * Resuelve la sede activa de la sesión (SEDE-2):
 *   - Perfil con sede fija (la mayoría de los roles): sedeActiva se
 *     auto-asigna a efectivePermisos.sedeAsignada, sin mostrar selector.
 *   - Perfil con puedeVerTodasLasSedes (admin, coordinador general):
 *     puede elegir sede en el dropdown de <ModuleSelector/> (SEDE-18).
 *     La elección se persiste en localStorage por usuario, mismo patrón
 *     que `sigma_ultima_actividad` en useAuth.js — así no hay que
 *     re-elegir sede en cada refresh, pero SÍ se resetea al cambiar de
 *     usuario (mismo criterio que App.jsx resetea view/moduloActivo al
 *     cambiar user.id).
 *
 * No decide nada de RLS/queries — eso es SEDE-3. Esto solo resuelve
 * *cuál* es la sede activa para que el resto de la app la use.
 */

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "sigma_sede_activa";

function leerSedeGuardada(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return raw?.[userId] || null;
  } catch {
    return null;
  }
}

function guardarSede(userId, sedeId) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    raw[userId] = sedeId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  } catch {
    // localStorage no disponible (modo privado, cuota, etc.) — la sede
    // activa sigue funcionando en memoria para esta sesión, solo no
    // sobrevive a un refresh. No es crítico.
  }
}

export default function useSedeActiva({ userId, efectivePermisos }) {
  const puedeElegir = !!efectivePermisos?.puedeVerTodasLasSedes;
  const sedeFija     = efectivePermisos?.sedeAsignada || null;

  const [sedeActiva, setSedeActivaState] = useState(() => {
    if (!puedeElegir) return sedeFija;
    return userId ? leerSedeGuardada(userId) : null;
  });

  // Perfil con sede fija: seguir sedeAsignada siempre, sin selector.
  useEffect(() => {
    if (!puedeElegir) setSedeActivaState(sedeFija);
  }, [puedeElegir, sedeFija]);

  // Cambio de usuario: releer la sede guardada para el usuario nuevo
  // (o null si nunca eligió una) en vez de arrastrar la del anterior.
  useEffect(() => {
    if (puedeElegir) setSedeActivaState(userId ? leerSedeGuardada(userId) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const setSedeActiva = useCallback((sedeId) => {
    setSedeActivaState(sedeId);
    if (userId) guardarSede(userId, sedeId);
  }, [userId]);

  // Solo se debe mostrar el selector cuando el usuario puede elegir Y
  // todavía no hay una sede activa resuelta (primera vez, o localStorage
  // vacío/inaccesible).
  const requiereSeleccion = puedeElegir && !sedeActiva;

  return { sedeActiva, setSedeActiva, requiereSeleccion, puedeElegir };
}
