// playwright.config.js
//
// Fix U-10 (auditoría 12 de julio): captura de regresión visual automatizada
// en CI. Objetivo original de la auditoría: detectar si un cambio futuro
// rompe el layout responsive en pantallas chicas — la mayoría de los 24
// archivos CSS sin `@media` se apoyan hoy en `flex-wrap`/`overflow-x: auto`
// (verificado como válido en `U-8`), pero eso no tiene forma automática de
// confirmarse si alguien lo cambia sin darse cuenta.
//
// Alcance de esta primera entrega: SOLO la pantalla de login (no requiere
// sesión ni datos de Supabase para su estado inicial). QR scan y selector de
// módulos quedan pendientes — ambos requieren sesión autenticada, y decidir
// cómo simular esa sesión en tests (¿usuario de prueba real contra un
// proyecto Supabase de staging? ¿mock del cliente de Supabase?) es una
// decisión de alcance que no se tomó unilateralmente aquí. Ver nota al
// final de `docs/AUDITORIA_INDICE.md` (entrada de `U-10`).
//
// IMPORTANTE — no verificado end-to-end en el entorno de trabajo: este
// sandbox no tiene salida de red hacia cdn.playwright.dev, así que no se
// pudo descargar Chromium para correr esto localmente ni generar las
// imágenes base (`*.png` de snapshot). La primera corrida en GitHub Actions
// (que sí tiene salida a internet) va a fallar con "no baseline found" —
// es el comportamiento esperado de Playwright, no un bug. Ver instrucciones
// al final de este archivo para generar y commitear las imágenes base.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',

  // Snapshots se guardan junto al spec, con el nombre del proyecto
  // (breakpoint) en el nombre de archivo — evita que un diff en mobile
  // pise el de desktop.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',

  // Corre contra el build de producción (vite preview), no el dev server —
  // el dev server no representa lo que de verdad se despliega, y Playwright
  // levanta/apaga el servidor solo.
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  use: {
    baseURL: 'http://localhost:4173',
    // Screenshots deterministas: sin animaciones ni cursor de texto
    // parpadeando a mitad de captura.
    trace: 'retain-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      // Tolerancia deliberada, no cero: el mismo layout en dos runs de CI
      // (misma versión de Chromium, mismo SO) puede diferir en subpíxeles
      // por antialiasing de fuentes — un umbral de 0 produce falsos
      // positivos constantes y entrena al equipo a ignorar el check.
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: 'disabled',
    },
  },

  projects: [
    {
      name: 'mobile-375',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});

// ── Cómo generar las imágenes base (hacerlo UNA vez, LS, no en cada PR) ────
//
// 1. En una máquina/entorno CON salida a internet (tu laptop, o un run
//    manual de GitHub Actions con `workflow_dispatch`):
//      npx playwright install --with-deps chromium
//      npx playwright test --update-snapshots
// 2. Revisar visualmente los .png generados en tests/visual/__screenshots__/
//    (que de verdad se vea como el login real, no una pantalla rota).
// 3. Commitear esas imágenes al repo. A partir de ahí, cada PR las compara
//    contra ese estado "bueno conocido" en vez de generarlas de nuevo.
