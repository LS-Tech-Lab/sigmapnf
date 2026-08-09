/**
 * AppDataContext — provee el resultado de useAppData a todo el árbol de
 * HorariosLayout sin prop drilling.
 *
 * ARCH-42: Provider + hook de consumo en el mismo archivo es el patrón
 * estándar de React Context — separarlos no aporta nada y solo afecta
 * Fast Refresh en desarrollo.
 *
 * Uso:
 *   // En App.jsx (productor):
 *   <AppDataProvider value={appDataAuditada}>
 *     <HorariosLayout ... />
 *   </AppDataProvider>
 *
 *   // En cualquier componente hijo (consumidor):
 *   const appData = useAppDataContext();
 */

import { createContext, useContext } from "react";

const AppDataContext = createContext(null);

/** Provee el objeto appData al árbol. Recibe el valor ya construido externamente. */
/* eslint-disable react-refresh/only-export-components */
export function AppDataProvider({ value, children }) {
  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}

/** Hook de consumo — lanza si se usa fuera del Provider. */
export function useAppDataContext() {
  const ctx = useContext(AppDataContext);
  if (ctx === null) {
    throw new Error("useAppDataContext debe usarse dentro de <AppDataProvider>");
  }
  return ctx;
}
