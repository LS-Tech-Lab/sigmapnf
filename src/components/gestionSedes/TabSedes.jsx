// TabSedes.jsx — SEDE-17 (auditoría 6 ago 2026), extraído a pestaña propia
// en PROG-4 (12 ago 2026) cuando GestionSedes.jsx pasó a tener 3 pestañas
// (Sedes / Programas / Asignación). Lógica de sedes sin cambios respecto
// al archivo original, salvo un paso nuevo: al crear una sede, también se
// crean las filas de `sedes_programas` (0090) para cada programa del
// catálogo, con activo=true por defecto -- una sede nueva arranca
// ofreciendo todo el catálogo activo, el admin desactiva desde la pestaña
// "Asignación" lo que no aplique. Sin esto, una sede recién creada
// quedaría sin ninguna fila en sedes_programas y, por diseño de 0090
// (ausencia de fila no es un estado válido), aparecería como "sin
// programas activos" en toda la app hasta que alguien la tocara a mano.
//
// DECISIONES DE DISEÑO (sedes, sin cambios respecto al original)
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
import { supabase } from "../../lib/supabase";
import { ModalConfirm } from "../usuarios/shared";
import { useSedeContext } from "../../context/SedeContext";
// Fix UX-55 (auditoría 16 ago): setError(err.message) mostraba el error
// crudo de Postgres/PostgREST, mismo patrón que SEC-38 ya cerró en otros
// 6 archivos el 10 ago.
import { mensajeAmigable } from "../../utils/errorMessages";
import "../usuarios/PestanaUsuarios.css"; // rediseño 14 ago 2026: reutiliza
// pu-toolbar/pu-stats/pu-table TAL CUAL de Usuarios y Roles en vez de la
// lista de tarjetas en flex-wrap que había antes -- ver el comentario
// grande en el return() de abajo.
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

const SEDE_VACIA = { nombre: "", orden: "" };

export default function TabSedes({ showToast, logAudit, onCambio }) {
  const { refetchSedes } = useSedeContext();

  const [sedes,   setSedes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [busqueda, setBusqueda] = useState("");

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
    if (err) setError(mensajeAmigable(err));
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

  // PROG-4: crea las filas de sedes_programas para una sede recién creada
  // (una por cada programa del catálogo, activo=true por defecto). Un
  // fallo acá no revierte la sede -- se avisa por toast y queda para
  // ajustar a mano desde la pestaña Asignación, mismo criterio que otros
  // pasos "best effort" del código (ej. refetchSedes tras guardar).
  const crearFilasSedePrograma = async (sedeId) => {
    const { data: programas, error: err } = await supabase
      .from("programas")
      .select("id");
    if (err || !programas?.length) return;
    const filas = programas.map(p => ({ sede_id: sedeId, programa_id: p.id, activo: true }));
    const { error: errInsert } = await supabase.from("sedes_programas").insert(filas);
    if (errInsert) {
      showToast?.(
        `Sede creada, pero no se pudieron activar sus programas automáticamente: ${mensajeAmigable(errInsert)}. Ajusta desde la pestaña "Asignación".`,
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

        await crearFilasSedePrograma(idPropuesto);

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
      await onCambio?.();
    } catch (e) {
      showToast?.(mensajeAmigable(e) || "No se pudo guardar la sede.", "error");
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
      await onCambio?.();
    } catch (e) {
      showToast?.(mensajeAmigable(e) || "No se pudo cambiar el estado de la sede.", "error");
    }
  };

  if (loading) {
    return (
      <div className="gs-loading">
        <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" /> Cargando sedes…
      </div>
    );
  }

  const sedesFiltradas = sedes.filter(s => {
    const q = busqueda.trim().toLowerCase();
    return !q || s.nombre.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
  });
  const totalActivas = sedes.filter(s => s.activa).length;

  return (
    <div>
      {/* Rediseño 14 ago 2026 (pedido LS): mismo patrón que
          PestanaUsuarios.jsx (Sistema → Usuarios y Roles) -- toolbar de
          búsqueda + botón de alta, tarjetas de estadística, y una tabla
          real (pu-table) en vez de la lista de filas en flex-wrap que
          había antes. Sin título propio acá: el título de la pestaña ya
          lo muestra el header único de GestionSedes.jsx, igual que
          PestanaUsuarios no repite "Usuarios" dentro de su contenido. */}
      <div className="pu-toolbar">
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o identificador…"
          className="s-input pu-search-input"
        />
        <button type="button" className="pu-btn-nuevo" onClick={abrirNuevo}>
          <i className="ti ti-plus" aria-hidden="true" /> Nueva sede
        </button>
      </div>

      <div className="pu-stats">
        <div className="pu-stat pu-stat--total">
          <span className="pu-stat-value">{sedes.length}</span>
          <span className="pu-stat-label">Total</span>
        </div>
        <div className="pu-stat pu-stat--activos">
          <span className="pu-stat-value">{totalActivas}</span>
          <span className="pu-stat-label">Activas</span>
        </div>
        <div className="pu-stat pu-stat--inactivos">
          <span className="pu-stat-value">{sedes.length - totalActivas}</span>
          <span className="pu-stat-label">Inactivas</span>
        </div>
      </div>

      {error && <div className="gs-error">{error}</div>}

      <div className="s-card pu-table-card">
        <table className="pu-table">
          <thead>
            <tr>
              {["Sede", "Orden", "Estado", ""].map((h, i) => (
                <th key={i} className={`s-th${i === 3 ? " pu-th--right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sedesFiltradas.length === 0 ? (
              <tr>
                <td colSpan={4} className="s-td pu-td-empty">
                  {busqueda ? (
                    <>
                      No hay resultados para "{busqueda}".{" "}
                      <button type="button" className="pu-clear-search-btn" onClick={() => setBusqueda("")}>
                        Limpiar búsqueda
                      </button>
                    </>
                  ) : (
                    "Sin sedes registradas."
                  )}
                </td>
              </tr>
            ) : sedesFiltradas.map(sede => (
              <tr key={sede.id} className={sede.activa ? "" : "pu-row--inactivo"}>
                <td className="s-td">
                  <div className="pu-user-name">{sede.nombre}</div>
                  <div className="pu-user-email"><code className="gs-id">{sede.id}</code></div>
                </td>
                <td className="s-td">
                  <span className="pu-programa">{sede.orden}</span>
                </td>
                <td className="s-td">
                  <span className={`s-badge ${sede.activa ? "pu-badge-estado--activo" : "pu-badge-estado--inactivo"}`}>
                    {sede.activa ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td className="s-td pu-td-right">
                  <div className="pu-actions">
                    <button onClick={() => abrirEditar(sede)} title="Editar" className="pu-action-btn">
                      <i className="ti ti-pencil" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => setConfirm({ sede, nuevaActiva: !sede.activa })}
                      title={sede.activa ? "Desactivar" : "Activar"}
                      className={`pu-action-btn ${sede.activa ? "pu-action-btn--desactivar" : "pu-action-btn--activar"}`}
                    >
                      <i className={`ti ${sede.activa ? "ti-toggle-right" : "ti-toggle-left"}`} aria-hidden="true" />
                    </button>
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
