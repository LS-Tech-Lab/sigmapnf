/**
 * ModalEditarClase.jsx (UX-14)
 *
 * Formulario de edición in-line de un bloque de horario ya cargado —
 * pensado para corregir errores puntuales (día/hora/aula/docente/materia
 * equivocados) sin tener que borrar y volver a subir el Excel completo.
 *
 * No escribe directo a Supabase: arma el payload y lo entrega a
 * `openConfirm` (modal de confirmación global, ver useConfirmModal.js) —
 * cada guardado y cada borrado piden confirmación explícita antes de
 * tocar la base de datos.
 *
 * Reescribe `clase` con el mismo formato "<materia>\nProf. <docente>" que
 * ya reconoce parseClase() (ver src/utils/parsing.js, estrategia 1), para
 * que las pantallas que leen ese texto crudo directamente en vez de las
 * columnas docente_id/materia_id (GlobalSearch, PlanillaImprimibleBase,
 * VistaAusentes, ConflictosView, historialUtils, SeccionesView) muestren
 * el mismo docente/materia elegidos acá sin tener que tocar esas 6
 * pantallas.
 *
 * Props:
 *   open          {boolean}
 *   entry         {object}  — fila de `horarios` a editar (con join
 *                              docentes(nombre_raw)/materias(nombre_raw))
 *   puedeEditar   {boolean} — si se muestra el botón "Guardar" (roles
 *                              personalizados pueden tener puedeBorrarHorarios
 *                              sin puedeEditarHorarios, o viceversa)
 *   puedeBorrar   {boolean} — si se muestra el botón "Eliminar"
 *   puedeCrearDocentes {boolean} — si se ofrece "+ Nuevo docente" (RLS de
 *                              la tabla `docentes`, migración 0046, exige
 *                              puedeEditarDocentes O puedeImportarExcel —
 *                              distinto de puedeEditarHorarios)
 *   puedeCrearMaterias {boolean} — mismo caso para "+ Nueva materia"
 *                              (puedeEditarMaterias O puedeImportarExcel)
 *   onSave        {fn(id, payload) => Promise<{success}>}
 *   onDelete      {fn(id, resumen) => Promise<{success}>}
 *   onClose       {fn}
 *   openConfirm   {fn}      — appData.openConfirm
 *   closeConfirm  {fn}      — appData.closeConfirm
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";
import { DAYS, BLOQUES_DIURNO, BLOQUES_VESPERTINO } from "../constants";
import { parseClase } from "../utils/parsing";
import useFocusTrap from "../hooks/useFocusTrap";
import "./ModalEditarClase.css";

// Un solo select combinado DIURNO+VESPERTINO — el turno se deriva de cuál
// bloque de inicio se elige, no hace falta pedirlo aparte.
const OPCIONES_BLOQUE = [
  ...BLOQUES_DIURNO.map(b => ({ ...b, turno: "DIURNO" })),
  ...BLOQUES_VESPERTINO.map(b => ({ ...b, turno: "VESPERTINO" })),
];

const NUEVO = "__nuevo__";

function bloqueValue(b) { return `${b.inicio}|${b.fin}`; }

// Lista de bloques de 45 min del mismo turno que `bloqueRef`, en orden — se
// usa tanto para poblar el select de inicio (todo el turno) como para
// limitar las opciones válidas de fin (solo desde el bloque de inicio en
// adelante, dentro del mismo turno).
function bloquesDelTurno(turno) {
  return OPCIONES_BLOQUE.filter(b => b.turno === turno);
}

// Encuentra, entre los bloques de 45 min, cuál coincide con el inicio real
// del registro (`entry.hora` puede venir como "7:30AM-8:15AM" o abarcar
// varios bloques si la clase dura más de 45 min).
function bloqueInicialDe(entry) {
  const inicio = (entry?.hora || "").split(/[-–]/)[0]?.trim().replace(/\s+/g, "").toUpperCase();
  return OPCIONES_BLOQUE.find(b => b.inicio.toUpperCase() === inicio) || OPCIONES_BLOQUE[0];
}

// Encuentra, dentro del turno del bloque de inicio, cuál bloque coincide con
// el FIN real del registro (`entry.hora` puede abarcar varios bloques de 45
// min si la clase dura más — ej. 1:00pm-3:15pm son 3 bloques). Si no hay
// coincidencia exacta (dato importado con formato irregular) cae de vuelta
// al bloque de inicio, preservando el comportamiento previo (45 min) en vez
// de fallar.
function bloqueFinalDe(entry, bloqueInicio) {
  const fin = (entry?.hora || "").split(/[-–]/)[1]?.trim().replace(/\s+/g, "").toUpperCase();
  const delTurno = bloquesDelTurno(bloqueInicio.turno);
  return delTurno.find(b => b.fin.toUpperCase() === fin) || bloqueInicio;
}

export default function ModalEditarClase({
  open, entry, puedeEditar, puedeBorrar, puedeCrearDocentes, puedeCrearMaterias,
  onSave, onDelete, onClose, openConfirm, closeConfirm,
}) {
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);

  const [dia, setDia] = useState(DAYS[0]);
  const [bloqueInicioSel, setBloqueInicioSel] = useState(bloqueValue(OPCIONES_BLOQUE[0]));
  const [bloqueFinSel, setBloqueFinSel] = useState(bloqueValue(OPCIONES_BLOQUE[0]));
  const [aula, setAula] = useState("");
  const [docenteId, setDocenteId] = useState("");
  const [materiaId, setMateriaId] = useState("");
  const [nuevoDocenteNombre, setNuevoDocenteNombre] = useState("");
  const [nuevaMateriaNombre, setNuevaMateriaNombre] = useState("");
  const [docentes, setDocentes] = useState([]);
  const [materias, setMaterias] = useState([]);
  const [cargandoCatalogos, setCargandoCatalogos] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Reinicia el formulario cada vez que se abre con una fila distinta.
  useEffect(() => {
    if (!open || !entry) return;
    setError("");
    setDia(entry.dia || DAYS[0]);
    const bIni = bloqueInicialDe(entry);
    setBloqueInicioSel(bloqueValue(bIni));
    setBloqueFinSel(bloqueValue(bloqueFinalDe(entry, bIni)));
    setAula(entry.aula || "");
    setDocenteId(entry.docente_id ? String(entry.docente_id) : "");
    setMateriaId(entry.materia_id ? String(entry.materia_id) : "");
    setNuevoDocenteNombre("");
    setNuevaMateriaNombre("");

    setCargandoCatalogos(true);
    Promise.all([
      supabase.from("docentes").select("id, nombre_raw, nombre_display").order("nombre_display"),
      supabase.from("materias").select("id, nombre_raw, nombre_display").order("nombre_display"),
    ]).then(([docsRes, matsRes]) => {
      setDocentes(docsRes.data || []);
      setMaterias(matsRes.data || []);
      setCargandoCatalogos(false);
    });
  }, [open, entry]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const { materia: materiaRawActual, docente: docenteRawActual } = useMemo(
    () => parseClase(entry?.clase || ""),
    [entry]
  );

  const bloqueInicioObj = useMemo(
    () => OPCIONES_BLOQUE.find(b => bloqueValue(b) === bloqueInicioSel) || OPCIONES_BLOQUE[0],
    [bloqueInicioSel]
  );
  const opcionesFin = useMemo(() => {
    const delTurno = bloquesDelTurno(bloqueInicioObj.turno);
    const idxInicio = delTurno.findIndex(b => bloqueValue(b) === bloqueValue(bloqueInicioObj));
    return delTurno.slice(Math.max(idxInicio, 0));
  }, [bloqueInicioObj]);

  // Si el bloque de inicio cambia (otro horario, u otro turno) y el bloque
  // de fin elegido queda antes del inicio o en un turno distinto, lo
  // reajustamos al propio bloque de inicio (duración mínima de 45 min) en
  // vez de dejar una combinación inválida (fin < inicio).
  useEffect(() => {
    if (!opcionesFin.some(b => bloqueValue(b) === bloqueFinSel)) {
      setBloqueFinSel(bloqueValue(bloqueInicioObj));
    }
  }, [opcionesFin, bloqueInicioObj, bloqueFinSel]);

  if (!open || !entry) return null;

  const handleGuardar = () => {
    setError("");
    if (materiaId === NUEVO) { if (!nuevaMateriaNombre.trim()) return setError("Escribe el nombre de la nueva materia."); }
    else if (!materiaId) return setError("Selecciona una materia.");
    if (docenteId === NUEVO) { if (!nuevoDocenteNombre.trim()) return setError("Escribe el nombre del nuevo docente."); }
    else if (!docenteId) return setError("Selecciona un docente.");

    const bloqueFinObj = OPCIONES_BLOQUE.find(b => bloqueValue(b) === bloqueFinSel) || bloqueInicioObj;
    const rangoLabel = bloqueValue(bloqueFinObj) === bloqueValue(bloqueInicioObj)
      ? bloqueInicioObj.label
      : `${bloqueInicioObj.inicio.replace(/(\d)(AM|PM)/i, "$1 $2")} – ${bloqueFinObj.fin.replace(/(\d)(AM|PM)/i, "$1 $2")}`;
    const materiaLabel = materiaId === NUEVO ? `${nuevaMateriaNombre.trim()} (materia nueva)` : (() => {
      const m = materias.find(x => String(x.id) === materiaId);
      return m.nombre_display || m.nombre_raw;
    })();
    const docenteLabel = docenteId === NUEVO ? `${nuevoDocenteNombre.trim()} (docente nuevo)` : (() => {
      const d = docentes.find(x => String(x.id) === docenteId);
      return d.nombre_display || d.nombre_raw;
    })();

    openConfirm({
      title: "Guardar cambios",
      message: `Se moverá a ${dia.charAt(0) + dia.slice(1).toLowerCase()}, ${rangoLabel}${aula.trim() ? `, aula ${aula.trim()}` : ""}: ${materiaLabel} — ${docenteLabel}. ¿Confirmas?`,
      confirmLabel: "Guardar",
      danger: false,
      onConfirm: async () => {
        closeConfirm();
        setSaving(true);

        // Si se eligió "+ Nuevo", primero hay que crear el registro en el
        // catálogo (docentes/materias) para obtener su id real — RLS de
        // esas tablas exige puedeEditarDocentes/puedeEditarMaterias u
        // puedeImportarExcel (migración 0046), no puedeEditarHorarios, por
        // eso las opciones "+ Nuevo" solo aparecen si el usuario tiene ese
        // permiso (ver puedeCrearDocentes/puedeCrearMaterias).
        let materiaRow = materiaId !== NUEVO ? materias.find(m => String(m.id) === materiaId) : null;
        let docenteRow = docenteId !== NUEVO ? docentes.find(d => String(d.id) === docenteId) : null;

        if (materiaId === NUEVO) {
          const nombre = nuevaMateriaNombre.trim();
          const { data, error: insError } = await supabase
            .from("materias").upsert({ nombre_raw: nombre, nombre_display: nombre }, { onConflict: "nombre_raw" })
            .select().single();
          if (insError) { setSaving(false); setError("Error al crear la materia: " + insError.message); return; }
          materiaRow = data;
        }
        if (docenteId === NUEVO) {
          const nombre = nuevoDocenteNombre.trim();
          const { data, error: insError } = await supabase
            .from("docentes").upsert({ nombre_raw: nombre, nombre_display: nombre }, { onConflict: "nombre_raw" })
            .select().single();
          if (insError) { setSaving(false); setError("Error al crear el docente: " + insError.message); return; }
          docenteRow = data;
        }

        const payload = {
          dia,
          hora: `${bloqueInicioObj.inicio}-${bloqueFinObj.fin}`,
          aula: aula.trim() || null,
          docente_id: docenteRow.id,
          materia_id: materiaRow.id,
          clase: `${materiaRow.nombre_raw}\nProf. ${docenteRow.nombre_raw}`,
        };

        const res = await onSave(entry.id, payload);
        setSaving(false);
        if (res.success) onClose();
      },
    });
  };

  const handleEliminar = () => {
    openConfirm({
      title: "Eliminar clase",
      message: `Se eliminará este bloque (${dia.charAt(0) + dia.slice(1).toLowerCase()}, ${materiaRawActual || "sin materia"}${docenteRawActual ? ` — ${docenteRawActual}` : ""}). Esta acción no se puede deshacer.`,
      confirmLabel: "Sí, eliminar",
      danger: true,
      onConfirm: async () => {
        closeConfirm();
        setSaving(true);
        const res = await onDelete(entry.id, `Horario #${entry.id} eliminado (${dia}, ${materiaRawActual})`);
        setSaving(false);
        if (res.success) onClose();
      },
    });
  };

  return (
    <div className="mec-overlay" onClick={onClose} role="presentation">
      <div className="mec-modal" ref={dialogRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="mec-title">
        <div className="mec-header">
          <i className="ti ti-edit mec-icon" aria-hidden="true" />
          <h2 id="mec-title" className="mec-title">Editar clase</h2>
        </div>

        {error && <div className="mec-error">{error}</div>}

        <div className="mec-field">
          <label htmlFor="mec-dia">Día</label>
          <select id="mec-dia" className="s-select s-select--full" value={dia} onChange={e => setDia(e.target.value)} disabled={!puedeEditar}>
            {DAYS.map(d => <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>)}
          </select>
        </div>

        <div className="mec-field">
          <label htmlFor="mec-bloque-inicio">Hora inicio</label>
          <select id="mec-bloque-inicio" className="s-select s-select--full" value={bloqueInicioSel} onChange={e => setBloqueInicioSel(e.target.value)} disabled={!puedeEditar}>
            <optgroup label="Diurno">
              {BLOQUES_DIURNO.map(b => <option key={bloqueValue(b)} value={bloqueValue({ ...b, turno: "DIURNO" })}>{b.inicio}</option>)}
            </optgroup>
            <optgroup label="Vespertino">
              {BLOQUES_VESPERTINO.map(b => <option key={bloqueValue(b)} value={bloqueValue({ ...b, turno: "VESPERTINO" })}>{b.inicio}</option>)}
            </optgroup>
          </select>
        </div>

        <div className="mec-field">
          <label htmlFor="mec-bloque-fin">Hora fin</label>
          <select id="mec-bloque-fin" className="s-select s-select--full" value={bloqueFinSel} onChange={e => setBloqueFinSel(e.target.value)} disabled={!puedeEditar}>
            {opcionesFin.map(b => <option key={bloqueValue(b)} value={bloqueValue(b)}>{b.fin}</option>)}
          </select>
          <p className="mec-hint">Solo se puede elegir un fin dentro del mismo turno que la hora de inicio.</p>
        </div>

        <div className="mec-field">
          <label htmlFor="mec-aula">Aula</label>
          <input id="mec-aula" className="s-input s-input--full" type="text" value={aula} onChange={e => setAula(e.target.value)} placeholder="Sin aula" disabled={!puedeEditar} />
        </div>

        <div className="mec-field">
          <label htmlFor="mec-materia">Materia</label>
          <select id="mec-materia" className="s-select s-select--full" value={materiaId} onChange={e => setMateriaId(e.target.value)} disabled={cargandoCatalogos || !puedeEditar}>
            <option value="">{cargandoCatalogos ? "Cargando…" : `Seleccionar${materiaRawActual ? ` (actual: ${materiaRawActual})` : ""}`}</option>
            {materias.map(m => <option key={m.id} value={m.id}>{m.nombre_display || m.nombre_raw}</option>)}
            {puedeCrearMaterias && <option value={NUEVO}>+ Agregar nueva materia…</option>}
          </select>
          {materiaId === NUEVO && (
            <input
              className="s-input s-input--full mec-nuevo-input"
              type="text" autoFocus
              value={nuevaMateriaNombre}
              onChange={e => setNuevaMateriaNombre(e.target.value)}
              placeholder="Nombre de la materia nueva"
              disabled={!puedeEditar}
            />
          )}
        </div>

        <div className="mec-field">
          <label htmlFor="mec-docente">Docente</label>
          <select id="mec-docente" className="s-select s-select--full" value={docenteId} onChange={e => setDocenteId(e.target.value)} disabled={cargandoCatalogos || !puedeEditar}>
            <option value="">{cargandoCatalogos ? "Cargando…" : `Seleccionar${docenteRawActual ? ` (actual: ${docenteRawActual})` : ""}`}</option>
            {docentes.map(d => <option key={d.id} value={d.id}>{d.nombre_display || d.nombre_raw}</option>)}
            {puedeCrearDocentes && <option value={NUEVO}>+ Agregar nuevo docente…</option>}
          </select>
          {docenteId === NUEVO && (
            <input
              className="s-input s-input--full mec-nuevo-input"
              type="text" autoFocus
              value={nuevoDocenteNombre}
              onChange={e => setNuevoDocenteNombre(e.target.value)}
              placeholder="Nombre del docente nuevo"
              disabled={!puedeEditar}
            />
          )}
        </div>

        <div className="mec-actions">
          {puedeBorrar && (
            <button className="mec-btn mec-btn--danger" onClick={handleEliminar} disabled={saving}>
              <i className="ti ti-trash" aria-hidden="true" /> Eliminar
            </button>
          )}
          <div className="mec-actions-right">
            <button className="mec-btn mec-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
            {puedeEditar && (
              <button className="mec-btn mec-btn--primary" onClick={handleGuardar} disabled={saving || cargandoCatalogos}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

ModalEditarClase.propTypes = {
  open: PropTypes.bool.isRequired,
  entry: PropTypes.object,
  puedeEditar: PropTypes.bool,
  puedeBorrar: PropTypes.bool,
  puedeCrearDocentes: PropTypes.bool,
  puedeCrearMaterias: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  openConfirm: PropTypes.func.isRequired,
  closeConfirm: PropTypes.func.isRequired,
};
