import React, { useState, useMemo, useEffect, useRef } from 'react';
import { TRAYECTO_BG, TRAYECTO_COLORS } from '../constants';
import { parseClase } from '../utils/parsing';

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
    <div ref={ref} className="global-search" style={{ position: "relative", width: 280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--color-background-secondary)", border: "1px solid var(--color-border-tertiary)", borderRadius: 8, padding: "7px 12px" }}>
        <i className="ti ti-search" style={{ fontSize: 16, color: "var(--color-text-tertiary)" }} aria-hidden="true" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === "Escape") { setOpen(false); setQ(""); } }}
          placeholder="Buscar materia, docente…"
          aria-label="Buscar materia o docente"
          style={{ border: "none", background: "transparent", outline: "none", fontSize: 14, color: "var(--color-text-primary)", width: "100%", fontWeight: 500 }}
        />
        {q && <button onClick={() => setQ("")} aria-label="Limpiar búsqueda" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: 16 }}>×</button>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, minWidth: 280, background: "#fff", borderRadius: 10, border: "1px solid var(--color-border-tertiary)", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", zIndex: 200, overflow: "hidden" }}>
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => { onNavigate(r); setOpen(false); setQ(""); }}
              style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderTop: i > 0 ? "1px solid var(--color-background-tertiary)" : "none", fontSize: 14 }}
            >
              <span style={{ background: TRAYECTO_BG[r.trayecto] || "var(--color-background-subtle)", color: TRAYECTO_COLORS[r.trayecto] || "#555", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{r.trayecto}</span>
              <div>
                <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{r.materia}</div>
                {r.docente && <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 500 }}>{r.docente}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
