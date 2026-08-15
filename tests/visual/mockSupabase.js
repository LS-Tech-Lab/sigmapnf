// tests/visual/mockSupabase.js
//
// Fix UX-11, opción C (decidida por LS 13-jul-2026): mockear el cliente de
// Supabase en el navegador del test en vez de usar un usuario de prueba
// real (opción A) o un proyecto Supabase de staging (opción B). Sin
// credenciales de ningún tipo en CI, sin red externa, mismo patrón que ya
// usa `DocenteScan.flow.test.jsx` en Vitest — pero mockeado a nivel HTTP
// (page.route) en vez de a nivel de módulo (vi.mock), porque Playwright
// corre en un browser real contra el build de producción, no puede
// interceptar el import de "../lib/supabase" como hace Vitest.
//
// ÚNICA FUENTE DE VERDAD para el shape de la sesión/perfil falsos que usan
// los specs que necesitan estar "logueados". Si el esquema de
// `user_profiles`/`roles` cambia, actualizar acá — no en cada spec.

// storageKey real de supabase-js v2 para VITE_SUPABASE_URL=
// https://placeholder.supabase.co: `sb-${hostname.split('.')[0]}-auth-token`.
// Confirmado leyendo node_modules/@supabase/supabase-js/dist/umd/supabase.js
// en vez de adivinarlo — un valor equivocado acá hace que getSession() no
// encuentre nada y todo el spec caiga silenciosamente de vuelta al login.
export const SUPABASE_STORAGE_KEY = 'sb-placeholder-auth-token';

const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001';

export const FAKE_SESSION = {
  access_token: 'fake-access-token-para-tests-visuales',
  token_type: 'bearer',
  expires_in: 3600,
  // Un año en el futuro — evita que supabase-js intente refrescar el
  // token contra la red (que no existe en este contexto mockeado).
  expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
  refresh_token: 'fake-refresh-token-para-tests-visuales',
  user: {
    id: FAKE_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'qa-visual@sigmapnf.test',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  },
};

// Perfil con permisos que dan acceso a exactamente 2 módulos
// (puedeVerTodo → Horarios, puedeGestionarQR → Asistencias) — así
// useModuloActivo NO auto-selecciona uno solo y el ModuleSelector se
// muestra siempre, de forma determinista. Ver src/hooks/useModuloActivo.js.
export const FAKE_PROFILE = {
  id: FAKE_USER_ID,
  nombre: 'Prof. Vista Previa',
  email: 'qa-visual@sigmapnf.test',
  programa: null,
  activo: true,
  rol: 'qa_visual',
  rol_info: {
    nombre: 'qa_visual',
    label: 'QA Visual',
    emoji: '🧪',
    color: '#4f46e5',
    restringe_programa: false,
    permisos: {
      puedeVerTodo: true,
      puedeGestionarQR: true,
    },
  },
};

// Fix UX-35 (seguimiento, auditoría UI/UX 14 ago): perfil separado para
// cubrir el módulo "Sistema" (Admin) en el piloto de a11y — antes acotado
// a login/selector/escaneo QR (las 3 pantallas de UX-11), dejando afuera
// todos los paneles de administración. Deliberadamente SOLO con permisos
// admin (sin puedeVerTodo/puedeGestionarQR): así useModuloActivo
// auto-selecciona directo al módulo "admin" (único acceso), sin depender
// de un click en ModuleSelector para llegar — mismo criterio de "ancla
// mínima y determinista" que ya usa FAKE_PROFILE. No reemplaza a
// FAKE_PROFILE (que module-selector.spec.js necesita con exactamente 2
// módulos) — perfil nuevo y aislado.
export const FAKE_PROFILE_ADMIN = {
  id: FAKE_USER_ID,
  nombre: 'Admin Vista Previa',
  email: 'qa-visual-admin@sigmapnf.test',
  programa: null,
  activo: true,
  rol: 'qa_visual_admin',
  rol_info: {
    nombre: 'qa_visual_admin',
    label: 'QA Visual Admin',
    emoji: '🧪',
    color: '#7C3AED',
    restringe_programa: false,
    permisos: {
      puedeGestionarUsuarios: true,
      puedeGestionarSedes: true,
    },
  },
};

/**
 * Deja el navegador del test en estado "logueado" antes de cualquier
 * navegación: intercepta todo /rest/v1/** con un catch-all inofensivo
 * (array vacío) y overrides específicos para las tablas cuyo contenido
 * sí importa para lo que se está fotografiando, y siembra la sesión en
 * localStorage vía addInitScript (corre antes que cualquier script de la
 * página, a diferencia de un page.evaluate post-goto).
 *
 * El catch-all es deliberado: useAppData/useQRSession consultan varias
 * tablas más (asistencias, docentes, horarios, materias...) que no le
 * importan a una foto del selector de módulos. Enumerarlas todas acá
 * sería trabajo repetido y frágil — cualquier tabla nueva que se agregue
 * en el futuro cae en el catch-all y no rompe nada.
 *
 * `perfil` (fix UX-35 seguimiento, 14 ago): opcional, default FAKE_PROFILE
 * — no rompe ningún caller existente. Permite loguear con
 * FAKE_PROFILE_ADMIN para cubrir pantallas de Sistema/Admin sin duplicar
 * esta función entera.
 */
export async function loginComoFake(page, { rutasExtra = {}, perfil = FAKE_PROFILE } = {}) {
  await page.addInitScript(
    ({ key, session }) => {
      // Sin prefijo `window.`: mismo patrón que ya usa login.spec.js
      // (`localStorage.clear()`) — Node 18+ expone `localStorage` como
      // global, así que pasa limpio el `no-undef` de ESLint configurado
      // para tests/visual/** (solo globals de Node, no de browser); esto
      // se ejecuta en el browser real vía addInitScript de todos modos.
      localStorage.setItem(key, JSON.stringify(session));
    },
    { key: SUPABASE_STORAGE_KEY, session: FAKE_SESSION }
  );

  await page.route('**/rest/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/user_profiles')) {
      return route.fulfill({ status: 200, json: perfil });
    }
    if (url.includes('/trimestres')) {
      // ASIST-1 (12-ago, e43ce2d): useTrimestreActivo.js consulta esta
      // tabla con `.select("lapso, estado, fecha_inicio, fecha_fin")`
      // SIN `.single()` — o sea espera un array de filas, igual que
      // Postgrest lo devuelve de verdad. Un objeto suelto acá (como
      // `{ estado: 'activo' }`) pasaba el guard `!rows || rows.length===0`
      // sin ser detectado (rows.length es undefined, no 0), y el
      // `trimestres.find(...)` síncrono en el cuerpo del hook explotaba
      // en pleno render de App, tumbando toda la app vía ErrorBoundary
      // antes de que "Bienvenido" llegara a pintarse — la causa real de
      // que este spec fallara en los 3 breakpoints por igual.
      return route.fulfill({
        status: 200,
        json: [
          { lapso: 2, estado: 'activo', fecha_inicio: null, fecha_fin: null },
        ],
      });
    }
    for (const [patron, respuesta] of Object.entries(rutasExtra)) {
      if (url.includes(patron)) {
        return route.fulfill({ status: 200, json: respuesta });
      }
    }
    // Catch-all: cualquier otra tabla consultada en segundo plano no
    // necesita datos reales para esta foto — devolver vacío es inofensivo
    // y evita mantener una lista exhaustiva de tablas.
    return route.fulfill({ status: 200, json: [] });
  });
}
