// eslint.config.js
// Fix ARCH-16 (auditoría 12 de julio): el proyecto no tenía ningún linter
// configurado — nada revisaba automáticamente reglas de hooks de React,
// variables sin usar, o errores comunes antes de un commit/PR. Se agrega
// ESLint (flat config, formato nativo desde ESLint 9+) con el set mínimo
// que de verdad importa para este proyecto:
//   - `@eslint/js` recommended: errores de JS genéricos (variables no
//     declaradas, comparaciones raras, etc.)
//   - `eslint-plugin-react-hooks`: la única categoría de bug que un linter
//     puede prevenir de forma confiable en una app React con hooks
//     (dependencias de useEffect mal declaradas, hooks condicionales).
//   - `eslint-plugin-react-refresh`: avisa si un archivo de componente
//     exporta además valores no-componente, lo cual rompe Fast Refresh en
//     `vite dev` (no afecta producción, pero sí la experiencia de
//     desarrollo — vale la pena la advertencia).
// Deliberadamente NO se agrega `eslint-plugin-react` completo: sus reglas
// (prop-types, jsx-uses-react, etc.) no aplican a este proyecto — el
// contrato de props ya lo cubre `prop-types` (ARCH-17) directamente en
// cada componente, y el runtime automático de JSX hace innecesario tener
// React en scope.
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default [
  {
    // Nada de esto se audita: build generado, dependencias vendorizadas
    // (el propio xlsx vendorizado en ARCH-13 no es código nuestro), el
    // Service Worker que genera vite-plugin-pwa en cada build, y los
    // artefactos/reportes de Playwright (U-10) — no las imágenes base
    // (esas no son código) sino los reportes HTML/resultados de corrida.
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      'vendor/**',
      'public/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
    ],
  },

  js.configs.recommended,

  // --- Código de navegador: componentes, hooks, utils del frontend ---
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // OJO: no se usa `reactHooks.configs.recommended` — en esta versión
      // (v7) ese preset trae ~15 reglas nuevas pensadas para preparar el
      // código de cara al React Compiler (`set-state-in-effect`, `refs`,
      // `purity`, `immutability`, etc.), varias de las cuales marcan como
      // "error" patrones idiomáticos ya usados y ya auditados en este
      // proyecto (ej. `onTimeoutRef.current = onTimeout` en `useAuth.js`,
      // o llamar a la función de fetch dentro de un `useEffect`). Adoptar
      // ese preset completo hoy habría significado reescribir ~15
      // archivos solo para que el linter pasara, muy por fuera del
      // alcance de este fix (agregar linting, no migrar hacia el React
      // Compiler). Se dejan solo las 2 reglas clásicas y estables, que sí
      // detectan bugs reales sin falsos positivos sobre el código
      // existente.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 'warn' y no 'error': ya hay componentes que exportan constantes
      // junto al componente (ej. metadata de programas). No vale la pena
      // bloquear el build por esto, solo dejarlo visible.
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Los catch(err) sin usar `err` son un patrón real y deliberado en
      // el proyecto (ver ErrorBoundary.jsx, fallbacks de RPC) — no tiene
      // sentido marcarlos como error.
      //
      // `ignoreRestSiblings`: patrón usado en varios lugares del proyecto
      // para omitir campos sensibles/no deseados antes de reenviar un
      // objeto (`const { salt, hash, ...perfil } = entry` en
      // `pinOffline.js`, `const { id, qr_session_id, ...rest } = row` en
      // `backupActions.js`) — la variable "no usada" es justamente el
      // campo que se quiere excluir, no una variable olvidada.
      //
      // `varsIgnorePattern: '^React$'`: con el runtime automático de JSX
      // (`@vitejs/plugin-react`, confirmado en `vitest.config.js`) no
      // hace falta tener `React` en scope para que JSX funcione. Varios
      // archivos igual conservan `import React from 'react'` de antes de
      // esa migración — no son un bug, así que no se marcan como error
      // (tampoco se borran en este fix: no es el alcance de ARCH-16
      // limpiar imports de 15+ archivos no relacionados).
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^React$',
        },
      ],
      // Mismo criterio que en pinOffline.js: `catch (_) {}` vacío a
      // propósito (ignorar que falle `localStorage.removeItem` en modo
      // privado/cuota llena) es un patrón válido, no un bloque olvidado.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // --- Tests (mismo entorno de navegador + globals de test runner) ---
  {
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^React$',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // --- Tests visuales de Playwright (U-10) — runner y globals propios,
  // distintos de Vitest (test/expect vienen de @playwright/test, no hay
  // "describe" global, y corren en Node, no en jsdom) ---
  {
    files: ['tests/visual/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // --- Código de servidor: función serverless de Vercel y scripts de Node ---
  {
    files: ['api/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },

  // --- Configuración de build (vite/vitest), corre en Node ---
  {
    files: ['*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
]
