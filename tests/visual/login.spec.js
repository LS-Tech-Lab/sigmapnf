// tests/visual/login.spec.js
//
// Fix U-10 (auditoría 12 de julio): regresión visual de la pantalla de
// login en los 3 breakpoints definidos en playwright.config.js. No
// requiere sesión ni datos de Supabase — es la pantalla que ve cualquiera
// que abre la app sin loguearse.

import { test, expect } from '@playwright/test';

test.describe('Login screen', () => {
  test.beforeEach(async ({ page }) => {
    // Fresh state: sin PIN offline guardado, sin sesión previa. Si la
    // suite corre dos veces en la misma sesión de browser (retries),
    // localStorage/IndexedDB podría tener resto de una corrida anterior.
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
  });

  test('estado inicial (formulario normal, sin bloqueo)', async ({ page }) => {
    // Espera al formulario real en vez de un timeout fijo — la pantalla
    // pasa primero por "full-screen-loading" mientras useAuth resuelve
    // getSession(). Si este selector no existe, hay que ajustarlo al
    // input real de LoginFormNormal.jsx antes de confiar en el screenshot.
    const emailInput = page.getByLabel(/correo|email/i).first();
    await expect(emailInput).toBeVisible({ timeout: 15_000 });

    // Evita capturar el parpadeo del cursor en el input si algo le dio foco.
    await page.locator('body').click({ position: { x: 5, y: 5 } });

    await expect(page).toHaveScreenshot('login-inicial.png', {
      fullPage: true,
    });
  });
});
