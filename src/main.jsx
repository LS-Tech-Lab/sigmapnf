import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// Fix O-5: registrar el Service Worker explícitamente para habilitar
// banners de actualización y garantizar el ciclo de vida del SW en
// todos los entornos (incluido tras recargas forzadas).
import { registerSW } from 'virtual:pwa-register'
registerSW({
  onNeedRefresh() {
    // El SW detectó una versión nueva: notificar discretamente via consola.
    // Si se quiere un toast, llamar aquí a la instancia de showToast del
    // contexto o usar un evento personalizado (window.dispatchEvent).
    console.info('[SIGMA PWA] Nueva versión disponible. Recarga para actualizar.');
  },
  onOfflineReady() {
    console.info('[SIGMA PWA] App lista para funcionar sin conexión.');
  },
})

// Mejora 6: ErrorBoundary en la raíz captura cualquier crash de render
// y muestra un mensaje amigable en lugar de pantalla blanca.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
