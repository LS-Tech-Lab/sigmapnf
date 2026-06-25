// =====================================================================
// UploadPreviewModal.jsx
//
// Ventana de confirmación que muestra lo que se leyó del Excel antes
// de insertar en Supabase. El usuario puede revisar errores, advertencias
// y el resumen de registros, y decidir confirmar o cancelar.
//
// Props:
//   open         — boolean
//   data         — { rows, newRows, advertencias, docentesCatalogo,
//                    mallaCatalogo, warnings }
//   onConfirm    — () => void  (continúa la carga)
//   onCancel     — () => void  (descarta todo)
// =====================================================================

import React, { useState } from "react";

// ── Paleta interna (alineada con el sistema de diseño del proyecto) ──
const C = {
  bg:         "#F8FAFC",
  surface:    "#FFFFFF",
  border:     "#E2E8F0",
  borderFaint:"#F1F5F9",
  text:       "#0F172A",
  textSub:    "#475569",
  textFaint:  "#94A3B8",
  accent:     "#2563EB",
  accentBg:   "#EFF6FF",
  accentBdr:  "#BFDBFE",
  warn:       "#B45309",
  warnBg:     "#FFFBEB",
  warnBdr:    "#FDE68A",
  err:        "#DC2626",
  errBg:      "#FEF2F2",
  errBdr:     "#FECACA",
  ok:         "#059669",
  okBg:       "#ECFDF5",
  okBdr:      "#A7F3D0",
  navy:       "#0F172A",
};

// ── Helpers de presentación ──────────────────────────────────────────

const DAYS_ORDER = ["LUNES","MARTES","MIÉRCOLES","JUEVES","VIERNES"];

function Tag({ color, bg, border, children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 5,
      color, background: bg, border: `1px solid ${border}`,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function SectionHeader({ icon, label, count, accent }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 16px", background: accent ? C.accentBg : C.bg,
      borderBottom: `1px solid ${C.border}`, flexShrink: 0,
    }}>
      <i className={`ti ${icon}`} style={{ color: C.accent, fontSize: 15 }} aria-hidden="true" />
      <span style={{ fontWeight: 700, fontSize: 13, color: C.text, flex: 1 }}>{label}</span>
      {count != null && (
        <Tag color={C.accent} bg={C.accentBg} border={C.accentBdr}>{count}</Tag>
      )}
    </div>
  );
}

// ── Subcomponente: tabla de registros ────────────────────────────────

function TablaRegistros({ rows, limit = 200 }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, limit);
  const hasMore  = rows.length > limit;

  // Agrupar por sección → día
  const bySec = {};
  rows.forEach(r => {
    const key = r.sheet || r.seccion || "—";
    if (!bySec[key]) bySec[key] = {};
    const dia = r.dia || "—";
    if (!bySec[key][dia]) bySec[key][dia] = [];
    bySec[key][dia].push(r);
  });

  const secciones = Object.keys(bySec).sort();

  return (
    <div>
      {secciones.map(sec => {
        const diasOrdenados = DAYS_ORDER.filter(d => bySec[sec][d])
          .concat(Object.keys(bySec[sec]).filter(d => !DAYS_ORDER.includes(d)));
        return (
          <div key={sec} style={{ marginBottom: 10 }}>
            {/* Cabecera de sección */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px", background: "#F1F5F9",
              borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
            }}>
              <i className="ti ti-layout-grid" style={{ fontSize: 12, color: C.textSub }} aria-hidden="true" />
              <span style={{ fontWeight: 700, fontSize: 12, color: C.textSub }}>{sec}</span>
              <Tag color={C.textSub} bg="#E2E8F0" border="#CBD5E1">
                {rows.filter(r => (r.sheet || r.seccion || "—") === sec).length} clases
              </Tag>
            </div>
            {/* Filas del día */}
            {diasOrdenados.map(dia => (
              <div key={dia}>
                <div style={{
                  padding: "4px 16px", fontSize: 11, fontWeight: 700,
                  color: C.accent, letterSpacing: "0.05em", textTransform: "uppercase",
                  background: C.accentBg, borderBottom: `1px solid ${C.accentBdr}`,
                }}>
                  {dia}
                </div>
                {bySec[sec][dia].map((r, i) => {
                  const { mat, doc, noDoc } = parseRow(r);
                  return (
                    <div key={i} style={{
                      display: "grid",
                      gridTemplateColumns: "110px 1fr 1fr",
                      gap: "0 10px",
                      padding: "7px 16px",
                      borderBottom: `1px solid ${C.borderFaint}`,
                      alignItems: "start",
                      background: noDoc ? C.warnBg : C.surface,
                    }}>
                      <span style={{ fontSize: 11, color: C.textFaint, fontWeight: 600, paddingTop: 1 }}>
                        {r.hora || "—"}
                      </span>
                      <span style={{ fontSize: 12, color: C.text, lineHeight: 1.4 }}>
                        {mat || <em style={{ color: C.textFaint }}>Sin materia</em>}
                      </span>
                      <span style={{
                        fontSize: 12, lineHeight: 1.4,
                        color: noDoc ? C.warn : C.textSub,
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                        {noDoc
                          ? <><i className="ti ti-alert-triangle" style={{ fontSize: 11 }} aria-hidden="true" /> Sin docente</>
                          : doc || <em style={{ color: C.textFaint }}>—</em>
                        }
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}

      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            display: "block", width: "100%", padding: "8px",
            background: "none", border: "none", cursor: "pointer",
            color: C.accent, fontSize: 12, fontWeight: 600,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <i className="ti ti-chevron-down" aria-hidden="true" /> Mostrar {rows.length - limit} registros más…
        </button>
      )}
    </div>
  );
}

function parseRow(r) {
  // Leer los campos ya resueltos por parseClase en el parseo del Excel.
  // r.materia y r.docente son strings canónicos (o null) poblados antes
  // de llegar al modal; no hay que re-parsear r.clase aquí.
  const mat = r.materia || null;
  const doc = r.docente || null;
  const noDoc = !doc;
  return { mat, doc, noDoc };
}

// ── Subcomponente: catálogo de docentes ─────────────────────────────

function TablaCatalogo({ items, tipo }) {
  const [show, setShow] = useState(false);
  if (!items || items.length === 0) return null;
  const icon = tipo === "docentes" ? "ti-user" : "ti-book";
  const label = tipo === "docentes" ? "Docentes del catálogo" : "Materias del catálogo";
  return (
    <div style={{ borderTop: `1px solid ${C.border}` }}>
      <button
        onClick={() => setShow(s => !s)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          padding: "10px 16px", background: "none", border: "none",
          cursor: "pointer", color: C.textSub, fontSize: 12, fontWeight: 600,
        }}
      >
        <i className={`ti ${icon}`} aria-hidden="true" />
        {label}
        <Tag color={C.textSub} bg="#E2E8F0" border="#CBD5E1">{items.length}</Tag>
        <i className={`ti ${show ? "ti-chevron-up" : "ti-chevron-down"}`}
          style={{ marginLeft: "auto" }} aria-hidden="true" />
      </button>
      {show && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6,
          padding: "0 16px 12px", maxHeight: 160, overflowY: "auto",
        }}>
          {items.map((d, i) => (
            <span key={i} style={{
              fontSize: 11, padding: "3px 8px", borderRadius: 4,
              background: C.bg, border: `1px solid ${C.border}`,
              color: C.textSub, fontWeight: 500,
            }}>
              {d.nombre_raw || d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subcomponente: advertencias ──────────────────────────────────────

function Advertencias({ advertencias, warnings }) {
  const all = [
    ...(advertencias || []),
    ...(warnings    || []),
  ].filter(Boolean);
  if (!all.length) return null;

  return (
    <div style={{
      margin: "0 16px 12px",
      border: `1px solid ${C.warnBdr}`,
      borderRadius: 8, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 12px", background: C.warnBg,
        borderBottom: all.length > 1 ? `1px solid ${C.warnBdr}` : "none",
      }}>
        <i className="ti ti-alert-triangle" style={{ color: C.warn, fontSize: 14 }} aria-hidden="true" />
        <span style={{ fontWeight: 700, fontSize: 12, color: C.warn }}>
          {all.length} advertencia{all.length !== 1 ? "s" : ""}
        </span>
      </div>
      {all.map((w, i) => (
        <div key={i} style={{
          padding: "7px 12px", fontSize: 12, color: C.warn,
          borderBottom: i < all.length - 1 ? `1px solid ${C.warnBdr}` : "none",
          background: C.surface,
        }}>
          {w}
        </div>
      ))}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────

export default function UploadPreviewModal({ open, data, onConfirm, onCancel }) {
  const [tab, setTab] = useState("nuevos");

  if (!open || !data) return null;

  const {
    rows = [],
    newRows = [],
    duplicados = [],
    advertencias = [],
    warnings = [],
    docentesCatalogo = [],
    mallaCatalogo = [],
    fileName = "",
  } = data;

  const sinDocente = newRows.filter(r => !r.docente);

  const totalAdv = advertencias.length + warnings.length;
  const hayProblemas = sinDocente.length > 0 || totalAdv > 0;

  const TABS = [
    { id: "nuevos",    icon: "ti-circle-plus",   label: `Nuevas (${newRows.length})` },
    ...(duplicados.length ? [{ id: "dup", icon: "ti-copy", label: `Duplicadas (${duplicados.length})` }] : []),
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(15,23,42,0.55)",
          backdropFilter: "blur(2px)",
          zIndex: 900,
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Vista previa de carga"
        style={{
          position: "fixed",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(860px, 95vw)",
          maxHeight: "90vh",
          display: "flex", flexDirection: "column",
          background: C.surface,
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(15,23,42,0.22), 0 4px 16px rgba(15,23,42,0.10)",
          zIndex: 901,
          overflow: "hidden",
        }}
      >
        {/* ── Cabecera ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "16px 20px",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
          background: C.navy,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: "#1E3A8A",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <i className="ti ti-file-spreadsheet" style={{ color: "#93C5FD", fontSize: 18 }} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#F8FAFC" }}>
              Vista previa — confirmar carga
            </div>
            {fileName && (
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {fileName}
              </div>
            )}
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancelar carga"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#64748B", fontSize: 18, padding: 4, borderRadius: 6,
              display: "flex", alignItems: "center",
              transition: "color .15s",
            }}
            onMouseEnter={e => e.currentTarget.style.color = "#F8FAFC"}
            onMouseLeave={e => e.currentTarget.style.color = "#64748B"}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {/* ── Tarjetas de resumen ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 10,
          padding: "14px 16px",
          background: C.bg,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <StatChip icon="ti-file-import" value={rows.length} label="Total leídas" color={C.accent} bg={C.accentBg} bdr={C.accentBdr} />
          <StatChip icon="ti-circle-plus" value={newRows.length} label="A insertar" color={C.ok} bg={C.okBg} bdr={C.okBdr} />
          {duplicados.length > 0 && (
            <StatChip icon="ti-copy" value={duplicados.length} label="Duplicadas" color={C.textSub} bg="#F1F5F9" bdr={C.border} />
          )}
          {sinDocente.length > 0 && (
            <StatChip icon="ti-user-x" value={sinDocente.length} label="Sin docente" color={C.warn} bg={C.warnBg} bdr={C.warnBdr} />
          )}
          {docentesCatalogo.length > 0 && (
            <StatChip icon="ti-users" value={docentesCatalogo.length} label="Docentes (cat.)" color={C.textSub} bg="#F1F5F9" bdr={C.border} />
          )}
        </div>

        {/* ── Banner de advertencias ── */}
        {hayProblemas && (
          <div style={{
            flexShrink: 0,
            padding: "10px 16px 0",
            background: C.bg,
          }}>
            <Advertencias advertencias={advertencias} warnings={warnings} />
            {sinDocente.length > 0 && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "8px 12px",
                background: C.warnBg,
                border: `1px solid ${C.warnBdr}`,
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 12, color: C.warn,
              }}>
                <i className="ti ti-user-x" style={{ marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
                <span>
                  <strong>{sinDocente.length} clase{sinDocente.length !== 1 ? "s" : ""}</strong> no tienen docente reconocido.
                  Puedes continuar — podrás corregirlo más tarde en la vista de Docentes.
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Tabs ── */}
        {TABS.length > 1 && (
          <div style={{
            display: "flex", gap: 4,
            padding: "8px 16px 0",
            borderBottom: `1px solid ${C.border}`,
            background: C.surface,
            flexShrink: 0,
          }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "6px 14px", border: "none", cursor: "pointer",
                  borderRadius: "7px 7px 0 0", fontSize: 12, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 5,
                  borderBottom: tab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
                  color: tab === t.id ? C.accent : C.textSub,
                  background: tab === t.id ? C.accentBg : "none",
                  transition: "all .12s",
                }}
              >
                <i className={`ti ${t.icon}`} aria-hidden="true" /> {t.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Cuerpo con scroll ── */}
        <div style={{ flex: 1, overflowY: "auto", background: C.surface }}>

          {tab === "nuevos" && (
            newRows.length === 0
              ? <EmptyState
                  icon="ti-circle-check"
                  title="Sin registros nuevos"
                  body="Todas las clases del archivo ya existen en el sistema."
                  color={C.textFaint}
                />
              : <TablaRegistros rows={newRows} />
          )}

          {tab === "dup" && (
            duplicados.length === 0
              ? <EmptyState icon="ti-circle-check" title="Sin duplicados" body="" color={C.textFaint} />
              : <TablaRegistros rows={duplicados} />
          )}

          {/* Catálogos colapsables al fondo */}
          {tab === "nuevos" && (
            <>
              <TablaCatalogo items={docentesCatalogo} tipo="docentes" />
              <TablaCatalogo items={mallaCatalogo}    tipo="materias" />
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 20px",
          borderTop: `1px solid ${C.border}`,
          background: C.bg,
          flexShrink: 0,
        }}>
          {newRows.length === 0 ? (
            <span style={{ fontSize: 12, color: C.textFaint, flex: 1 }}>
              No hay registros nuevos para insertar.
            </span>
          ) : (
            <span style={{ fontSize: 12, color: C.textSub, flex: 1 }}>
              Se insertarán <strong style={{ color: C.text }}>{newRows.length}</strong> clases
              {sinDocente.length > 0 && (
                <span style={{ color: C.warn }}>
                  {" "}· {sinDocente.length} sin docente
                </span>
              )}
            </span>
          )}
          <button
            onClick={onCancel}
            style={{
              padding: "8px 18px", borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.surface, color: C.textSub,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              transition: "border-color .12s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.textSub}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={newRows.length === 0}
            style={{
              padding: "8px 22px", borderRadius: 8,
              border: "none",
              background: newRows.length === 0 ? "#E2E8F0" : C.accent,
              color: newRows.length === 0 ? C.textFaint : "#fff",
              fontSize: 13, fontWeight: 700, cursor: newRows.length === 0 ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 7,
              transition: "background .12s",
            }}
            onMouseEnter={e => { if (newRows.length > 0) e.currentTarget.style.background = "#1D4ED8"; }}
            onMouseLeave={e => { if (newRows.length > 0) e.currentTarget.style.background = C.accent; }}
          >
            <i className="ti ti-database-import" aria-hidden="true" />
            Confirmar carga
          </button>
        </div>
      </div>
    </>
  );
}

// ── Micro-componentes ────────────────────────────────────────────────

function StatChip({ icon, value, label, color, bg, bdr }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "10px 8px", borderRadius: 10,
      background: bg, border: `1px solid ${bdr}`,
      gap: 2,
    }}>
      <i className={`ti ${icon}`} style={{ color, fontSize: 16 }} aria-hidden="true" />
      <span style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color, opacity: 0.75, textAlign: "center", lineHeight: 1.2 }}>{label}</span>
    </div>
  );
}

function EmptyState({ icon, title, body, color }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "50px 20px", gap: 8,
    }}>
      <i className={`ti ${icon}`} style={{ fontSize: 32, color }} aria-hidden="true" />
      <span style={{ fontWeight: 700, fontSize: 14, color }}>{title}</span>
      {body && <span style={{ fontSize: 12, color, opacity: 0.7 }}>{body}</span>}
    </div>
  );
}
