// Estilos globales de la aplicación, inyectados como <style> en App.jsx.
// Extraído de App.jsx para mantener el componente raíz enfocado en lógica.

const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; }

  /* Sidebar */
  .sb { transition: width 0.22s cubic-bezier(.4,0,.2,1); overflow: hidden; }
  .sb-collapsed { width: 56px !important; }
  .sb-expanded  { width: 220px !important; }

  .sb-label { transition: opacity 0.15s, width 0.15s; white-space: nowrap; overflow: hidden; }
  .sb-collapsed .sb-label  { opacity: 0; width: 0; }
  .sb-expanded  .sb-label  { opacity: 1; }
  .sb-collapsed .sb-group-title { opacity: 0; }
  .sb-expanded  .sb-group-title { opacity: 1; }

  /* Nav item */
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 10px; border-radius: 7px; cursor: pointer;
    border: none; background: transparent; width: 100%;
    color: #64748B; font-size: 13px; text-align: left;
    transition: background 0.13s, color 0.13s;
    position: relative;
  }
  .nav-item:hover  { background: #1E293B; color: #CBD5E1; }
  .nav-item.active { background: #1E3A8A; color: #93C5FD; font-weight: 600;
                     border-left: 2px solid #3B82F6; }

  .nav-item .tooltip {
    display: none; position: absolute; left: 52px; top: 50%;
    transform: translateY(-50%);
    background: #1E293B; color: #E2E8F0; font-size: 12px; font-weight: 500;
    padding: 5px 10px; border-radius: 6px; white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 999;
    pointer-events: none;
  }
  .sb-collapsed .nav-item:hover .tooltip { display: block; }

  /* Admin dropdown */
  .admin-menu {
    position: absolute; bottom: 52px; left: 8px; right: 8px;
    background: #1E293B; border: 1px solid #334155;
    border-radius: 10px; padding: 6px;
    box-shadow: 0 -4px 24px rgba(0,0,0,0.35); z-index: 400;
    animation: fadeUp .15s ease;
  }
  .sb-collapsed .admin-menu { left: 56px; bottom: 8px; width: 200px; right: auto; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  .admin-item {
    display: flex; align-items: center; gap: 9px;
    width: 100%; padding: 8px 10px; border-radius: 7px;
    border: none; background: transparent; cursor: pointer;
    font-size: 13px; color: #CBD5E1; text-align: left;
    transition: background 0.12s;
  }
  .admin-item:hover { background: #334155; }
  .admin-item.danger { color: #F87171; }
  .admin-item.danger:hover { background: #450A0A; }
  .admin-item:disabled { opacity: 0.4; cursor: not-allowed; }
  .admin-divider { height: 1px; background: #334155; margin: 4px 0; }

  /* Pin button */
  .pin-btn {
    background: none; border: none; cursor: pointer; padding: 4px 6px;
    border-radius: 5px; color: #334155; font-size: 13px;
    transition: color 0.12s, background 0.12s;
  }
  .pin-btn:hover { background: #1E293B; color: #60A5FA; }
  .pin-btn.pinned { color: #60A5FA; }

  /* Header */
  .topbar { background: #fff; border-bottom: 1px solid #E5E7EB;
             display: flex; align-items: center; gap: 10px;
             padding: 0 20px; height: 52px; flex-shrink: 0; }

  /* Badge */
  .badge-red { background: #EF4444; color: #fff; border-radius: 10px;
               font-size: 10px; padding: 1px 5px; font-weight: 700; line-height: 1.4; }

  /* Móvil y tablet (hasta 1024px): sidebar como overlay, hamburger visible */
  @media (max-width: 1024px) {
    .sb { position: fixed !important; z-index: 300; height: 100dvh;
          width: 220px !important;
          transform: translateX(-100%); transition: transform .25s; }
    .sb.mobile-open { transform: translateX(0); }
    /* width: 0 en el flujo para que el sidebar fixed no deje espacio en blanco */
    .sb-flow-spacer { display: none !important; }
    .hamburger { display: flex !important; }
    .global-search { max-width: 200px !important; }
    .stats-grid-4 { grid-template-columns: repeat(2,1fr) !important; }
    .docentes-layout, .materias-layout, .secciones-layout { flex-direction: column !important; height: auto !important; }
    .docentes-left-panel, .materias-left-panel, .secciones-left-panel { width: 100% !important; max-height: 260px; }
  }
  /* Móvil pequeño (hasta 640px) */
  @media (max-width: 640px) {
    .global-search { max-width: 140px !important; }
    .docentes-left-panel, .materias-left-panel, .secciones-left-panel { max-height: 220px; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default GLOBAL_CSS;
