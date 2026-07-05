// Menú desplegable de administración del sidebar: cargar/exportar/restaurar
// backup, borrar datos del trimestre y estado de conexión.
// Extraído de App.jsx.
import { useEffect, useRef } from "react";
import { useAppDataContext } from "../context/AppDataContext";

// ── Admin dropdown ────────────────────────────────────────────────────────────
function AdminMenu({ onClose, modoConsulta, fileRef, backupRef, permisos }) {
  const ref = useRef(null);
  const appData = useAppDataContext();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const disabled = appData.uploading || appData.loading;

  return (
    <div ref={ref} className="admin-menu">
      <div className="am-section-title">
        Datos del trimestre
      </div>

      {/* Cargar Excel: solo quien puede importar */}
      {!modoConsulta && permisos.puedeImportarExcel && (
        <button className="admin-item" disabled={disabled}
          onClick={() => { fileRef.current?.click(); setTimeout(onClose, 0); }}>
          <i className="ti ti-file-upload" aria-hidden="true" /> Cargar Excel
        </button>
      )}

      {/* Exportar backup */}
      {permisos.puedeHacerBackup && (
        <button className="admin-item" disabled={disabled || !appData.data.length}
          onClick={() => { appData.exportarDatos(); onClose(); }}>
          <i className="ti ti-device-floppy" aria-hidden="true" /> Exportar backup
        </button>
      )}

      {/* Restaurar backup: solo admin */}
      {!modoConsulta && permisos.puedeRestaurarBackup && (
        <button className="admin-item" disabled={disabled}
          onClick={() => { backupRef.current?.click(); setTimeout(onClose, 0); }}>
          <i className="ti ti-upload" aria-hidden="true" /> Restaurar backup
        </button>
      )}

      {/* Borrar datos: solo admin/coordinador */}
      {!modoConsulta && permisos.puedeBorrarHorarios && (
        <>
          <div className="admin-divider" />
          <div className="am-section-title">
            Zona de peligro
          </div>
          <button className="admin-item danger" disabled={disabled || !appData.data.length}
            onClick={() => { appData.clearAllData(); onClose(); }}>
            <i className="ti ti-trash" aria-hidden="true" /> Borrar datos del trimestre
          </button>
        </>
      )}

      <div className="admin-divider" />

      {/* Estado de conexión */}
      <div className="am-status-row">
        <span className={`am-status-dot ${appData.isOffline ? "am-status-dot--offline" : ""}`} />
        <span className={`am-status-text ${appData.isOffline ? "am-status-text--offline" : ""}`}>
          {appData.isOffline ? "Sin conexión" : "En línea"}
        </span>
        {appData.data.length > 0 && (
          <span className="am-status-count">
            {appData.data.length} registros
          </span>
        )}
      </div>
      <div className="am-last-sync">
        Últ. sync: {appData.lastSync}
      </div>
    </div>
  );
}

export default AdminMenu;
