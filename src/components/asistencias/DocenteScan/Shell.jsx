// Contenedor centrado de pantalla completa usado por todas las vistas de DocenteScan.

function Shell({ children, ancho = 480 }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg,#0F172A 0%,#1E3A5F 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "clamp(12px,4vw,24px)",
      fontFamily: "Inter,system-ui,-apple-system,sans-serif",
      boxSizing: "border-box",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: "clamp(16px,4vw,24px)",
        padding: "clamp(24px,6vw,44px) clamp(20px,5vw,36px)",
        width: "100%",
        maxWidth: ancho,
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        {children}
      </div>
    </div>
  );
}

export default Shell;
