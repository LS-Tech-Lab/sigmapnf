// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':   ['react', 'react-dom'],
          'view-historial': ['./src/components/HistorialView'],
          'view-usuarios':  ['./src/components/usuarios/index'],
          'view-logs':      ['./src/components/LogsView'],
          // P5: módulo QR separado del bundle principal
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
