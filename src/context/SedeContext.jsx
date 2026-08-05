/**
 * SedeContext — provee la sede activa de la sesión (SEDE-2) a todo el
 * árbol de módulos (Horarios / Asistencias / Admin) sin prop drilling.
 * Mismo patrón que AppDataContext (ARCH-8).
 *
 * Uso:
 *   // En App.jsx (productor), envolviendo los 3 módulos:
 *   <SedeProvider value={{ sedeActiva, sedes, setSedeActiva }}>
 *     ...
 *   </SedeProvider>
 *
 *   // En cualquier componente hijo (consumidor):
 *   const { sedeActiva, sedes } = useSedeContext();
 */

import { createContext, useContext } from "react";

const SedeContext = createContext(null);

/** Provee { sedeActiva, sedes, setSedeActiva } al árbol. */
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
