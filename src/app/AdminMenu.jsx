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
      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase",
        letterSpacing: "0.08em", padding: "4px 10px 6px" }}>
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
          <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase",
            letterSpacing: "0.08em", padding: "4px 10px 6px" }}>
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
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: appData.isOffline ? "#EF4444" : "#22C55E" }} />
        <span style={{ fontSize: 11, color: appData.isOffline ? "#FCA5A5" : "#4ADE80", fontWeight: 600 }}>
          {appData.isOffline ? "Sin conexión" : "En línea"}
        </span>
        {appData.data.length > 0 && (
          <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto" }}>
            {appData.data.length} registros
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: "#334155", padding: "0 10px 4px" }}>
        Últ. sync: {appData.lastSync}
      </div>
    </div>
  );
}

export default AdminMenu;
