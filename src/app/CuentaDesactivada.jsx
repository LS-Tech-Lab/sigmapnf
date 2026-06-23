// Pantalla de bloqueo cuando el usuario autenticado tiene la cuenta desactivada.
// Extraído de App.jsx.

// ── Pantalla: cuenta desactivada ──────────────────────────────────────────────
function CuentaDesactivada({ onLogout }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
      fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "40px 32px",
        maxWidth: 400, width: "100%", textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <i className="ti ti-ban" style={{ fontSize: 48, color: "#EF4444", marginBottom: 16, display: "block" }} aria-hidden="true" />
        <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#111827" }}>Cuenta desactivada</h2>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>
          Tu cuenta ha sido desactivada. Contacta al administrador del sistema para más información.
        </p>
        <button onClick={onLogout}
          style={{ padding: "10px 24px", borderRadius: 8, border: "none",
            background: "#2563EB", color: "#fff", cursor: "pointer",
            fontSize: 14, fontWeight: 600 }}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

export default CuentaDesactivada;
