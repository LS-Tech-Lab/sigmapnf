// Pantalla de bloqueo cuando el usuario autenticado no tiene un perfil
// (rol) configurado en user_profiles. Extraído de App.jsx.

// ── Pantalla: sin perfil asignado ─────────────────────────────────────────────
function SinPerfilAsignado({ onLogout }) {
  return (
    <div className="bs-wrap">
      <div className="bs-card">
        <i className="ti ti-user-off bs-icon bs-icon--muted" aria-hidden="true" />
        <h2 className="bs-title">
          Perfil no configurado
        </h2>
        <p className="bs-desc">
          Tu cuenta existe pero aún no tiene un perfil de acceso asignado.
          El administrador debe configurar tu rol en el sistema.
        </p>
        <button onClick={onLogout} className="bs-btn bs-btn--dark">
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

export default SinPerfilAsignado;
