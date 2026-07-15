// src/utils/logger.js
//
// CI-2: wrapper centralizado de logging.
//
// Problema que resuelve: llamadas directas a console.log/warn/error
// quedan visibles en la consola del navegador de CUALQUIER usuario en
// producción, exponiendo detalles internos (mensajes de error de
// Supabase, nombres de tablas/RPCs, estructuras de datos).
//
// Mismo criterio que ya usa ErrorBoundary.jsx para el stack trace:
// import.meta.env.DEV. En desarrollo (`npm run dev`) se comporta
// exactamente igual que console.*; en producción, no imprime nada.
//
// El estado de la app (setError, Toast, etc.) NO depende de estas
// llamadas — son puramente diagnósticas — por lo que silenciarlas en
// producción no cambia el comportamiento visible para el usuario.
//
// Fix CI-4: se agregó `info` (faltaba) para los 2 únicos usos de
// console.info que quedaban fuera de este wrapper (src/main.jsx,
// src/utils/cache.js) — mismo patrón que log/warn/error.

const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },
  info: (...args) => {
    if (isDev) console.info(...args);
  },
  warn: (...args) => {
    if (isDev) console.warn(...args);
  },
  error: (...args) => {
    if (isDev) console.error(...args);
  },
};

export default logger;
