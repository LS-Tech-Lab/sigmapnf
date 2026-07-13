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
import "./UploadPreviewModal.css";

// ── Helpers de presentación ──────────────────────────────────────────

const DAYS_ORDER = ["LUNES","MARTES","MIÉRCOLES","JUEVES","VIERNES"];

function Tag({ variant = "neutral", children }) {
  return (
    <span className={`upm-tag upm-tag--${variant}`}>{children}</span>
  );
}

// ── Subcomponente: tabla de registros ────────────────────────────────

function TablaRegistros({ rows }) {
  // Fix ARCH-19 (13 de julio): antes había un límite de 200 filas + botón
  // "mostrar más", pero la agrupación de abajo (`bySec`) siempre usó `rows`
  // completo — el límite nunca se aplicaba de verdad, el botón no cambiaba
  // nada visible. Decisión de producto (LS, 13 de julio): mantener el
  // comportamiento real actual (mostrar siempre todo), retirando el estado
  // y el botón que no hacían nada, en vez de arreglar un límite que no se
  // había pedido.

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
          <div key={sec} className="upm-sec-group">
            {/* Cabecera de sección */}
            <div className="upm-sec-header">
              <i className="ti ti-layout-grid upm-sec-header-icon" aria-hidden="true" />
              <span className="upm-sec-header-label">{sec}</span>
              <Tag variant="neutral">
                {rows.filter(r => (r.sheet || r.seccion || "—") === sec).length} clases
              </Tag>
            </div>
            {/* Filas del día */}
            {diasOrdenados.map(dia => (
              <div key={dia}>
                <div className="upm-dia-header">
                  {dia}
                </div>
                {bySec[sec][dia].map((r, i) => {
                  const { mat, doc, noDoc } = parseRow(r);
                  return (
                    <div key={i} className={`upm-row${noDoc ? ' upm-row--nodoc' : ''}`}>
                      <span className="upm-row-hora">
                        {r.hora || "—"}
                      </span>
                      <span className="upm-row-materia">
                        {mat || <em className="upm-row-materia-empty">Sin materia</em>}
                      </span>
                      <span className={`upm-row-docente${noDoc ? ' upm-row-docente--nodoc' : ''}`}>
                        {noDoc
                          ? <><i className="ti ti-alert-triangle upm-row-docente-icon" aria-hidden="true" /> Sin docente</>
                          : doc || <em className="upm-row-docente-empty">—</em>
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
    <div className="upm-catalogo">
      <button
        onClick={() => setShow(s => !s)}
        className="upm-catalogo-toggle"
      >
        <i className={`ti ${icon}`} aria-hidden="true" />
        {label}
        <Tag variant="neutral">{items.length}</Tag>
        <i className={`ti ${show ? "ti-chevron-up" : "ti-chevron-down"} upm-catalogo-chevron`} aria-hidden="true" />
      </button>
      {show && (
        <div className="upm-catalogo-list">
          {items.map((d, i) => (
            <span key={i} className="upm-catalogo-item">
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
    <div className="upm-adv-wrap">
      <div className={`upm-adv-header${all.length > 1 ? ' upm-adv-header--multi' : ''}`}>
        <i className="ti ti-alert-triangle upm-adv-header-icon" aria-hidden="true" />
        <span className="upm-adv-header-label">
          {all.length} advertencia{all.length !== 1 ? "s" : ""}
        </span>
      </div>
      {all.map((w, i) => (
        <div key={i} className={`upm-adv-item${i < all.length - 1 ? ' upm-adv-item--divider' : ''}`}>
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
        className="upm-backdrop"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Vista previa de carga"
        className="upm-panel"
      >
        {/* ── Cabecera ── */}
        <div className="upm-header">
          <div className="upm-header-icon-wrap">
            <i className="ti ti-file-spreadsheet upm-header-icon" aria-hidden="true" />
          </div>
          <div className="upm-header-main">
            <div className="upm-header-title">
              Vista previa — confirmar carga
            </div>
            {fileName && (
              <div className="upm-header-filename">
                {fileName}
              </div>
            )}
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancelar carga"
            className="upm-header-close"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {/* ── Tarjetas de resumen ── */}
        <div className="upm-stats-row">
          <StatChip icon="ti-file-import" value={rows.length} label="Total leídas" variant="accent" />
          <StatChip icon="ti-circle-plus" value={newRows.length} label="A insertar" variant="ok" />
          {duplicados.length > 0 && (
            <StatChip icon="ti-copy" value={duplicados.length} label="Duplicadas" variant="muted" />
          )}
          {sinDocente.length > 0 && (
            <StatChip icon="ti-user-x" value={sinDocente.length} label="Sin docente" variant="warn" />
          )}
          {docentesCatalogo.length > 0 && (
            <StatChip icon="ti-users" value={docentesCatalogo.length} label="Docentes (cat.)" variant="muted" />
          )}
        </div>

        {/* ── Banner de advertencias ── */}
        {hayProblemas && (
          <div className="upm-problemas-banner">
            <Advertencias advertencias={advertencias} warnings={warnings} />
            {sinDocente.length > 0 && (
              <div className="upm-nodoc-alert">
                <i className="ti ti-user-x upm-nodoc-alert-icon" aria-hidden="true" />
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
          <div className="upm-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`upm-tab-btn${tab === t.id ? ' upm-tab-btn--active' : ''}`}
              >
                <i className={`ti ${t.icon}`} aria-hidden="true" /> {t.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Cuerpo con scroll ── */}
        <div className="upm-body">

          {tab === "nuevos" && (
            newRows.length === 0
              ? <EmptyState
                  icon="ti-circle-check"
                  title="Sin registros nuevos"
                  body="Todas las clases del archivo ya existen en el sistema."
                />
              : <TablaRegistros rows={newRows} />
          )}

          {tab === "dup" && (
            duplicados.length === 0
              ? <EmptyState icon="ti-circle-check" title="Sin duplicados" body="" />
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
        <div className="upm-footer">
          {newRows.length === 0 ? (
            <span className="upm-footer-empty">
              No hay registros nuevos para insertar.
            </span>
          ) : (
            <span className="upm-footer-text">
              Se insertarán <strong className="upm-footer-text-strong">{newRows.length}</strong> clases
              {sinDocente.length > 0 && (
                <span className="upm-footer-text-warn">
                  {" "}· {sinDocente.length} sin docente
                </span>
              )}
            </span>
          )}
          <button
            onClick={onCancel}
            className="upm-btn-cancel"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={newRows.length === 0}
            className={`upm-btn-confirm ${newRows.length === 0 ? 'upm-btn-confirm--disabled' : 'upm-btn-confirm--enabled'}`}
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

function StatChip({ icon, value, label, variant = "accent" }) {
  return (
    <div className={`upm-stat-chip upm-stat-chip--${variant}`}>
      <i className={`ti ${icon} upm-stat-chip-icon`} aria-hidden="true" />
      <span className="upm-stat-chip-value">{value}</span>
      <span className="upm-stat-chip-label">{label}</span>
    </div>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <div className="upm-empty-state">
      <i className={`ti ${icon} upm-empty-state-icon`} aria-hidden="true" />
      <span className="upm-empty-state-title">{title}</span>
      {body && <span className="upm-empty-state-body">{body}</span>}
    </div>
  );
}
