// playwright.config.js
//
// Fix UX-11 (auditoría 12 de julio): captura de regresión visual automatizada
// en CI. Objetivo original de la auditoría: detectar si un cambio futuro
// rompe el layout responsive en pantallas chicas — la mayoría de los 24
// archivos CSS sin `@media` se apoyan hoy en `flex-wrap`/`overflow-x: auto`
// (verificado como válido en `UX-9`), pero eso no tiene forma automática de
// confirmarse si alguien lo cambia sin darse cuenta.
//
// Alcance de esta primera entrega: SOLO la pantalla de login (no requiere
// sesión ni datos de Supabase para su estado inicial). QR scan y selector de
// módulos quedan pendientes — ambos requieren sesión autenticada, y decidir
// cómo simular esa sesión en tests (¿usuario de prueba real contra un
// proyecto Supabase de staging? ¿mock del cliente de Supabase?) es una
// decisión de alcance que no se tomó unilateralmente aquí. Ver nota al
// final de `docs/AUDITORIA_INDICE.md` (entrada de `UX-11`).
//
// IMPORTANTE — no verificado end-to-end en el entorno de trabajo: este
// sandbox no tiene salida de red hacia cdn.playwright.dev, así que no se
// pudo descargar Chromium para correr esto localmente ni generar las
// imágenes base (`*.png` de snapshot). La primera corrida en GitHub Actions
// (que sí tiene salida a internet) va a fallar con "no baseline found" —
// es el comportamiento esperado de Playwright, no un bug. Ver instrucciones
// al final de este archivo para generar y commitear las imágenes base.

import { defineConfig, devices } from '@playwright/test';

// Fix UX-35 (auditoría de estrés operacional, 10 de agosto): 2 cambios—
//   1. Proyecto 'desktop-webkit-1280': mismo breakpoint que 'desktop-1280'
//      pero contra WebKit (motor de Safari) en vez de Chromium. Antes solo
//      se probaba contra un único motor de renderizado — relevante porque
//      una fracción no trivial de usuarios accede desde iOS/Safari, y las
//      diferencias de renderizado de formularios/inputs entre Chromium y
//      WebKit son una fuente común de bugs de UX que este suite no
//      capturaba. Corre los MISMOS 3 specs de tests/visual/, necesita sus
//      propias imágenes base (ver instrucciones al final del archivo,
//      mismo procedimiento que para Chromium, con
//      `npx playwright install --with-deps webkit`).
//   2. Proyecto 'a11y': corre SOLO tests/visual/a11y.spec.js (axe-core,
//      ver ese archivo) — se separa de los proyectos de snapshot visual
//      porque no compara imágenes (no necesita 3 breakpoints × N specs,
//      correrlo una vez alcanza) y porque un fallo de accesibilidad no
//      debería reportarse mezclado con un diff de píxeles.
// Los 3 proyectos de snapshot visual originales se acotan con `testMatch`
// a los specs que sí comparan imágenes, para que a11y.spec.js no corra
// (y falle sin sentido, por no tener screenshot que comparar) 3 veces de
// más dentro de cada uno.
const VISUAL_SPECS = ['login.spec.js', 'module-selector.spec.js', 'qr-scan.spec.js'];

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
      testMatch: VISUAL_SPECS,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'tablet-768',
      testMatch: VISUAL_SPECS,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop-1280',
      testMatch: VISUAL_SPECS,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    // Fix UX-35: mismo breakpoint que desktop-1280, motor WebKit.
    {
      name: 'desktop-webkit-1280',
      testMatch: VISUAL_SPECS,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    // Fix UX-35: axe-core, no compara screenshots — un solo proyecto,
    // un solo motor, alcanza para el objetivo (detectar regresiones de
    // estructura/semántica accesible, no de renderizado pixel a pixel).
    {
      name: 'a11y',
      testMatch: ['a11y.spec.js'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});

// ── Cómo generar las imágenes base (hacerlo UNA vez, LS, no en cada PR) ────
//
// 1. En una máquina/entorno CON salida a internet (tu laptop, o un run
//    manual de GitHub Actions con `workflow_dispatch`):
//      npx playwright install --with-deps chromium webkit
//      npx playwright test --update-snapshots
// 2. Revisar visualmente los .png generados en tests/visual/__screenshots__/
//    (que de verdad se vea como el login real, no una pantalla rota) —
//    ahora incluye variantes '-desktop-webkit-1280.png' además de las de
//    Chromium (fix UX-35), revisar esas también antes de commitear.
// 3. Commitear esas imágenes al repo. A partir de ahí, cada PR las compara
//    contra ese estado "bueno conocido" en vez de generarlas de nuevo.
//
// El proyecto 'a11y' (fix UX-35) no necesita este paso — axe-core no
// compara contra una imagen base, corre y falla directo si encuentra una
// violación crítica/seria. Corre con `npm run test:a11y` (separado de
// `npm run test:visual`, que solo corre los 3 proyectos de snapshot de
// Chromium — ver ci.yml: ambos pasos nuevos, WebKit y a11y, arrancan con
// `continue-on-error: true` hasta graduar a bloqueantes).
