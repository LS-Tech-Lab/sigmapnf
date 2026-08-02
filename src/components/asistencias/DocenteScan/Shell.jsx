// Contenedor centrado de pantalla completa usado por todas las vistas de DocenteScan.
//
// Fix UX-25 (auditoría 2 ago): badge de registros pendientes de
// sincronizar, autocontenido acá para no tener que enhebrar la prop por
// los ~10 call-sites de <Shell> repartidos en index.jsx/PasoRegistro.jsx/
// PasoValidacionCedula.jsx/SelectorTipo.jsx. Se refresca solo (sin
// polling) escuchando el evento 'sigma:cola-offline-cambio' que dispara
// offlineQueue.js en cada encolarAsistencia()/eliminarPendiente()/
// purgarExpirados(), más 'online'/'offline' como respaldo.
import { useState, useEffect } from "react";
import { contarPendientes } from "../../../utils/offlineQueue";
import "./DocenteScan.css";

function Shell({ children, ancho = 480 }) {
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    let activo = true;
    const refrescar = async () => {
      try {
        const n = await contarPendientes();
        if (activo) setPendientes(n);
      } catch {
        // IDB no disponible en este navegador/contexto — sin badge, sin
        // romper el resto de la pantalla.
      }
    };

    refrescar();
    window.addEventListener("sigma:cola-offline-cambio", refrescar);
    window.addEventListener("online", refrescar);
    window.addEventListener("offline", refrescar);
    return () => {
      activo = false;
      window.removeEventListener("sigma:cola-offline-cambio", refrescar);
      window.removeEventListener("online", refrescar);
      window.removeEventListener("offline", refrescar);
    };
  }, []);

  return (
    <div className="scan-page">
      <div className={`scan-card${ancho === 420 ? " scan-card--narrow" : ""}`}>
        {pendientes > 0 && (
          <div className="scan-pending-badge" role="status" aria-live="polite">
            <i className="ti ti-clock-hour-4" aria-hidden="true" />
            {pendientes} registro{pendientes !== 1 ? "s" : ""} pendiente{pendientes !== 1 ? "s" : ""} de sincronizar
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default Shell;
