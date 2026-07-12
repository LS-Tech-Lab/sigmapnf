// vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseHost = new URL(
    env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
  ).host

  return {
    plugins: [
      react(),
      VitePWA({
        // Fix ARCH-7: 'autoUpdate' recargaba la página SOLA en cuanto el
        // Service Worker detectaba una versión nueva (evento "activated"
        // de workbox-window), sin avisar ni esperar a que el usuario
        // terminara lo que estaba haciendo — interrumpía el login a mitad
        // de escribir el correo. 'prompt' deja la decisión al usuario vía
        // el banner de main.jsx (updateSW se dispara solo al hacer clic).
        registerType: 'prompt',
        devOptions: { enabled: false },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: new RegExp(`^https://${supabaseHost}/.*`, 'i'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api-cache',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
              },
            },
          ],
        },
        manifest: {
          name: 'SIGMA PNF',
          short_name: 'SIGMA',
          description: 'Sistema de Gestión de Horarios y Asistencias PNF',
          theme_color: '#1E3A8A',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/favicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
      }),
    ],
    base: '/',
    build: {
      rollupOptions: {
        output: {
          // Fix ARCH-14: la forma objeto de `manualChunks` asignaba a los
          // 4 grupos (view-historial/usuarios/logs/qr) no solo los archivos
          // listados, sino también módulos compartidos por toda la app
          // (cliente de Supabase, logger, parseClase) que Rollup terminaba
          // colocando físicamente dentro de esos chunks — en particular
          // dentro de `view-qr` (320 KB), que el chunk principal
          // (`index-*.js`) necesitaba importar en cada visita (confirmado
          // con `<link rel="modulepreload">` a `view-qr-*` en `index.html`
          // generado, incluso antes de tocar la pantalla de login). La
          // forma función decide chunk por módulo individual en vez de por
          // grafo de dependencias de un grupo, así que un módulo compartido
          // (ej. `src/lib/supabase.js`, importado también por `App.jsx`)
          // nunca puede quedar arrastrado dentro de `view-qr` solo por
          // usarse también ahí: si no calza con ningún patrón de abajo,
          // se devuelve `undefined` y Rollup aplica su algoritmo por
          // defecto (que sí separa correctamente lo compartido).
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (
                id.includes('/node_modules/react/') ||
                id.includes('/node_modules/react-dom/')
              ) {
                return 'vendor-react'
              }
              // El SDK de Supabase (auth-js/postgrest-js/realtime-js/etc.)
              // es el grueso de lo que terminaba físicamente dentro de
              // `view-qr`: se usa desde `App.jsx` (login, sesión) desde el
              // arranque, así que de cualquier forma se necesita cargar de
              // inmediato — pero debe vivir en su propio chunk, no
              // mezclado con el código específico de las vistas QR, para
              // que el chunk `view-qr` real (código de esas vistas) siga
              // siendo lazy de verdad.
              if (
                id.includes('/node_modules/@supabase/') ||
                id.includes('/node_modules/iceberg-js/')
              ) {
                return 'vendor-supabase'
              }
              return undefined
            }
            // Mismo caso que el SDK de Supabase: utilidades transversales
            // usadas desde el arranque síncrono de la app (`main.jsx`/
            // `App.jsx` — logger, cliente Supabase, `parseClase`; PIN
            // offline y sync de horarios en `useAppData` — IndexedDB, cola
            // offline, formateo de fecha/hora; `constants/index.js`, usado
            // por decenas de componentes incluido `ErrorBoundary.jsx`, que
            // vive en la raíz del árbol). Verificado por análisis estático
            // del grafo de módulos real (`this.getModuleInfo` de Rollup),
            // no por inspección manual: son exactamente los módulos
            // alcanzables tanto desde `main.jsx` como desde las 3 entradas
            // de `view-qr`. Se extraen a su propio chunk para que no
            // queden arrastrados dentro de `view-qr` solo por usarse
            // también ahí.
            if (
              id.includes('/src/lib/supabase.js') ||
              id.includes('/src/utils/logger.js') ||
              id.includes('/src/utils/parsing.js') ||
              id.includes('/src/utils/time.js') ||
              id.includes('/src/utils/idb.js') ||
              id.includes('/src/utils/offlineQueue.js') ||
              id.includes('/src/utils/lapso.js') ||
              id.includes('/src/utils/password.js') ||
              id.includes('/src/hooks/useFocusTrap.js') ||
              id.includes('/src/constants/index.js')
            ) {
              return 'vendor-core'
            }
            if (id.includes('/src/components/HistorialView')) {
              return 'view-historial'
            }
            if (id.includes('/src/components/usuarios/index')) {
              return 'view-usuarios'
            }
            if (id.includes('/src/components/LogsView')) {
              return 'view-logs'
            }
            // Fix ARCH-12: antes los 3 componentes iban forzados a un
            // único chunk `view-qr` (320 KB con ARCH-14 sin cerrar, 90 KB
            // ya con `vendor-supabase`/`vendor-core` separados) aunque
            // cada uno ya tenía su propio `React.lazy()` en
            // `AsistenciasModulo.jsx` — nadie visita los 3 a la vez, así
            // que forzarlos juntos no tenía beneficio. Requería primero
            // extraer `QRDisplay`/`formatFechaVE`/`TURNOS_VISIBLES` de
            // `AdminQRPanel.jsx` a su propio archivo (`QRDisplay.jsx`):
            // `QRProyeccion.jsx` los importaba directo de `AdminQRPanel`,
            // un import estático que habría arrastrado el panel admin
            // completo al chunk de proyección de todos modos.
            //
            // OJO: `QRDisplay.jsx` en sí NO se asigna a ninguno de los dos
            // chunks de abajo — lo usan tanto `AdminQRPanel` como
            // `QRProyeccion`. Se le da su PROPIO chunk explícito en vez de
            // dejarlo en `undefined`: se probó primero con `undefined` y
            // Rollup lo terminó colocando físicamente dentro de
            // `view-qr-admin` de todos modos (mismo patrón de fondo que
            // `ARCH-14` — un módulo compartido queda arrastrado dentro de
            // uno de los chunks que lo usan en vez de separarse), lo cual
            // forzaba a `view-qr-proyeccion` a importar cruzado
            // `view-qr-admin` — exactamente lo que se quería evitar
            // (alguien viendo solo la proyección en un televisor no
            // debería descargar también el panel admin completo).
            // `useRegistroSound.js` tiene exactamente los mismos 2
            // consumidores que `QRDisplay.jsx` (`AdminQRPanel` y
            // `QRProyeccion`) — encontrado con el mismo análisis de grafo
            // (intersección de módulos alcanzables desde cada una de las
            // 3 entradas QR) usado para `ARCH-14`. Mismo chunk, mismo
            // motivo.
            if (
              id.includes('/src/components/asistencias/QRDisplay') ||
              id.includes('/src/components/asistencias/useRegistroSound')
            ) {
              return 'view-qr-display'
            }
            if (id.includes('/src/components/asistencias/AdminQRPanel')) {
              return 'view-qr-admin'
            }
            if (id.includes('/src/components/asistencias/QRProyeccion')) {
              return 'view-qr-proyeccion'
            }
            if (id.includes('/src/components/asistencias/ReporteAsistencias')) {
              return 'view-qr-reporte'
            }
            return undefined
          },
        },
      },
    },
  }
})
