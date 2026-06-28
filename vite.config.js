// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fcrrtpujuncxruwxpckq\.supabase\.co\/.*/i,
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
          { src: '/favicon-192.png', sizes: '512x512', type: 'image/png' },
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
})
