/**
 * useSedes.js
 *
 * Carga el catálogo de sedes (tabla `sedes`, migración 0061) ordenado
 * por `orden`. Solo lectura — altas/bajas de sedes no son parte de
 * SEDE-1/SEDE-2, se gestionan directo en la BD por ahora.
 *
 * Recibe `userId` y solo dispara el fetch cuando hay una sesión
 * autenticada (SEDE-7) — sin esto, el fetch se disparaba en el primer
 * montaje de <App/>, antes del login, con el cliente de Supabase todavía
 * como rol 'anon'. La política RLS de `sedes` exige 'authenticated', así
 * que ese primer intento volvía con 0 filas sin ningún error (una
 * denegación de RLS no lanza excepción, solo no matchea filas), y como
 * no había redisparo tras el login, `sedes` quedaba vacío para toda la
 * sesión del navegador.
 */

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function useSedes(userId) {
  const [sedes, setSedes] = useState([]);
  const [loadingSedes, setLoadingSedes] = useState(true);

  useEffect(() => {
    // SEDE-7: sin esperar userId, este efecto se disparaba en el primer
    // montaje de <App/> -- ANTES del login, mientras el cliente de
    // Supabase todavía pega como rol 'anon'. La política RLS de `sedes`
    // exige 'authenticated', así que ese primer fetch volvía con 0 filas
    // SIN error (una denegación de RLS no es un error, es "0 filas"
    // coincidiendo la condición). Como las deps estaban vacías, el efecto
    // nunca se repetía una vez el login terminaba de resolver -- `sedes`
    // quedaba pegado en [] el resto de esa carga de página. Ahora se
    // condiciona a que exista una sesión autenticada, y se vuelve a
    // ejecutar si userId cambia (login/logout/cambio de cuenta).
    if (!userId) {
      setSedes([]);
      setLoadingSedes(false);
      return;
    }

    let cancelado = false;
    setLoadingSedes(true);
    (async () => {
      const { data, error } = await supabase
        .from("sedes")
        .select("id, nombre, activa, orden")
        .order("orden", { ascending: true });

      if (cancelado) return;
      if (error) {
        // No hay una vía de fallo distinta a "lista vacía" acá: si esto
        // falla, el selector de sede simplemente no tiene opciones para
        // mostrar. Se loguea para no tragarse el error en silencio.
        console.error("useSedes: error al cargar catálogo de sedes", error);
        setSedes([]);
      } else {
        setSedes((data || []).filter(s => s.activa));
      }
      setLoadingSedes(false);
    })();
    return () => { cancelado = true; };
  }, [userId]);

  return { sedes, loadingSedes };
}
