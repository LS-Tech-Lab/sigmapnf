import React, { useState, useEffect } from "react";
import { formatLapso } from "../../utils/lapso";
import { duracion } from "./historialUtils";

// Fix ARCH-13 (auditoría 9 de julio): extraído de HistorialView.jsx sin
// cambios de lógica. Panel de comparación entre trimestres (tab "comparar").

const METRICAS_DOT_CLASE = {
  total: "hist-comp-dot--total",
  secciones: "hist-comp-dot--secciones",
  docentes: "hist-comp-dot--docentes",
  materias: "hist-comp-dot--materias",
};

export default function ComparadorPanel({ trimestres, detalles }) {
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");

  const cerrados = trimestres.filter(t => t.estado !== "activo");

  useEffect(() => {
    if (cerrados.length >= 2 && !selA) setSelA(cerrados[0].lapso);
    if (cerrados.length >= 2 && !selB) setSelB(cerrados[1]?.lapso || "");
  }, [cerrados.length]);

  const dA = detalles[selA];
  const dB = detalles[selB];

  const metrics = [
    { key: "total",     label: "Clases"    },
    { key: "secciones", label: "Secciones" },
    { key: "docentes",  label: "Docentes"  },
    { key: "materias",  label: "Materias"  },
  ];

  if (cerrados.length < 2) return (
    <div className="hist-comp-empty">
      Necesitas al menos 2 trimestres cerrados para comparar.
    </div>
  );

  return (
    <div>
      {/* Selectores */}
      <div className="hist-comp-selectors">
        {[{ val: selA, set: setSelA, label: "Trimestre A", ladoClase: "a" },
          { val: selB, set: setSelB, label: "Trimestre B", ladoClase: "b" }].map(({ val, set, label, ladoClase }) => (
          <div key={label}>
            <label className={`hist-label hist-label--${ladoClase}`}>{label}</label>
            <select value={val} onChange={e => set(e.target.value)}
              className={`hist-comp-select hist-comp-select--${ladoClase}`}>
              <option value="">— seleccionar —</option>
              {cerrados.map(t => (
                <option key={t.lapso} value={t.lapso}>{formatLapso(t.lapso)}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {selA && selB && selA !== selB ? (
        <>
          <div className="hist-comp-table">
            <div className="hist-comp-th hist-comp-th--metric">Métrica</div>
            <div className="hist-comp-th hist-comp-th--a">{formatLapso(selA)}</div>
            <div className="hist-comp-th hist-comp-th--b">{formatLapso(selB)}</div>

            {metrics.map(m => {
              const va = dA?.[m.key] ?? "…";
              const vb = dB?.[m.key] ?? "…";
              const diff = (typeof va === "number" && typeof vb === "number") ? vb - va : null;
              return (
                <React.Fragment key={m.key}>
                  <div className="hist-comp-td hist-comp-td--metric">
                    <span className={`hist-comp-dot ${METRICAS_DOT_CLASE[m.key]}`}>●</span> {m.label}
                  </div>
                  <div className="hist-comp-td hist-comp-td--a">{va}</div>
                  <div className="hist-comp-td hist-comp-td--b hist-comp-td--flex">
                    {vb}
                    {diff !== null && diff !== 0 && (
                      <span className={`hist-comp-diff ${diff > 0 ? "hist-comp-diff--up" : "hist-comp-diff--down"}`}>
                        {diff > 0 ? `▲ +${diff}` : `▼ ${diff}`}
                      </span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}

            {/* Duración */}
            <div className="hist-comp-td hist-comp-td--metric">
              <i className="ti ti-clock hist-comp-clock-icon" aria-hidden="true" />
              Duración
            </div>
            <div className="hist-comp-td hist-comp-td--a">{dA ? duracion(dA.fechaInicio, dA.fechaFin) || "—" : "…"}</div>
            <div className="hist-comp-td hist-comp-td--b">{dB ? duracion(dB.fechaInicio, dB.fechaFin) || "—" : "…"}</div>
          </div>

          {dA?.programas && dB?.programas && (() => {
            const setA = new Set(dA.programas);
            const setB = new Set(dB.programas);
            const comunes  = dA.programas.filter(p => setB.has(p));
            const soloEnA  = dA.programas.filter(p => !setB.has(p));
            const soloEnB  = dB.programas.filter(p => !setA.has(p));
            return (
              <div className="hist-comp-programs">
                {[
                  { label: "En ambos", items: comunes, ladoClase: "comun" },
                  { label: `Solo en ${formatLapso(selA)}`, items: soloEnA, ladoClase: "a" },
                  { label: `Solo en ${formatLapso(selB)}`, items: soloEnB, ladoClase: "b" },
                ].map(({ label, items, ladoClase }) => (
                  <div key={label} className={`hist-comp-prog-group hist-comp-prog-group--${ladoClase}`}>
                    <div className={`hist-comp-prog-title hist-comp-prog-title--${ladoClase}`}>{label}</div>
                    {items.length === 0
                      ? <div className="hist-comp-prog-empty">Ninguno</div>
                      : items.map(p => <div key={p} className={`hist-comp-prog-item hist-comp-prog-item--${ladoClase}`}>• {p}</div>)
                    }
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      ) : (
        <div className="hist-comp-empty">
          Selecciona dos trimestres diferentes para ver la comparación.
        </div>
      )}
    </div>
  );
}
