// tests/visual/a11y.spec.js
//
// Fix UX-35 (auditoría de estrés operacional, 10 de agosto): hasta acá el
// proyecto tenía cobertura ARIA parcial en el código (~65% de componentes
// .jsx con aria-*/role) pero ninguna verificación automatizada de
// accesibilidad — nada en CI habría detectado una regresión de contraste
// o de estructura semántica. Se agrega axe-core (motor de auditoría WCAG
// usado por Chrome DevTools/Lighthouse) contra las 3 pantallas que ya
// tienen cobertura de regresión visual (UX-11): login, selector de
// módulos y escaneo QR — reusa exactamente el mismo mock de sesión
// (mockSupabase.js) que esos specs, sin credenciales ni red real.
//
// Alcance deliberado: NO es una auditoría de accesibilidad completa de
// las ~94 pantallas del proyecto — es un piloto acotado a los 3 flujos ya
// identificados como críticos (UX-11), igual que el load test de QR
// (ARCH-43) es un piloto de concurrencia, no un test exhaustivo de cada
// endpoint. Ampliar la cobertura a más pantallas es trabajo de
// seguimiento, no algo que deba bloquear este fix.
//
// 'color-contrast' queda deshabilitado a propósito EN LAS 3 PANTALLAS
// DE ARRIBA: axe-core lo calcula sobre una captura estática del DOM y da
// falsos positivos frecuentes con gradientes/overlays semi-transparentes
// (varios ya presentes en el login) — igual que Playwright ya tolera un
// maxDiffPixelRatio > 0 en vez de 0 para las capturas visuales (mismo
// criterio: un chequeo perfeccionista que dispara constantemente entrena
// al equipo a ignorarlo). El resto de las reglas de axe-core (~90,
// incluyendo etiquetas de formulario, roles ARIA inválidos, orden de
// headings, nombres accesibles de botones) sí corren completas.
//
// Fix UX-35 (seguimiento) + UX-39, auditoría UI/UX 14 ago: 2 pantallas
// nuevas del módulo "Sistema" (Admin) — "Usuarios y Roles" y "Sedes y
// Programas" — antes completamente fuera del piloto. Usan
// FAKE_PROFILE_ADMIN (mockSupabase.js) en vez de FAKE_PROFILE, con solo
// permisos admin para que useModuloActivo auto-seleccione el módulo
// directo, sin depender de un click en ModuleSelector para llegar.
// 'color-contrast' SÍ corre completo en estas 2 (a diferencia de las 3
// de arriba): son tablas/formularios planos de fondo blanco sólido, sin
// gradientes ni overlays semi-transparentes — el motivo original del
// falso positivo (login) no aplica acá, así que no hay razón para
// heredar la misma excepción sin verificarla primero.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginComoFake, FAKE_PROFILE_ADMIN } from './mockSupabase.js';

function sinViolacionesGraves(resultados) {
  // 'moderate' se reporta pero no bloquea el build todavía — empezar
  // exigiendo 'critical'/'serious' evita que el primer run falle en CI
  // por un backlog de docenas de hallazgos menores acumulados de golpe.
  // Subir el umbral a 'moderate' es un fix de seguimiento, no parte de
  // este piloto.
  const graves = resultados.violations.filter(
    v => v.impact === 'critical' || v.impact === 'serious'
  );
  if (graves.length > 0) {
    const detalle = graves
      .map(v => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} elemento(s))`)
      .join('\n');
    throw new Error(`Violaciones de accesibilidad (WCAG) críticas/serias:\n${detalle}`);
  }
  return graves;
}

test.describe('Accesibilidad (WCAG, axe-core) — UX-35', () => {
  test('login: sin violaciones críticas/serias', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByLabel(/correo|email/i).first()).toBeVisible({ timeout: 15_000 });

    const resultados = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();
    sinViolacionesGraves(resultados);
  });

  test('selector de módulos (post-login): sin violaciones críticas/serias', async ({ page }) => {
    await loginComoFake(page);
    await page.goto('/');
    await expect(page.getByText(/bienvenido/i)).toBeVisible({ timeout: 15_000 });

    const resultados = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();
    sinViolacionesGraves(resultados);
  });

  test('escaneo QR (/scan, ruta pública): sin violaciones críticas/serias', async ({ page }) => {
    // Mismo flujo/ancla que qr-scan.spec.js: pantalla pública, sin sesión.
    await page.goto('/scan?token=qa-visual-token');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('button', { name: /marcar entrada/i })).toBeVisible({ timeout: 15_000 });

    const resultados = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();
    sinViolacionesGraves(resultados);
  });
});

test.describe('Accesibilidad (WCAG, axe-core) — Sistema/Admin (UX-35 seguimiento, UX-39)', () => {
  test('usuarios y roles (pestaña por defecto): sin violaciones críticas/serias', async ({ page }) => {
    await loginComoFake(page, { perfil: FAKE_PROFILE_ADMIN });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /gestión de usuarios y roles/i })).toBeVisible({ timeout: 15_000 });

    // UX-39: color-contrast SÍ corre acá — fondo blanco sólido, sin los
    // gradientes/overlays que motivaron la excepción en login.
    const resultados = await new AxeBuilder({ page }).analyze();
    sinViolacionesGraves(resultados);
  });

  test('sedes y programas: sin violaciones críticas/serias', async ({ page }) => {
    await loginComoFake(page, { perfil: FAKE_PROFILE_ADMIN });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /gestión de usuarios y roles/i })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /sedes/i }).click();
    await expect(page.getByRole('heading', { name: /sedes y programas/i })).toBeVisible({ timeout: 15_000 });

    const resultados = await new AxeBuilder({ page }).analyze();
    sinViolacionesGraves(resultados);
  });
});
