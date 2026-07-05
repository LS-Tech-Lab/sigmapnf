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
      <div className="eb-root">
        <i className="ti ti-alert-triangle eb-icon" aria-hidden="true" />
        <h2 className="eb-title">
          Algo salió mal
        </h2>
        <p className="eb-desc">
          {this.state.error?.message || "Error inesperado en la aplicación."}
        </p>
        {/* Stack trace visible SOLO en desarrollo (SEC-2) */}
        {import.meta.env.DEV && this.state.stack && (
          <pre className="eb-stack">
            {this.state.stack}
          </pre>
        )}
        <button
          onClick={() => window.location.reload()}
          className="eb-btn"
        >
          Recargar página
        </button>
      </div>
    );
  }
}
