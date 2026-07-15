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
// bloque se elige, no hace falta pedirlo aparte.
const OPCIONES_BLOQUE = [
  ...BLOQUES_DIURNO.map(b => ({ ...b, turno: "DIURNO" })),
  ...BLOQUES_VESPERTINO.map(b => ({ ...b, turno: "VESPERTINO" })),
];

function bloqueValue(b) { return `${b.inicio}|${b.fin}`; }

// Encuentra, entre los bloques de 45 min, cuál coincide con el inicio real
// del registro (`entry.hora` puede venir como "7:30AM-8:15AM" o abarcar
// varios bloques si la clase dura más de 45 min — acá solo se ofrece
// reubicar al bloque de inicio; la duración original no se edita).
function bloqueInicialDe(entry) {
  const inicio = (entry?.hora || "").split(/[-–]/)[0]?.trim().replace(/\s+/g, "").toUpperCase();
  return OPCIONES_BLOQUE.find(b => b.inicio.toUpperCase() === inicio) || OPCIONES_BLOQUE[0];
}

export default function ModalEditarClase({ open, entry, puedeEditar, puedeBorrar, onSave, onDelete, onClose, openConfirm, closeConfirm }) {
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);

  const [dia, setDia] = useState(DAYS[0]);
  const [bloqueSel, setBloqueSel] = useState(bloqueValue(OPCIONES_BLOQUE[0]));
  const [aula, setAula] = useState("");
  const [docenteId, setDocenteId] = useState("");
  const [materiaId, setMateriaId] = useState("");
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
    setBloqueSel(bloqueValue(bloqueInicialDe(entry)));
    setAula(entry.aula || "");
    setDocenteId(entry.docente_id ? String(entry.docente_id) : "");
    setMateriaId(entry.materia_id ? String(entry.materia_id) : "");

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

  // Texto crudo actual (fallback cuando la fila no tiene docente_id/materia_id
  // resueltos aún) — solo para mostrarlo como referencia en el formulario.
  const { materia: materiaRawActual, docente: docenteRawActual } = useMemo(
    () => parseClase(entry?.clase || ""),
    [entry]
  );

  if (!open || !entry) return null;

  const handleGuardar = () => {
    setError("");
    if (!materiaId) return setError("Selecciona una materia.");
    if (!docenteId) return setError("Selecciona un docente.");

    const bloque = OPCIONES_BLOQUE.find(b => bloqueValue(b) === bloqueSel);
    const docente = docentes.find(d => String(d.id) === docenteId);
    const materia = materias.find(m => String(m.id) === materiaId);

    const payload = {
      dia,
      hora: `${bloque.inicio}-${bloque.fin}`,
      aula: aula.trim() || null,
      docente_id: docente.id,
      materia_id: materia.id,
      clase: `${materia.nombre_raw}\nProf. ${docente.nombre_raw}`,
    };

    openConfirm({
      title: "Guardar cambios",
      message: `Se moverá a ${dia.charAt(0) + dia.slice(1).toLowerCase()}, ${bloque.label}${payload.aula ? `, aula ${payload.aula}` : ""}: ${materia.nombre_display || materia.nombre_raw} — ${docente.nombre_display || docente.nombre_raw}. ¿Confirmas?`,
      confirmLabel: "Guardar",
      danger: false,
      onConfirm: async () => {
        closeConfirm();
        setSaving(true);
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
          <label htmlFor="mec-bloque">Bloque de hora</label>
          <select id="mec-bloque" className="s-select s-select--full" value={bloqueSel} onChange={e => setBloqueSel(e.target.value)} disabled={!puedeEditar}>
            <optgroup label="Diurno">
              {BLOQUES_DIURNO.map(b => <option key={bloqueValue(b)} value={bloqueValue(b)}>{b.label}</option>)}
            </optgroup>
            <optgroup label="Vespertino">
              {BLOQUES_VESPERTINO.map(b => <option key={bloqueValue(b)} value={bloqueValue(b)}>{b.label}</option>)}
            </optgroup>
          </select>
          <p className="mec-hint">Solo reubica el bloque de inicio (45 min). Si la clase original abarca más de un bloque, la duración no cambia automáticamente.</p>
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
          </select>
        </div>

        <div className="mec-field">
          <label htmlFor="mec-docente">Docente</label>
          <select id="mec-docente" className="s-select s-select--full" value={docenteId} onChange={e => setDocenteId(e.target.value)} disabled={cargandoCatalogos || !puedeEditar}>
            <option value="">{cargandoCatalogos ? "Cargando…" : `Seleccionar${docenteRawActual ? ` (actual: ${docenteRawActual})` : ""}`}</option>
            {docentes.map(d => <option key={d.id} value={d.id}>{d.nombre_display || d.nombre_raw}</option>)}
          </select>
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
  onSave: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  openConfirm: PropTypes.func.isRequired,
  closeConfirm: PropTypes.func.isRequired,
};
