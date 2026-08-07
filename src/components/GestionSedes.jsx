// GestionSedes.jsx — SEDE-17 (auditoría 6 ago 2026)
//
// Pantalla admin-only (permiso puedeGestionarSedes, migración 0070) para
// administrar el catálogo de sedes desde la interfaz en vez de a mano en
// la base de datos — hasta ahora era intencionalmente de solo lectura
// (ver comentario original de useSedes.js / migración 0061).
//
// Vive dentro de AdminModulo.jsx ("Sistema"), mismo lugar que
// ConfiguracionReportes.jsx, con el mismo criterio de permiso granular
// propio (no depende de puedeVerTodasLasSedes: una cosa es VER todas las
// sedes en los reportes, otra ADMINISTRAR el catálogo de sedes en sí).
//
// DECISIONES DE DISEÑO
// ---------------------
// - Solo alta, edición de nombre/orden y activar/desactivar. NO hay
//   borrado real: `sedes.id` tiene FKs entrantes desde
//   docentes/materias/horarios/qr_sessions/asistencias_diarias/
//   user_profiles (0061) — la migración 0070 a propósito no agrega
//   política de DELETE. "Dar de baja" una sede es desactivarla, que ya
//   hace desaparecer del selector (useSedes.js filtra por activa=true)
//   sin tocar los datos históricos que la referencian.
// - `id` (slug) se genera del nombre al crear y es INMUTABLE después —
//   no se expone campo de edición para no romper las FKs que ya lo
//   referencian. Mismo criterio que roles.nombre en su momento.
// - Al guardar cualquier cambio, se llama a refetchSedes() (del
//   SedeContext, SEDE-17) para que el selector de sede y todo el árbol
//   se refresque sin necesitar recargar la página.
// - Esta pantalla carga el catálogo COMPLETO (activas e inactivas) con
//   su propio fetch directo — a diferencia de useSedes()/SedeContext,
//   que a propósito solo expone las activas (es el que alimenta el
//   selector de sede real de la app).
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { ModalConfirm } from "./usuarios/shared";
import { useSedeContext } from "../context/SedeContext";
import "./GestionSedes.css";

function slugify(nombre) {
  return (nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const SEDE_VACIA = { nombre: "", orden: "" };

export default function GestionSedes({ showToast, logAudit }) {
  const { refetchSedes } = useSedeContext();

  const [sedes,   setSedes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const [modalNuevo,  setModalNuevo]  = useState(false);
  const [modalEditar, setModalEditar] = useState(null); // sede completa o null
  const [form,        setForm]        = useState(SEDE_VACIA);
  const [guardando,   setGuardando]   = useState(false);
  const [confirm,     setConfirm]     = useState(null); // { sede, nuevaActiva }

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("sedes")
      .select("id, nombre, activa, orden")
      .order("orden", { ascending: true });
    if (err) setError(err.message);
    else setSedes(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => {
    const siguienteOrden = sedes.length
      ? Math.max(...sedes.map(s => s.orden || 0)) + 1
      : 1;
    setForm({ nombre: "", orden: String(siguienteOrden) });
    setModalNuevo(true);
  };

  const abrirEditar = (sede) => {
    setForm({ nombre: sede.nombre, orden: String(sede.orden ?? "") });
    setModalEditar(sede);
  };

  const cerrarModal = () => {
    setModalNuevo(false);
    setModalEditar(null);
    setForm(SEDE_VACIA);
  };

  const idPropuesto = slugify(form.nombre);

  const handleGuardar = async () => {
    const nombre = (form.nombre || "").trim();
    const orden  = parseInt(form.orden, 10);

    if (!nombre) { showToast?.("El nombre no puede estar vacío.", "error"); return; }
    if (!Number.isInteger(orden) || orden < 0) { showToast?.("El orden debe ser un número entero mayor o igual a 0.", "error"); return; }

    setGuardando(true);
    try {
      if (modalEditar) {
        // Edición: solo nombre/orden. El id (slug) es inmutable.
        const { error: err } = await supabase
          .from("sedes")
          .update({ nombre, orden })
          .eq("id", modalEditar.id);
        if (err) throw err;

        await logAudit?.({
          accion:        "EDITAR_SEDE",
          entidad:       "sedes",
          entidad_id:    modalEditar.id,
          resumen:       `Sede "${modalEditar.nombre}" actualizada.`,
          datos_antes:   { nombre: modalEditar.nombre, orden: modalEditar.orden },
          datos_despues: { nombre, orden },
        });
        showToast?.("Sede actualizada.", "success");
      } else {
        // Alta: id generado del nombre, sin duplicados.
        if (!idPropuesto) { showToast?.("El nombre debe tener al menos una letra o número.", "error"); setGuardando(false); return; }
        if (sedes.some(s => s.id === idPropuesto)) {
          showToast?.(`Ya existe una sede con un nombre equivalente ("${idPropuesto}"). Usa un nombre distinto.`, "error");
          setGuardando(false);
          return;
        }

        const { error: err } = await supabase
          .from("sedes")
          .insert({ id: idPropuesto, nombre, orden, activa: true });
        if (err) throw err;

        await logAudit?.({
          accion:        "CREAR_SEDE",
          entidad:       "sedes",
          entidad_id:    idPropuesto,
          resumen:       `Sede "${nombre}" creada.`,
          datos_despues: { id: idPropuesto, nombre, orden },
        });
        showToast?.("Sede creada.", "success");
      }

      cerrarModal();
      await cargar();
      await refetchSedes?.();
    } catch (e) {
      showToast?.(e.message || "No se pudo guardar la sede.", "error");
    }
    setGuardando(false);
  };

  const toggleActiva = async (sede, nuevaActiva) => {
    try {
      const { error: err } = await supabase
        .from("sedes")
        .update({ activa: nuevaActiva })
        .eq("id", sede.id);
      if (err) throw err;

      await logAudit?.({
        accion:     nuevaActiva ? "ACTIVAR_SEDE" : "DESACTIVAR_SEDE",
        entidad:    "sedes",
        entidad_id: sede.id,
        resumen:    `Sede "${sede.nombre}" ${nuevaActiva ? "activada" : "desactivada"}.`,
      });
      showToast?.(`${sede.nombre} ${nuevaActiva ? "activada" : "desactivada"}.`, "success");
      await cargar();
      await refetchSedes?.();
    } catch (e) {
      showToast?.(e.message || "No se pudo cambiar el estado de la sede.", "error");
    }
  };

  if (loading) {
    return (
      <div className="gs-loading">
        <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" /> Cargando sedes…
      </div>
    );
  }

  return (
    <div className="gs-root">
      <div className="gs-header">
        <div>
          <h2 className="gs-title">
            <i className="ti ti-building-community" aria-hidden="true" /> Sedes
          </h2>
          <p className="gs-subtitle">
            Crea sedes nuevas y administra cuáles están activas. Desactivar
            una sede la retira del selector, sin borrar sus datos históricos.
          </p>
        </div>
        <button type="button" className="gs-btn-nuevo" onClick={abrirNuevo}>
          <i className="ti ti-plus" aria-hidden="true" /> Nueva sede
        </button>
      </div>

      {error && <div className="gs-error">{error}</div>}

      <div className="s-card gs-table-card">
        <table className="gs-table">
          <thead>
            <tr>
              <th className="s-th">Sede</th>
              <th className="s-th">Identificador</th>
              <th className="s-th">Orden</th>
              <th className="s-th">Estado</th>
              <th className="s-th gs-th--right"></th>
            </tr>
          </thead>
          <tbody>
            {sedes.length === 0 ? (
              <tr><td colSpan={5} className="s-td gs-td-empty">Sin sedes registradas todavía.</td></tr>
            ) : sedes.map(sede => (
              <tr key={sede.id} className={sede.activa ? "" : "gs-row--inactiva"}>
                <td className="s-td gs-nombre">{sede.nombre}</td>
                <td className="s-td"><code className="gs-id">{sede.id}</code></td>
                <td className="s-td">{sede.orden}</td>
                <td className="s-td">
                  <span className={`s-badge ${sede.activa ? "gs-badge--activa" : "gs-badge--inactiva"}`}>
                    {sede.activa ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td className="s-td gs-td-right">
                  <div className="gs-actions">
                    <button
                      onClick={() => abrirEditar(sede)}
                      title="Editar"
                      className="gs-action-btn"
                    ><i className="ti ti-pencil" aria-hidden="true" /></button>
                    <button
                      onClick={() => setConfirm({ sede, nuevaActiva: !sede.activa })}
                      title={sede.activa ? "Desactivar" : "Activar"}
                      className={`gs-action-btn ${sede.activa ? "gs-action-btn--desactivar" : "gs-action-btn--activar"}`}
                    ><i className={`ti ${sede.activa ? "ti-toggle-right" : "ti-toggle-left"}`} aria-hidden="true" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal alta/edición */}
      {(modalNuevo || modalEditar) && (
        <div className="gs-modal-backdrop">
          <div className="gs-modal s-card">
            <h3 className="gs-modal-title">{modalEditar ? "Editar sede" : "Nueva sede"}</h3>

            <div className="gs-field">
              <label htmlFor="gs-nombre" className="gs-field-label">Nombre</label>
              <input
                id="gs-nombre"
                className="s-input s-input--full"
                value={form.nombre}
                maxLength={60}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                autoFocus
              />
              {!modalEditar && (
                <p className="gs-field-hint">
                  Identificador: <code className="gs-id">{idPropuesto || "—"}</code> (se genera del nombre, no se puede cambiar después)
                </p>
              )}
            </div>

            <div className="gs-field">
              <label htmlFor="gs-orden" className="gs-field-label">Orden</label>
              <input
                id="gs-orden"
                type="number"
                min="0"
                className="s-input"
                value={form.orden}
                onChange={e => setForm(f => ({ ...f, orden: e.target.value }))}
              />
              <p className="gs-field-hint">Posición en el selector de sede — menor primero.</p>
            </div>

            <div className="gs-modal-footer">
              <button type="button" className="s-btn s-btn--cancel" onClick={cerrarModal} disabled={guardando}>
                Cancelar
              </button>
              <button type="button" className="gs-btn-guardar" onClick={handleGuardar} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ModalConfirm
          titulo={confirm.nuevaActiva ? "Activar sede" : "Desactivar sede"}
          mensaje={
            confirm.nuevaActiva
              ? `¿Confirmas activar "${confirm.sede.nombre}"? Volverá a aparecer en el selector de sede.`
              : `¿Confirmas desactivar "${confirm.sede.nombre}"? Dejará de aparecer en el selector de sede. Sus datos históricos (docentes, horarios, asistencias) no se borran.`
          }
          peligro={!confirm.nuevaActiva}
          onConfirm={() => { toggleActiva(confirm.sede, confirm.nuevaActiva); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
