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
          manualChunks: {
            'vendor-react':   ['react', 'react-dom'],
            'view-historial': ['./src/components/HistorialView'],
            'view-usuarios':  ['./src/components/usuarios/index'],
            'view-logs':      ['./src/components/LogsView'],
            'view-qr': [
              './src/components/asistencias/AdminQRPanel',
              './src/components/asistencias/QRProyeccion',
              './src/components/asistencias/ReporteAsistencias',
            ],
          },
        },
      },
    },
  }
})
