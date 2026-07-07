import React, { useState, useMemo, useEffect, useRef } from 'react';
import { trayectoClass } from '../constants';
import { parseClase } from '../utils/parsing';
import './GlobalSearch.css';

export default function GlobalSearch({ onNavigate, docenteNames, materiaNames, data }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), ref = useRef();
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 180);
    return () => clearTimeout(t);
  }, [q]);

  const results = useMemo(() => {
    if (debouncedQ.length < 2) return [];
    const lo = debouncedQ.toLowerCase(), seen = new Set(), out = [];
    data.forEach(d => {
      const { materia, docente: docenteParseado } = parseClase(d.clase);
      // Prioridad: relación real docentes.nombre_raw (garantizada por FK) >
      // texto parseado de la celda, para no duplicar/perder resultados por
      // variantes de tipeo del mismo docente.
      const rawDocente = d.docentes?.nombre_raw || docenteParseado;
      const docente = docenteNames[rawDocente] || rawDocente, materiaDisplay = materiaNames[materia] || materia;
      const key = `${materia}__${rawDocente}`;
      if (!seen.has(key) && (materiaDisplay.toLowerCase().includes(lo) || docente.toLowerCase().includes(lo))) {
        seen.add(key);
        out.push({
          type: rawDocente ? "clase" : "materia",
          materia: materiaDisplay,
          docente,
          trayecto: d.trayecto,
          sheet: d.sheet.trim(),
          rawMateria: materia,
          rawDocente,
        });
      }
    });
    return out.slice(0, 8);
  }, [debouncedQ, docenteNames, materiaNames, data]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="global-search gs-root">
      <div className="gs-box">
        <i className="ti ti-search gs-icon" aria-hidden="true" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === "Escape") { setOpen(false); setQ(""); } }}
          placeholder="Buscar materia, docente…"
          aria-label="Buscar materia o docente"
          className="gs-input"
        />
        {q && <button onClick={() => setQ("")} aria-label="Limpiar búsqueda" className="gs-clear">×</button>}
      </div>
      {open && results.length > 0 && (
        <div className="gs-results">
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => { onNavigate(r); setOpen(false); setQ(""); }}
              className="gs-result"
            >
              <span className={`gs-badge ${trayectoClass(r.trayecto)}`}>{r.trayecto}</span>
              <div>
                <div className="gs-result-title">{r.materia}</div>
                {r.docente && <div className="gs-result-sub">{r.docente}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
