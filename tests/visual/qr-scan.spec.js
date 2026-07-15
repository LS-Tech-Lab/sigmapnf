// tests/visual/qr-scan.spec.js
//
// Fix UX-11 (auditoría 12 de julio): regresión visual de la pantalla que
// ve el docente al escanear el QR — "¿Qué deseas registrar?"
// (Marcar Entrada / Marcar Salida). Es una ruta pública (/scan?token=...),
// no requiere sesión — confirmado en src/App.jsx: `if (pathname === "/scan")
// return <DocenteScan />` corre antes que cualquier guard de auth. Y sin
// datos guardados en localStorage, el propio componente resuelve a este
// paso de forma síncrona sin llamar a Supabase (ver el primer useEffect de
// DocenteScan/index.jsx), así que tampoco hace falta mockear la red acá.

import { test, expect } from '@playwright/test';

test.describe('QR scan — selector de tipo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/scan?token=qa-visual-token');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('pantalla inicial (sin datos guardados en el dispositivo)', async ({ page }) => {
    const btnEntrada = page.getByRole('button', { name: /marcar entrada/i });
    await expect(btnEntrada).toBeVisible({ timeout: 15_000 });

    await expect(page).toHaveScreenshot('qr-scan-inicial.png', {
      fullPage: true,
    });
  });
});
