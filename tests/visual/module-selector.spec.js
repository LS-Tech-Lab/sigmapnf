// tests/visual/module-selector.spec.js
//
// Fix UX-11, opción C (decidida por LS 13-jul-2026): el selector de
// módulos solo se ve con sesión iniciada. En vez de credenciales reales
// (opción A) o un proyecto Supabase de staging (opción B), se mockea el
// cliente de Supabase a nivel de red del navegador — ver
// tests/visual/mockSupabase.js para el detalle y el porqué.

import { test, expect } from '@playwright/test';
import { loginComoFake } from './mockSupabase.js';

test.describe('Selector de módulos (post-login)', () => {
  test.beforeEach(async ({ page }) => {
    await loginComoFake(page);
    await page.goto('/');
  });

  test('con acceso a 2 módulos (Horarios + Asistencias)', async ({ page }) => {
    // "Bienvenido, Prof. Vista Previa" solo aparece una vez que useAuth
    // resolvió la sesión falsa Y el perfil mockeado — buen ancla para
    // saber que no quedamos atascados en un spinner de carga.
    const bienvenida = page.getByText(/bienvenido/i);
    await expect(bienvenida).toBeVisible({ timeout: 15_000 });

    // Confirmación explícita de que el mock dio exactamente 2 módulos y
    // no cayó en auto-selección (que saltearía este selector directo a
    // un módulo) ni en 3 tarjetas por algún permiso de más.
    // Nota: el nombre accesible de cada botón incluye título + descripción
    // larga + "Entrar", así que para el módulo ausente ("admin") se
    // verifica por su clase real (`module-card--admin`, ver
    // src/components/ModuleSelector.jsx) en vez de un regex de texto —
    // un regex ahí habría dado "0 encontrados" siempre, sin importar si
    // el módulo estaba presente o no, por el texto extra alrededor.
    await expect(page.getByRole('button', { name: /gestión de horarios/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /control de asistencias/i })).toBeVisible();
    await expect(page.locator('.module-card--admin')).toHaveCount(0);

    await expect(page).toHaveScreenshot('module-selector-2-modulos.png', {
      fullPage: true,
    });
  });
});
