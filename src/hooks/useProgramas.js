/**
 * useProgramas.js
 *
 * Carga el catálogo de programas (tabla `programas`, migración 0090)
 * ordenado por `orden`. Mismo patrón exacto que useSedes.js: solo
 * dispara el fetch cuando hay una sesión autenticada (la política RLS
 * de `programas` exige 'authenticated', igual que `sedes` desde 0061 --
 * sin esta guarda, el primer fetch en el montaje de <App/> vuelve con 0
 * filas sin error, y sin re-disparo tras el login, queda vacío el resto
 * de la sesión del navegador).
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

export default function useProgramas(userId) {
  const [programas, setProgramas] = useState([]);
  const [loadingProgramas, setLoadingProgramas] = useState(true);

  const cargar = useCallback(async () => {
    if (!userId) {
      setProgramas([]);
      setLoadingProgramas(false);
      return;
    }
    setLoadingProgramas(true);
    const { data, error } = await supabase
      .from("programas")
      .select("id, nombre, activa, orden")
      .order("orden", { ascending: true });

    if (error) {
      console.error("useProgramas: error al cargar catálogo de programas", error);
      setProgramas([]);
    } else {
      setProgramas((data || []).filter(p => p.activa));
    }
    setLoadingProgramas(false);
  }, [userId]);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { programas, loadingProgramas, refetchProgramas: cargar };
}
