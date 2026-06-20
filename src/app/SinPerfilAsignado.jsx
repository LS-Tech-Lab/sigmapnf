// Pantalla de bloqueo cuando el usuario autenticado no tiene un perfil
// (rol) configurado en user_profiles. Extraído de App.jsx.

// ── Pantalla: sin perfil asignado ─────────────────────────────────────────────
function SinPerfilAsignado({ onLogout }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
      fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "40px 32px",
        maxWidth: 420, width: "100%", textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚙️</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#111827" }}>
          Perfil no configurado
        </h2>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>
          Tu cuenta existe pero aún no tiene un perfil de acceso asignado.
          El administrador debe configurar tu rol en el sistema.
        </p>
        <button onClick={onLogout}
          style={{ padding: "10px 24px", borderRadius: 8, border: "none",
            background: "#374151", color: "#fff", cursor: "pointer",
            fontSize: 14, fontWeight: 600 }}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

export default SinPerfilAsignado;
