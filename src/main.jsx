import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// Fix O-5 / ARCH-7: registrar el Service Worker explícitamente para habilitar
// banners de actualización y garantizar el ciclo de vida del SW en
// todos los entornos (incluido tras recargas forzadas).
//
// ARCH-7: antes usábamos registerType 'autoUpdate', que recarga la página
// SOLA en cuanto detecta una versión nueva — sin avisar, sin importar si
// el usuario está a mitad de escribir su correo en el login. Con 'prompt'
// (ver vite.config.js) el SW nuevo se queda esperando y solo se activa
// cuando el usuario confirma. El banner de abajo es DOM plano, no React,
// a propósito: debe poder mostrarse en CUALQUIER pantalla (login incluido,
// donde el árbol de React todavía no monta el <Toast> de la app).
import { registerSW } from 'virtual:pwa-register'

function mostrarBannerActualizacion(updateSW) {
  if (document.getElementById('sw-update-banner')) return; // ya visible

  const banner = document.createElement('div');
  banner.id = 'sw-update-banner';
  banner.setAttribute('role', 'status');
  banner.style.cssText = `
    position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
    z-index: 99999; background: #0F172A; color: #F1F5F9;
    padding: 12px 16px; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    display: flex; align-items: center; gap: 12px; font-size: 14px;
    font-family: system-ui, -apple-system, sans-serif; max-width: 90vw;
  `;
  banner.innerHTML = `
    <span>Hay una nueva versión disponible.</span>
    <button id="sw-update-btn" style="
      background: #2563EB; color: #fff; border: none; border-radius: 6px;
      padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      flex-shrink: 0;
    ">Actualizar</button>
    <button id="sw-update-dismiss" aria-label="Cerrar" style="
      background: none; border: none; color: #94A3B8; cursor: pointer;
      font-size: 16px; padding: 0 4px; flex-shrink: 0;
    ">×</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('sw-update-btn').addEventListener('click', () => {
    updateSW(true);
  });
  document.getElementById('sw-update-dismiss').addEventListener('click', () => {
    banner.remove();
  });
}

const updateSW = registerSW({
  onNeedRefresh() {
    mostrarBannerActualizacion(updateSW);
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
