// Pantalla de bloqueo cuando el usuario autenticado tiene la cuenta desactivada.
// Extraído de App.jsx.

// ── Pantalla: cuenta desactivada ──────────────────────────────────────────────
function CuentaDesactivada({ onLogout }) {
  return (
    <div className="bs-wrap">
      <div className="bs-card bs-card--narrow">
        <i className="ti ti-ban bs-icon bs-icon--danger" aria-hidden="true" />
        <h2 className="bs-title">Cuenta desactivada</h2>
        <p className="bs-desc">
          Tu cuenta ha sido desactivada. Contacta al administrador del sistema para más información.
        </p>
        <button onClick={onLogout} className="bs-btn bs-btn--primary">
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

export default CuentaDesactivada;
