/**
 * usuarios/PestanaRoles.jsx
 *
 * Pestaña de gestión de roles: lista expandible con detalle de permisos,
 * creación, edición y eliminación de roles personalizados.
 *
 * Props:
 *   permisos       — objeto de permisos del usuario actual
 *   onRolesChanged — callback que recibe la lista actualizada de roles
 *   showToast      — función de toast global (opcional)
 *   logAudit       — función de auditoría
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { GRUPOS_PERMISOS, hex2rgba, Spinner, ModalConfirm } from "./shared";
import ModalRol from "./ModalRol";
import "./PestanaRoles.css";

export default function PestanaRoles({ permisos: permisosUsuario, onRolesChanged, showToast: showToastProp, logAudit }) {
  const [roles,     setRoles]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modalRol,  setModalRol]  = useState(undefined); // undefined = cerrado, null = nuevo, obj = editar
  const [confirm,   setConfirm]   = useState(null);
  const [toastMsg,  setToastMsg]  = useState("");
  const [expandido, setExpandido] = useState(null);

  const toast = useCallback((msg, type) => {
    if (showToastProp) showToastProp(msg, type);
    else { setToastMsg(msg); setTimeout(() => setToastMsg(""), 3000); }
  }, [showToastProp]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_roles");
      if (error) throw error;
      setRoles(data || []);
      onRolesChanged?.(data || []);
    } catch (e) {
      toast(`Error: ${e.message}`);
    }
    setLoading(false);
  }, [onRolesChanged]);

  useEffect(() => { cargar(); }, [cargar]);

  const eliminarRol = async (nombre, label) => {
    try {
      const { error } = await supabase.rpc("admin_delete_role", { p_nombre: nombre });
      if (error) throw error;
      await logAudit?.({
        accion:     "ELIMINAR_ROL",
        entidad:    "roles",
        entidad_id: nombre,
        resumen:    `Rol eliminado: "${label}" (${nombre})`,
      });
      toast("✓ Rol eliminado.");
      cargar();
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <div>
      <div className="pr-header">
        <p className="pr-header-desc">
          Los roles del sistema (marcados con 🔒) no se pueden eliminar ni renombrar,
          pero sí puedes editar sus permisos. Los roles personalizados son totalmente gestionables.
        </p>
        {permisosUsuario.puedeGestionarRoles && (
          <button
            onClick={() => setModalRol(null)}
            className="pr-btn-nuevo"
          >
            <i className="ti ti-plus" /> Nuevo rol
          </button>
        )}
      </div>

      {loading ? (
        <div className="pr-loading"><Spinner /></div>
      ) : (
        <div className="pr-list">
          {roles.map(r => {
            const abierto = expandido === r.nombre;
            const permsCounts = Object.entries(r.permisos || {}).filter(([, v]) => v === true).length;
            return (
              <div key={r.nombre} className="s-card pr-card-visible">
                {/* Cabecera del rol */}
                <div
                  className="pr-card-header"
                  onClick={() => setExpandido(abierto ? null : r.nombre)}
                >
                  <div
                    className="pr-avatar"
                    style={{ "--avatar-bg": hex2rgba(r.color, 0.12), "--avatar-border": hex2rgba(r.color, 0.25) }}
                  >
                    {r.emoji}
                  </div>
                  <div className="pr-info">
                    <div className="pr-info-top">
                      <span className="pr-label">{r.label}</span>
                      {r.es_sistema && (
                        <span title="Rol del sistema" className="pr-lock">🔒</span>
                      )}
                      {r.restringe_programa && (
                        <span className="s-badge pr-badge-warning">
                          Restricción de programa
                        </span>
                      )}
                    </div>
                    <div className="pr-meta">
                      <code className="pr-code">{r.nombre}</code>
                      &nbsp;·&nbsp;{permsCounts} permiso{permsCounts !== 1 ? "s" : ""} activo{permsCounts !== 1 ? "s" : ""}
                      &nbsp;·&nbsp;{r.usuarios_count} usuario{r.usuarios_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div
                    className="pr-actions"
                    onClick={e => e.stopPropagation()}
                  >
                    {permisosUsuario.puedeGestionarRoles && (
                      <>
                        <button
                          onClick={() => setModalRol(r)}
                          title="Editar"
                          className="pr-btn-icon"
                        ><i className="ti ti-pencil" /></button>
                        {!r.es_sistema && (
                          <button
                            onClick={() => setConfirm(r)}
                            title="Eliminar"
                            className="pr-btn-icon pr-btn-icon--danger"
                          ><i className="ti ti-trash" /></button>
                        )}
                      </>
                    )}
                    <i
                      className={`ti ti-chevron-${abierto ? "up" : "down"} pr-chevron`}
                    />
                  </div>
                </div>

                {/* Detalle expandible */}
                {abierto && (
                  <div className="pr-detail">
                    <div className="pr-detail-grid">
                      {GRUPOS_PERMISOS.map(g => (
                        <div key={g.grupo}>
                          <div className="pr-group-title">
                            <i className={`ti ${g.icono}`} /> {g.grupo}
                          </div>
                          {g.items.map(item => {
                            const activo = r.permisos?.[item.key] === true;
                            return (
                              <div key={item.key} className="pr-item-row">
                                <i
                                  className={`ti ti-${activo ? "check" : "x"} pr-item-icon${activo ? " pr-item-icon--active" : ""}`}
                                />
                                <span className={`pr-item-label${activo ? " pr-item-label--active" : ""}`}>
                                  {item.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal rol */}
      {modalRol !== undefined && (
        <ModalRol
          rol={modalRol || null}
          onSave={() => { setModalRol(undefined); cargar(); toast("✓ Rol guardado."); }}
          onClose={() => setModalRol(undefined)}
          logAudit={logAudit}
        />
      )}

      {/* Confirmar eliminación */}
      {confirm && (
        <ModalConfirm
          titulo="Eliminar rol"
          mensaje={`¿Eliminar el rol "${confirm.label}"? Esta acción no se puede deshacer. Solo es posible si ningún usuario lo tiene asignado.`}
          onConfirm={() => { eliminarRol(confirm.nombre, confirm.label); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {toastMsg && (
        <div className="pr-toast">{toastMsg}</div>
      )}
    </div>
  );
}
