// Contenedor centrado de pantalla completa usado por todas las vistas de DocenteScan.
import "./DocenteScan.css";

function Shell({ children, ancho = 480 }) {
  return (
    <div className="scan-page">
      <div className={`scan-card${ancho === 420 ? " scan-card--narrow" : ""}`}>
        {children}
      </div>
    </div>
  );
}

export default Shell;
