// vitest.config.js
// Configuración de tests para SIGMA.
// - environment 'node' por defecto; los tests que necesitan DOM usan
//   el comentario // @vitest-environment jsdom en el propio archivo.
// - __mocks__ para supabase y cache: useAuth.js los importa al nivel
//   de módulo, pero los tests de calcularPermisos() solo ejercitan la
//   función pura — las llamadas a Supabase nunca se ejecutan.

import { defineConfig } from "vitest/config";

export default defineConfig({
  // F3: el primer test de integración que renderiza un componente
  // completo (PestanaUsuarios) reveló que vitest.config.js, al no
  // incluir @vitejs/plugin-react (a diferencia de vite.config.js, que
  // sí lo usa para la app real), transformaba JSX en modo clásico por
  // defecto — rompía en componentes como shared.jsx que no importan
  // React explícitamente porque nunca lo necesitaron con el runtime
  // automático. Esto solo afecta cómo se transforman los tests, no el
  // build de producción real (ese sigue pasando por vite.config.js).
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    // Pasar variables de entorno mínimas para que supabase.js no falle
    // al construir el cliente con URL inválida.
    env: {
      VITE_SUPABASE_URL:      "https://placeholder.supabase.co",
      VITE_SUPABASE_ANON_KEY: "placeholder-anon-key",
    },
  },
});
