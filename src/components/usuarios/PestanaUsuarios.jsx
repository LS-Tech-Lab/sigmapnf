/**
 * usuarios/PestanaUsuarios.jsx
 *
 * Pestaña de gestión de usuarios: tabla, filtros, acciones
 * (activar/desactivar, editar, eliminar) y gestión de huérfanos.
 *
 * Props:
 *   permisos     — objeto de permisos del usuario actual
 *   esActorAdmin — true si el usuario actual tiene rol === "admin"
 *                  (jerarquía fija de SEC-15/migración 0050). Se usa
 *                  para reflejar en la UI la misma regla que el backend
 *                  ya aplica: bloquear editar/desactivar/eliminar sobre
 *                  una fila admin, y ocultar "admin" del selector de rol
 *                  del modal — ver ModalUsuario.jsx.
 *   roles        — lista de roles (para filtro y modal)
 *   programas    — lista de programas disponibles (catálogo completo)
 *   sedeProgramaActivo — PROG-4 (12 ago 2026): mapa { sede_id:
 *                  Set<nombrePrograma> } que ModalUsuario usa para
 *                  filtrar el checklist de programas según la sede
 *                  elegida — ver doc en ModalUsuario.jsx. Opcional, se
 *                  pasa tal cual (sin resolverlo acá).
 *   showToast    — función de toast global (opcional; usa toast local si no se pasa)
 *   logAudit     — función de auditoría
 *
 * SEDE-2: `sedes` se carga acá mismo vía useSedes() en vez de recibirla
 * como prop — a diferencia de `roles`/`programas` (que ya vienen resueltos
 * desde AdminModulo/arriba), el catálogo de sedes no tenía antes ningún
 * punto de carga en el árbol, así que se agrega el hook directo en el
 * único componente que lo necesita, en vez de encadenar props nuevas por
 * 2-3 componentes intermedios.
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { Badge, Spinner, ModalConfirm } from "./shared";
import useSedes from "../../hooks/useSedes";
import "./PestanaUsuarios.css";
import ModalUsuario from "./ModalUsuario";
// Fix UX-59 (auditoría 16 ago, cierre del alcance dejado pendiente por
// UX-55): 2 de los 4 catch de este archivo relanzan el error original de
// RPCs de Postgres (`throw error`) sin traducir — los otros 2
// (`eliminarUsuario`/`eliminarHuerfano`) muestran `json.error` de
// `/api/admin-users`, ya curado en español por ese endpoint, y quedan
// sin tocar a propósito.
import { mensajeAmigable } from "../../utils/errorMessages";

export default function PestanaUsuarios({ permisos, esActorAdmin = false, roles, programas, sedeProgramaActivo, showToast: showToastProp, logAudit, userId }) {
  const [usuarios,    setUsuarios]    = useState([]);
  const [huerfanos,   setHuerfanos]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [busqueda,    setBusqueda]    = useState("");
  const [filtroRol,   setFiltroRol]   = useState("todos");
  const [modalEditar, setModalEditar] = useState(null);
  const [modalNuevo,  setModalNuevo]  = useState(false);
  const [confirm,     setConfirm]     = useState(null);
  const [toastMsg,    setToastMsg]    = useState("");
  // SEDE-18: useSedes() se llamaba SIN userId -- su guard interno
  // (if (!userId) { setSedes([]); return; }, agregado en SEDE-7 para
  // evitar el fetch antes de que exista sesión) se disparaba siempre,
  // así que el selector de sede del modal de Nuevo/Editar usuario
  // quedaba permanentemente vacío en producción, en silencio (RLS no
  // era el problema -- el hook nunca llegaba a consultar). El test de
  // integración ya mockeaba supabase.from("sedes") pero nunca verificaba
  // que se llamara, así que el mock quedaba de adorno sin ejercitar el
  // camino real.
  const { sedes } = useSedes(userId);

  const toast = useCallback((msg, type) => {
    if (showToastProp) showToastProp(msg, type);
    else { setToastMsg(msg); setTimeout(() => setToastMsg(""), 3000); }
  }, [showToastProp]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_users");
      if (error) throw error;

      // PROG-3 (fase 1): admin_get_users() sigue devolviendo solo la
      // columna escalar `programa` (0062) — se mezcla acá el resultado
      // de admin_get_user_profiles_programas() (0079) para que
      // ModalUsuario pueda precargar el multi-select al editar. Un
      // fallo acá no debe tumbar la carga de la tabla completa (el
      // fallback de ModalUsuario a `usuario.programa` sigue funcionando
      // sin esto) — por eso va en su propio try/catch silencioso.
      let programasPorUsuario = {};
      try {
        const { data: prog, error: progError } = await supabase.rpc("admin_get_user_profiles_programas");
        if (progError) throw progError;
        programasPorUsuario = Object.fromEntries((prog || []).map(r => [r.user_id, r.programas]));
      } catch {
        // silencioso — ver comentario arriba
      }

      setUsuarios((data || []).map(u => ({ ...u, programas: programasPorUsuario[u.id] || undefined })));
    } catch (e) {
      toast(`Error al cargar usuarios: ${mensajeAmigable(e)}`);
    }
    try {
      const { data: orphans } = await supabase.rpc("admin_get_orphan_auth_users");
      setHuerfanos(orphans || []);
    } catch {
      setHuerfanos([]);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const toggleActivo = async (u, nuevoActivo) => {
    try {
      const { error } = await supabase.rpc("admin_toggle_user_activo", {
        p_user_id: u.id, p_activo: nuevoActivo,
      });
      if (error) throw error;
      await logAudit?.({
        accion:     nuevoActivo ? "ACTIVAR_USUARIO" : "DESACTIVAR_USUARIO",
        entidad:    "usuarios",
        entidad_id: u.id,
        resumen:    `Usuario ${nuevoActivo ? "activado" : "desactivado"}: ${u.email}`,
      });
      toast(nuevoActivo ? `${u.nombre} activado.` : `${u.nombre} desactivado.`, "success");
      cargar();
    } catch (e) {
      toast(mensajeAmigable(e), "error");
    }
  };

  const eliminarUsuario = async (u) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "delete", user_id: u.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al eliminar.");
      await logAudit?.({
        accion:     "ELIMINAR_USUARIO",
        entidad:    "usuarios",
        entidad_id: u.id,
        resumen:    `Usuario eliminado permanentemente: ${u.email}`,
      });
      toast(`Usuario ${u.email} eliminado.`, "success");
      cargar();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const eliminarHuerfano = async (u) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "delete_orphan", user_id: u.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al eliminar.");
      toast(`Usuario huérfano ${u.email} eliminado.`, "success");
      cargar();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  // ── Filtrado ───────────────────────────────────────────────────────────────
  const usuariosFiltrados = usuarios.filter(u => {
    const q = busqueda.toLowerCase();
    return (
      (!busqueda || u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
      (filtroRol === "todos" || u.rol === filtroRol)
    );
  });

  const totalActivos = usuarios.filter(u => u.activo).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Barra de herramientas */}
      <div className="pu-toolbar">
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o email…"
          className="s-input pu-search-input"
        />
        <select
          className="s-select"
          value={filtroRol}
          onChange={e => setFiltroRol(e.target.value)}
          aria-label="Filtrar por rol"
        >
          <option value="todos">Todos los roles</option>
          {roles.map(r => <option key={r.nombre} value={r.nombre}>{r.emoji} {r.label}</option>)}
        </select>
        {permisos.puedeGestionarUsuarios && (
          <button onClick={() => setModalNuevo(true)} className="pu-btn-nuevo">
            <i className="ti ti-user-plus" /> Nuevo usuario
          </button>
        )}
      </div>

      {/* Estadísticas rápidas */}
      <div className="pu-stats">
        {[
          { label: "Total",    value: usuarios.length,             variant: "total" },
          { label: "Activos",  value: totalActivos,                variant: "activos" },
          { label: "Inactivos",value: usuarios.length - totalActivos, variant: "inactivos" },
        ].map(s => (
          <div
            key={s.label}
            className={`pu-stat pu-stat--${s.variant}`}
          >
            <span className="pu-stat-value">{s.value}</span>
            <span className="pu-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Banner usuarios huérfanos */}
      {huerfanos.length > 0 && (
        <div className="pu-huerfanos-banner">
          <div className="pu-huerfanos-header">
            <i className="ti ti-alert-triangle pu-huerfanos-icon" />
            <span className="pu-huerfanos-title">
              {huerfanos.length} usuario{huerfanos.length !== 1 ? "s" : ""} sin perfil detectado{huerfanos.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="pu-huerfanos-desc">
            Estos usuarios existen en el sistema de autenticación pero{" "}
            <strong>no tienen perfil en la base de datos</strong>, por lo que no pueden iniciar sesión.
            Probablemente se crearon antes de la corrección del constraint de roles. Puedes eliminarlos permanentemente:
          </p>
          <div className="pu-huerfanos-list">
            {huerfanos.map(h => (
              <div key={h.id} className="pu-huerfano-item">
                <div>
                  <span className="pu-huerfano-email">{h.email}</span>
                  <span className="pu-huerfano-date">
                    Creado: {new Date(h.created_at).toLocaleDateString("es-VE")}
                  </span>
                </div>
                <button
                  onClick={() => setConfirm({ usuario: h, accion: "delete_orphan" })}
                  className="pu-huerfano-delete"
                >
                  <i className="ti ti-trash" /> Eliminar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div className="pu-loading"><Spinner /></div>
      ) : (
        <div className="s-card pu-table-card">
          <table className="pu-table">
            <thead>
              <tr>
                {["Usuario", "Rol", "Programa", "Sede", "Estado", ""].map((h, i) => (
                  <th key={i} className={`s-th${i === 5 ? " pu-th--right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="s-td pu-td-empty">
                    {busqueda || filtroRol !== "todos" ? (
                      <>
                        {busqueda
                          ? `No hay resultados para "${busqueda}".`
                          : "Ningún usuario coincide con ese rol."}{" "}
                        <button
                          type="button"
                          className="pu-clear-search-btn"
                          onClick={() => { setBusqueda(""); setFiltroRol("todos"); }}
                        >
                          Limpiar filtros
                        </button>
                      </>
                    ) : (
                      "Sin usuarios registrados."
                    )}
                  </td>
                </tr>
              ) : usuariosFiltrados.map(u => {
                const rolInfo = roles.find(r => r.nombre === u.rol);
                const sedeInfo = sedes.find(s => s.id === u.sede_id);
                return (
                  <tr key={u.id} className={u.activo ? "" : "pu-row--inactivo"}>
                    <td className="s-td">
                      <div className="pu-user-name">{u.nombre}</div>
                      <div className="pu-user-email">{u.email}</div>
                    </td>
                    <td className="s-td">
                      <Badge color={rolInfo?.color}>{rolInfo?.emoji || "👤"} {rolInfo?.label || u.rol}</Badge>
                    </td>
                    <td className="s-td">
                      {/* PROG-3 (fase 1): u.programas (array, si existe algo
                          en user_profiles_programas) tiene prioridad sobre
                          el escalar legado u.programa para reflejar cuando
                          un coordinador tiene más de uno asignado. */}
                      <span className="pu-programa">
                        {Array.isArray(u.programas) && u.programas.length > 0
                          ? u.programas.join(", ")
                          : (u.programa || "—")}
                      </span>
                    </td>
                    <td className="s-td">
                      <span className="pu-programa">
                        {sedeInfo?.nombre || (rolInfo?.permisos?.puedeVerTodasLasSedes ? "Todas" : "—")}
                      </span>
                    </td>
                    <td className="s-td">
                      <span className={`s-badge ${u.activo ? "pu-badge-estado--activo" : "pu-badge-estado--inactivo"}`}>
                        {u.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="s-td pu-td-right">
                      {permisos.puedeGestionarUsuarios && (() => {
                        // SEC-15 en la UI: el backend ya rechaza estas acciones
                        // sobre una cuenta admin si quien las pide no lo es —
                        // aquí solo evitamos que alguien llegue a ese error.
                        const bloqueado = u.rol === "admin" && !esActorAdmin;
                        const title = bloqueado ? "Solo una cuenta admin puede gestionar otra cuenta admin." : undefined;
                        return (
                          <div className="pu-actions">
                            <button
                              onClick={() => !bloqueado && setModalEditar(u)}
                              disabled={bloqueado}
                              title={title || "Editar"}
                              className="pu-action-btn"
                            ><i className="ti ti-pencil" /></button>
                            <button
                              onClick={() => !bloqueado && setConfirm({ usuario: u, nuevoActivo: !u.activo })}
                              disabled={bloqueado}
                              title={title || (u.activo ? "Desactivar" : "Activar")}
                              className={`pu-action-btn ${u.activo ? "pu-action-btn--desactivar" : "pu-action-btn--activar"}`}
                            ><i className={u.activo ? "ti ti-user-off" : "ti ti-user-check"} /></button>
                            <button
                              onClick={() => !bloqueado && setConfirm({ usuario: u, accion: "delete" })}
                              disabled={bloqueado}
                              title={title || "Eliminar permanentemente"}
                              className="pu-action-btn pu-action-btn--eliminar"
                            ><i className="ti ti-trash" /></button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modales */}
      {(modalNuevo || modalEditar) && (
        <ModalUsuario
          usuario={modalEditar || null}
          esActorAdmin={esActorAdmin}
          roles={roles}
          programas={programas}
          sedeProgramaActivo={sedeProgramaActivo}
          sedes={sedes}
          showToast={toast}
          logAudit={logAudit}
          onSave={() => { setModalNuevo(false); setModalEditar(null); cargar(); }}
          onClose={() => { setModalNuevo(false); setModalEditar(null); }}
        />
      )}

      {confirm?.accion === "delete" && (
        <ModalConfirm
          titulo="Eliminar usuario permanentemente"
          mensaje={`¿Eliminar la cuenta de ${confirm.usuario.nombre || confirm.usuario.email} de forma PERMANENTE? Se borrará tanto el perfil como el acceso al sistema. Esta acción no se puede deshacer.`}
          onConfirm={() => { eliminarUsuario(confirm.usuario); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.accion === "delete_orphan" && (
        <ModalConfirm
          titulo="Eliminar usuario sin perfil"
          mensaje={`¿Eliminar permanentemente la cuenta huérfana "${confirm.usuario.email}"? No tiene perfil en la BD y no puede acceder al sistema de todas formas.`}
          onConfirm={() => { eliminarHuerfano(confirm.usuario); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm && !confirm.accion && (
        <ModalConfirm
          titulo={confirm.nuevoActivo ? "Activar usuario" : "Desactivar usuario"}
          mensaje={`¿Confirmas ${confirm.nuevoActivo ? "activar" : "desactivar"} la cuenta de ${confirm.usuario.nombre}?`}
          peligro={!confirm.nuevoActivo}
          onConfirm={() => { toggleActivo(confirm.usuario, confirm.nuevoActivo); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {toastMsg && <div className="pu-toast">{toastMsg}</div>}
    </div>
  );
}
