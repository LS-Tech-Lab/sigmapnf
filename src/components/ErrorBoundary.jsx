import React from "react";
import { logger } from "../utils/logger";

/**
 * Mejora 6: ErrorBoundary global.
 * Captura cualquier error de render en el árbol y muestra un mensaje amigable
 * en lugar de una pantalla blanca. Incluye botón para recargar.
 *
 * SEC-2: el stack trace completo solo se renderiza en desarrollo
 * (import.meta.env.DEV). En producción se muestra únicamente el mensaje
 * de error, sin exponer rutas internas del bundle ni nombres de componentes.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, stack: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    logger.error("ErrorBoundary capturó un error:", error, info.componentStack);
    // Guardar stack solo para mostrarlo en desarrollo
    if (import.meta.env.DEV) {
      this.setState({
        stack: (error.stack || "") + "\n\nComponentStack:" + info.componentStack,
      });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        height: "100vh", gap: 16, padding: 32, fontFamily: "system-ui, sans-serif",
        background: "#0F172A", color: "#E2E8F0", textAlign: "center",
      }}>
        <i className="ti ti-alert-triangle" style={{ fontSize: 48, color: "#FBBF24" }} aria-hidden="true" />
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#F1F5F9" }}>
          Algo salió mal
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: "#94A3B8", maxWidth: 420, lineHeight: 1.6 }}>
          {this.state.error?.message || "Error inesperado en la aplicación."}
        </p>
        {/* Stack trace visible SOLO en desarrollo (SEC-2) */}
        {import.meta.env.DEV && this.state.stack && (
          <pre style={{
            marginTop: 12, padding: "12px 16px", background: "#1E293B", borderRadius: 8,
            fontSize: 10, color: "#CBD5E1", textAlign: "left", overflowX: "auto",
            maxWidth: "100%", whiteSpace: "pre-wrap", wordBreak: "break-all",
            maxHeight: 300, overflowY: "auto",
          }}>
            {this.state.stack}
          </pre>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8, padding: "10px 24px", borderRadius: 8, border: "none",
            background: "#3B82F6", color: "#fff", fontSize: 14, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Recargar página
        </button>
      </div>
    );
  }
}
