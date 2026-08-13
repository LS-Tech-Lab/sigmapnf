// TabProgramas.jsx — PROG-4 (12 ago 2026)
//
// Catálogo de programas (tabla `programas`, migración 0090). Mismo
// patrón exacto que TabSedes.jsx (alta/edición de nombre-orden/activar-
// desactivar, sin borrado real, id-slug inmutable) -- ver el comentario
// de diseño en TabSedes.jsx, aplica igual acá. Al crear un programa
// nuevo, se crean también las filas de `sedes_programas` para cada sede
// existente (activo=true por defecto), simétrico a lo que hace TabSedes
// al crear una sede nueva.
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { ModalConfirm } from "../usuarios/shared";
import "../GestionSedes.css";

function slugify(nombre) {
  return (nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const PROGRAMA_VACIO = { nombre: "", orden: "" };

export default function TabProgramas({ showToast, logAudit, onCambio }) {
  const [programas, setProgramas] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const [modalNuevo,  setModalNuevo]  = useState(false);
  const [modalEditar, setModalEditar] = useState(null);
  const [form,        setForm]        = useState(PROGRAMA_VACIO);
  const [guardando,   setGuardando]   = useState(false);
  const [confirm,     setConfirm]     = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("programas")
      .select("id, nombre, activa, orden")
      .order("orden", { ascending: true });
    if (err) setError(err.message);
    else setProgramas(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => {
    const siguienteOrden = programas.length
      ? Math.max(...programas.map(p => p.orden || 0)) + 1
      : 1;
    setForm({ nombre: "", orden: String(siguienteOrden) });
    setModalNuevo(true);
  };

  const abrirEditar = (programa) => {
    setForm({ nombre: programa.nombre, orden: String(programa.orden ?? "") });
    setModalEditar(programa);
  };

  const cerrarModal = () => {
    setModalNuevo(false);
    setModalEditar(null);
    setForm(PROGRAMA_VACIO);
  };

  const idPropuesto = slugify(form.nombre);

  // Simétrico a crearFilasSedePrograma() de TabSedes.jsx: una fila por
  // cada sede existente para el programa recién creado.
  const crearFilasSedePrograma = async (programaId) => {
    const { data: sedes, error: err } = await supabase.from("sedes").select("id");
    if (err || !sedes?.length) return;
    const filas = sedes.map(s => ({ sede_id: s.id, programa_id: programaId, activo: true }));
    const { error: errInsert } = await supabase.from("sedes_programas").insert(filas);
    if (errInsert) {
      showToast?.(
        `Programa creado, pero no se pudo activar en las sedes automáticamente: ${errInsert.message}. Ajusta desde la pestaña "Asignación".`,
        "error"
      );
    }
  };

  const handleGuardar = async () => {
    const nombre = (form.nombre || "").trim();
    const orden  = parseInt(form.orden, 10);

    if (!nombre) { showToast?.("El nombre no puede estar vacío.", "error"); return; }
    if (!Number.isInteger(orden) || orden < 0) { showToast?.("El orden debe ser un número entero mayor o igual a 0.", "error"); return; }

    setGuardando(true);
    try {
      if (modalEditar) {
        const { error: err } = await supabase
          .from("programas")
          .update({ nombre, orden })
          .eq("id", modalEditar.id);
        if (err) throw err;

        await logAudit?.({
          accion:        "EDITAR_PROGRAMA",
          entidad:       "programas",
          entidad_id:    modalEditar.id,
          resumen:       `Programa "${modalEditar.nombre}" actualizado.`,
          datos_antes:   { nombre: modalEditar.nombre, orden: modalEditar.orden },
          datos_despues: { nombre, orden },
        });
        showToast?.("Programa actualizado.", "success");
      } else {
        if (!idPropuesto) { showToast?.("El nombre debe tener al menos una letra o número.", "error"); setGuardando(false); return; }
        if (programas.some(p => p.id === idPropuesto)) {
          showToast?.(`Ya existe un programa con un nombre equivalente ("${idPropuesto}"). Usa un nombre distinto.`, "error");
          setGuardando(false);
          return;
        }

        const { error: err } = await supabase
          .from("programas")
          .insert({ id: idPropuesto, nombre, orden, activa: true });
        if (err) throw err;

        await crearFilasSedePrograma(idPropuesto);

        await logAudit?.({
          accion:        "CREAR_PROGRAMA",
          entidad:       "programas",
          entidad_id:    idPropuesto,
          resumen:       `Programa "${nombre}" creado.`,
          datos_despues: { id: idPropuesto, nombre, orden },
        });
        showToast?.("Programa creado.", "success");
      }

      cerrarModal();
      await cargar();
      await onCambio?.();
    } catch (e) {
      showToast?.(e.message || "No se pudo guardar el programa.", "error");
    }
    setGuardando(false);
  };

  const toggleActiva = async (programa, nuevaActiva) => {
    try {
      const { error: err } = await supabase
        .from("programas")
        .update({ activa: nuevaActiva })
        .eq("id", programa.id);
      if (err) throw err;

      await logAudit?.({
        accion:     nuevaActiva ? "ACTIVAR_PROGRAMA" : "DESACTIVAR_PROGRAMA",
        entidad:    "programas",
        entidad_id: programa.id,
        resumen:    `Programa "${programa.nombre}" ${nuevaActiva ? "activado" : "desactivado"}.`,
      });
      showToast?.(`${programa.nombre} ${nuevaActiva ? "activado" : "desactivado"}.`, "success");
      await cargar();
      await onCambio?.();
    } catch (e) {
      showToast?.(e.message || "No se pudo cambiar el estado del programa.", "error");
    }
  };

  if (loading) {
    return (
      <div className="gs-loading">
        <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" /> Cargando programas…
      </div>
    );
  }

  return (
    <div>
      <div className="gs-header">
        <div>
          <h2 className="gs-title">
            <i className="ti ti-school" aria-hidden="true" /> Programas
          </h2>
          <p className="gs-subtitle">
            Catálogo de PNF de la institución. Desactivar un programa lo
            retira de los selectores; ajusta en qué sedes está activo
            desde la pestaña "Asignación".
          </p>
        </div>
        <button type="button" className="gs-btn-nuevo" onClick={abrirNuevo}>
          <i className="ti ti-plus" aria-hidden="true" /> Nuevo programa
        </button>
      </div>

      {error && <div className="gs-error">{error}</div>}

      {/* UX-39 (LS, 13 ago 2026): filas en flex-wrap en vez de grid de
          columnas fijas — ver el comentario detallado en TabSedes.jsx,
          mismo motivo exacto (el grid de UX-37 seguía exigiendo ~600px
          de mínimo y se recortaba en silencio por debajo de eso). */}
      <div className="s-card gs-list-card">
        {programas.length === 0 ? (
          <p className="gs-td-empty">Sin programas registrados todavía.</p>
        ) : programas.map(programa => (
          <div key={programa.id} className={`gs-row ${programa.activa ? "" : "gs-row--inactiva"}`}>
            <div className="gs-row-main">
              <span className="gs-row-nombre">{programa.nombre}</span>
              <code className="gs-id">{programa.id}</code>
            </div>
            <div className="gs-row-meta">
              <span className="gs-row-orden" title="Orden en los selectores">Orden {programa.orden}</span>
              <span className={`s-badge ${programa.activa ? "gs-badge--activa" : "gs-badge--inactiva"}`}>
                {programa.activa ? "Activo" : "Inactivo"}
              </span>
              <div className="gs-actions">
                <button
                  onClick={() => abrirEditar(programa)}
                  title="Editar"
                  className="gs-action-btn"
                ><i className="ti ti-pencil" aria-hidden="true" /></button>
                <button
                  onClick={() => setConfirm({ programa, nuevaActiva: !programa.activa })}
                  title={programa.activa ? "Desactivar" : "Activar"}
                  className={`gs-action-btn ${programa.activa ? "gs-action-btn--desactivar" : "gs-action-btn--activar"}`}
                ><i className={`ti ${programa.activa ? "ti-toggle-right" : "ti-toggle-left"}`} aria-hidden="true" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(modalNuevo || modalEditar) && (
        <div className="gs-modal-backdrop">
          <div className="gs-modal s-card">
            <h3 className="gs-modal-title">{modalEditar ? "Editar programa" : "Nuevo programa"}</h3>

            <div className="gs-field">
              <label htmlFor="gp-nombre" className="gs-field-label">Nombre</label>
              <input
                id="gp-nombre"
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
              <label htmlFor="gp-orden" className="gs-field-label">Orden</label>
              <input
                id="gp-orden"
                type="number"
                min="0"
                className="s-input"
                value={form.orden}
                onChange={e => setForm(f => ({ ...f, orden: e.target.value }))}
              />
              <p className="gs-field-hint">Posición en los selectores de programa — menor primero.</p>
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
          titulo={confirm.nuevaActiva ? "Activar programa" : "Desactivar programa"}
          mensaje={
            confirm.nuevaActiva
              ? `¿Confirmas activar "${confirm.programa.nombre}"? Volverá a aparecer en los selectores de programa.`
              : `¿Confirmas desactivar "${confirm.programa.nombre}"? Dejará de aparecer en los selectores de programa. Sus datos históricos no se borran.`
          }
          peligro={!confirm.nuevaActiva}
          onConfirm={() => { toggleActiva(confirm.programa, confirm.nuevaActiva); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
