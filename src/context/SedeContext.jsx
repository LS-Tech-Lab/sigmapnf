/**
 * SedeContext — provee la sede activa de la sesión (SEDE-2) a todo el
 * árbol de módulos (Horarios / Asistencias / Admin) sin prop drilling.
 * Mismo patrón que AppDataContext (ARCH-8).
 *
 * Uso:
 *   // En App.jsx (productor), envolviendo los 3 módulos:
 *   <SedeProvider value={{ sedeActiva, sedes, setSedeActiva, refetchSedes }}>
 *     ...
 *   </SedeProvider>
 *
 *   // En cualquier componente hijo (consumidor):
 *   const { sedeActiva, sedes } = useSedeContext();
 *
 * SEDE-17: `refetchSedes` (de useSedes.js) se agrega al value para que
 * `GestionSedes.jsx` (Sistema → Sedes) pueda refrescar el catálogo en
 * todo el árbol después de crear/editar/(des)activar una sede, sin
 * depender de que el usuario recargue la página.
 */

import { createContext, useContext } from "react";

const SedeContext = createContext(null);

/** Provee { sedeActiva, sedes, setSedeActiva, refetchSedes } al árbol. */
export function SedeProvider({ value, children }) {
  return (
    <SedeContext.Provider value={value}>
      {children}
    </SedeContext.Provider>
  );
}

/** Hook de consumo — lanza si se usa fuera del Provider. */
export function useSedeContext() {
  const ctx = useContext(SedeContext);
  if (ctx === null) {
    throw new Error("useSedeContext debe usarse dentro de <SedeProvider>");
  }
  return ctx;
}
