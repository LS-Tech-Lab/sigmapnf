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
          'vendor-react': ['react', 'react-dom'],
          'view-historial': ['./src/components/HistorialView'],
          'view-usuarios':  ['./src/components/UsuariosView'],
          'view-logs':      ['./src/components/LogsView'],
        },
      },
    },
  },
})
