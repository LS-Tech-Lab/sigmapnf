// TabPlantillas.jsx — Fase 1 del editor de plantillas de planillas/
// reportes imprimibles (12 ago 2026, migración 0091).
//
// Mudado (13 ago, pedido de LS) de Sistema → Sedes a Sistema → Reportes:
// vive junto a "Membrete" bajo GestionReportes.jsx, mismo shell de
// pestañas que GestionSedes.jsx (TabSedes/TabProgramas/TabAsignacion) --
// encaja mejor temáticamente ahí (columnas/formato de impresión) que
// junto al catálogo de sedes. Detrás de su propio permiso
// (puedeGestionarPlantillas), no puedeConfigurarReportes -- ver
// GestionReportes.jsx para cómo se filtran las pestañas por permiso.
//
// Junta las dos partes de la Fase 1 en una sola pantalla porque, a
// diferencia de sedes/programas, acá no hace falta un catálogo grande --
// hoy existe un solo tipo_reporte ('planilla_asistencia_turno'), así que
// separar "plantillas" y "asignación" en pestañas propias sería más
// navegación por poco contenido. Si en el futuro se suma un segundo
// tipo_reporte, ahí sí conviene un selector de tipo arriba de todo --
// se deja ese refactor para cuando haga falta, no antes.
//
// No hay borrado de plantillas a propósito (ver migración 0091: sin
// política RLS de DELETE en plantillas_impresion) -- una plantilla en
// uso por alguna sede no puede quedar huérfana. Tampoco se expone
// `agrupacion` como elegible todavía: todas las plantillas nuevas se
// crean con 'bloque' porque es la única que PlanillaImprimibleBase.jsx
// sabe renderizar hoy (ver CAMPOS_BLOQUE ahí). La columna existe en BD
// para no necesitar otra migración cuando se sume 'docente'.
import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../lib/supabase";
import usePlantillasImpresion from "../../hooks/usePlantillasImpresion";
import { useReporteConfig } from "../../hooks/useReporteConfig";
import { anchoContenidoMm } from "../../utils/reportePlantilla";
import { CAMPOS_PLANILLA_TURNO, DEFAULT_COLUMNAS_BLOQUE } from "../../utils/plantillasImpresion";
import { construirHtmlPreview, DIMENSIONES_PAGINA_PX } from "../../utils/plantillaPreview";
import "../GestionSedes.css"; // reutiliza clases genéricas gs-*/s-* de panel admin, no exclusivas de "sedes"
import "./TabPlantillas.css";

const TIPO_REPORTE = "planilla_asistencia_turno";
// Mismas alturas que reportePlantilla.js (ALTURA_MEMBRETE_MM/ALTURA_PIE_MM)
// -- duplicadas acá porque ese módulo no las exporta (son un detalle
// interno suyo); si se tocan allá, hay que tocarlas acá también.
const ALTURA_MEMBRETE_MM = 40;
const ALTURA_PIE_MM = 30;
// Fase 3: NO se reusa MM_A_PX (96dpi real) para el lienzo de arrastre --
// a esa escala, una página horizontal (~950px de ancho) desbordaría el
// panel del editor. Se recalcula un factor propio por plantilla para que
// el lienzo siempre mida ANCHO_EDITOR_PX de ancho, sin importar
// orientación/tamaño -- mismo espíritu que ESCALA_PREVIEW más abajo.
const ANCHO_EDITOR_PX = 300;

const BLOQUES_LAYOUT = [
  { key: "izq", label: "Logo + institución" },
  { key: "der", label: "Título / fecha" },
  { key: "pie", label: "Pie + firma" },
];

// Completa la lista de columnas guardada con cualquier campo del
// registro compartido que todavía no esté ahí (por ejemplo, un campo
// agregado a CAMPOS_PLANILLA_TURNO después de que esta plantilla ya
// existía) -- se agrega al final, oculto, en vez de quedar inaccesible
// para el admin.
function columnasCompletas(columnas) {
  const existentes = new Map((columnas || []).map(c => [c.campo, c]));
  let siguienteOrden = (columnas || []).length;
  for (const { campo, etiquetaDefault } of CAMPOS_PLANILLA_TURNO) {
    if (!existentes.has(campo)) {
      siguienteOrden += 1;
      existentes.set(campo, { campo, etiqueta: etiquetaDefault, orden: siguienteOrden, visible: false });
    }
  }
  return [...existentes.values()].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

export default function TabPlantillas({ showToast, logAudit }) {
  const {
    plantillas, asignaciones, loading, error,
    crearPlantilla, actualizarPlantilla, marcarDefault, asignarASede, quitarAsignacion,
  } = usePlantillasImpresion(TIPO_REPORTE);

  const [sedes, setSedes] = useState([]);
  const [loadingSedes, setLoadingSedes] = useState(true);

  const [modalNuevo, setModalNuevo] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);

  const [editando, setEditando] = useState(null); // plantilla en edición de columnas
  const [columnasForm, setColumnasForm] = useState([]);
  // Fase 2 (12 ago): orientación/tamaño de página existían en BD desde la
  // Fase 1 pero no eran editables desde ningún lado -- se agregan acá,
  // junto con el resto del editor de la plantilla.
  const [orientacionForm, setOrientacionForm] = useState("horizontal");
  const [tamanoPaginaForm, setTamanoPaginaForm] = useState("carta");
  // Fase 3 (12 ago): null = sin personalizar, usa el flujo flex normal de
  // reporte-print.css (comportamiento de siempre). Un objeto = posiciones
  // propias por bloque -- ver reportePlantilla.js (layoutStyleInline).
  const [layoutForm, setLayoutForm] = useState(null);
  const canvasHeaderRef = useRef(null);
  const canvasPieRef = useRef(null);
  const [guardandoColumnas, setGuardandoColumnas] = useState(false);

  const [marcandoDefault, setMarcandoDefault] = useState(null);

  // ADMIN-6: mismo membrete (logo/colores institucionales) que ve
  // cualquier documento impreso real -- la preview no tiene sentido si
  // muestra un membrete distinto al que de verdad va a salir impreso.
  const { config: reporteConfig } = useReporteConfig();

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoadingSedes(true);
      const { data, error: err } = await supabase
        .from("sedes")
        .select("id, nombre")
        .eq("activa", true)
        .order("orden", { ascending: true });
      if (!cancelado) {
        if (!err) setSedes(data || []);
        setLoadingSedes(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  const abrirNueva = () => { setNombreNuevo(""); setModalNuevo(true); };
  const cerrarNueva = () => { setModalNuevo(false); setNombreNuevo(""); };

  const handleCrear = async () => {
    const nombre = nombreNuevo.trim();
    if (!nombre) { showToast?.("El nombre no puede estar vacío.", "error"); return; }
    setGuardandoNuevo(true);
    try {
      const nueva = await crearPlantilla({
        nombre,
        agrupacion: "bloque",
        columnas: DEFAULT_COLUMNAS_BLOQUE,
      });
      await logAudit?.({
        accion: "CREAR_PLANTILLA_IMPRESION",
        entidad: "plantillas_impresion",
        entidad_id: nueva.id,
        resumen: `Plantilla "${nombre}" creada (${TIPO_REPORTE}).`,
        datos_despues: { nombre, tipo_reporte: TIPO_REPORTE },
      });
      showToast?.("Plantilla creada.", "success");
      cerrarNueva();
      abrirEditorColumnas(nueva);
    } catch (e) {
      showToast?.(e.message || "No se pudo crear la plantilla.", "error");
    }
    setGuardandoNuevo(false);
  };

  const abrirEditorColumnas = (plantilla) => {
    setColumnasForm(columnasCompletas(plantilla.columnas));
    setOrientacionForm(plantilla.orientacion || "horizontal");
    setTamanoPaginaForm(plantilla.tamano_pagina || "carta");
    setLayoutForm(plantilla.layout?.bloques ? plantilla.layout : null);
    setEditando(plantilla);
  };
  const cerrarEditorColumnas = () => {
    setEditando(null);
    setColumnasForm([]);
    setOrientacionForm("horizontal");
    setTamanoPaginaForm("carta");
    setLayoutForm(null);
  };

  const toggleVisible = (campo) => {
    setColumnasForm(cols => cols.map(c => c.campo === campo ? { ...c, visible: !c.visible } : c));
  };
  const cambiarEtiqueta = (campo, etiqueta) => {
    setColumnasForm(cols => cols.map(c => c.campo === campo ? { ...c, etiqueta } : c));
  };
  const mover = (indice, direccion) => {
    setColumnasForm(cols => {
      const destino = indice + direccion;
      if (destino < 0 || destino >= cols.length) return cols;
      const copia = [...cols];
      [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
      return copia;
    });
  };

  // Fase 3: mismo cálculo que usa reportePlantilla.js (anchoContenidoMm)
  // para que el lienzo de arrastre tenga exactamente el ancho real
  // disponible en la página -- si difirieran, un bloque llevado al borde
  // acá se vería en otro lugar en la impresión real.
  const anchoLienzoMm = useMemo(() => anchoContenidoMm(tamanoPaginaForm, orientacionForm), [tamanoPaginaForm, orientacionForm]);
  const pxPorMmEditor = ANCHO_EDITOR_PX / anchoLienzoMm;

  const activarLayoutLibre = (activar) => {
    if (!activar) { setLayoutForm(null); return; }
    // Posiciones iniciales razonables: izq y der como quedarían con el
    // flujo flex de siempre (uno a cada punta), pie al inicio del lienzo
    // del pie -- punto de partida, no un cálculo exacto del ancho real
    // de cada bloque (que depende del texto/logo configurado).
    setLayoutForm({
      bloques: {
        izq: { x: 0, y: 0 },
        der: { x: Math.max(Math.round(anchoLienzoMm * 0.6), 0), y: 0 },
        pie: { x: 0, y: 0 },
      },
    });
  };

  // Arrastre: el bloque captura el puntero en pointerdown (setPointerCapture)
  // así que los pointermove siguientes llegan al bloque aunque el cursor
  // se salga del lienzo -- la posición se recalcula cada vez contra el
  // rect real del lienzo correspondiente (canvasRef), no contra un
  // acumulado de deltas (más simple y sin drift).
  const iniciarArrastre = (e) => { e.currentTarget.setPointerCapture(e.pointerId); };

  const arrastrar = (bloque, canvasRef, altoMm) => (e) => {
    if (e.buttons !== 1) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xMm = Math.min(Math.max((e.clientX - rect.left) / pxPorMmEditor, 0), anchoLienzoMm);
    const yMm = Math.min(Math.max((e.clientY - rect.top) / pxPorMmEditor, 0), altoMm);
    setLayoutForm(lf => ({ bloques: { ...(lf?.bloques || {}), [bloque]: { x: Math.round(xMm), y: Math.round(yMm) } } }));
  };

  // Fase 2: recalcula en cada cambio de columnas/orientación/tamaño/layout
  // -- es lo que hace que la vista previa sea "en vivo" y no un botón
  // aparte de "generar preview".
  const previewHtml = useMemo(() => {
    if (!editando) return "";
    return construirHtmlPreview({
      columnas: columnasForm,
      orientacion: orientacionForm,
      tamanoPagina: tamanoPaginaForm,
      layout: layoutForm,
      reporteConfig,
    });
  }, [editando, columnasForm, orientacionForm, tamanoPaginaForm, layoutForm, reporteConfig]);

  const dimensionPagina = DIMENSIONES_PAGINA_PX[`${tamanoPaginaForm}-${orientacionForm}`] || DIMENSIONES_PAGINA_PX["carta-horizontal"];
  // Ancho fijo del panel de preview (ver TabPlantillas.css .tp-preview-wrap)
  // -- se escala el iframe (tamaño real de página) para caber ahí, la
  // proporción entre ancho y alto es lo que hace que se vea "como una
  // hoja" y no una tabla genérica.
  const ESCALA_PREVIEW = 300 / dimensionPagina.w;

  const handleGuardarColumnas = async () => {
    const columnas = columnasForm.map((c, i) => ({ ...c, orden: i + 1 }));
    const sinEtiqueta = columnas.find(c => c.visible && !c.etiqueta.trim());
    if (sinEtiqueta) { showToast?.("Toda columna visible necesita una etiqueta.", "error"); return; }
    if (!columnas.some(c => c.visible)) { showToast?.("La plantilla necesita al menos una columna visible.", "error"); return; }

    setGuardandoColumnas(true);
    try {
      await actualizarPlantilla(editando.id, { columnas, orientacion: orientacionForm, tamano_pagina: tamanoPaginaForm, layout: layoutForm });
      await logAudit?.({
        accion: "EDITAR_COLUMNAS_PLANTILLA",
        entidad: "plantillas_impresion",
        entidad_id: editando.id,
        resumen: `Columnas de "${editando.nombre}" actualizadas.`,
      });
      showToast?.("Columnas guardadas.", "success");
      cerrarEditorColumnas();
    } catch (e) {
      showToast?.(e.message || "No se pudieron guardar las columnas.", "error");
    }
    setGuardandoColumnas(false);
  };

  const handleMarcarDefault = async (plantilla) => {
    setMarcandoDefault(plantilla.id);
    try {
      await marcarDefault(plantilla.id);
      await logAudit?.({
        accion: "MARCAR_PLANTILLA_DEFAULT",
        entidad: "plantillas_impresion",
        entidad_id: plantilla.id,
        resumen: `"${plantilla.nombre}" marcada como predeterminada.`,
      });
      showToast?.(`"${plantilla.nombre}" es ahora la predeterminada.`, "success");
    } catch (e) {
      showToast?.(e.message || "No se pudo marcar como predeterminada.", "error");
    }
    setMarcandoDefault(null);
  };

  const handleAsignar = async (sede, plantillaId) => {
    try {
      if (plantillaId === "") {
        await quitarAsignacion(sede.id);
        showToast?.(`${sede.nombre} vuelve a usar la plantilla predeterminada.`, "success");
      } else {
        const plantilla = plantillas.find(p => p.id === plantillaId);
        await asignarASede(sede.id, plantillaId);
        showToast?.(`${sede.nombre} ahora usa "${plantilla?.nombre}".`, "success");
      }
      await logAudit?.({
        accion: "ASIGNAR_PLANTILLA_SEDE",
        entidad: "sede_plantillas",
        entidad_id: `${sede.id}::${TIPO_REPORTE}`,
        resumen: `Plantilla de "${sede.nombre}" cambiada.`,
      });
    } catch (e) {
      showToast?.(e.message || "No se pudo actualizar la asignación.", "error");
    }
  };

  if (loading || loadingSedes) {
    return (
      <div className="gs-loading">
        <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" /> Cargando plantillas…
      </div>
    );
  }

  return (
    <div>
      <div className="gs-header">
        <div>
          <h2 className="gs-title">
            <i className="ti ti-layout-grid" aria-hidden="true" /> Plantillas
          </h2>
          <p className="gs-subtitle">
            Configura qué columnas trae la planilla de asistencia diaria por
            turno y en qué orden. Cada sede puede usar la plantilla
            predeterminada o una propia.
          </p>
        </div>
        <button type="button" className="gs-btn-nuevo" onClick={abrirNueva}>
          <i className="ti ti-plus" aria-hidden="true" /> Nueva plantilla
        </button>
      </div>

      {error && <div className="gs-error">{error}</div>}

      {/* UX-39 aplicado también acá (13 ago, mismo pedido de LS): esta
          tabla usaba clases (gs-table/gs-nombre/gs-table-card/etc.) que
          quedaron sin CSS propio cuando GestionSedes.css se reescribió
          a flex-wrap -- un <table> sin ningún control de ancho, dentro
          de .s-card{overflow:hidden}, se recortaba en silencio apenas
          la tarjeta no alcanzaba el ancho natural de sus 4 columnas
          (bug reportado por LS con capturas: "ESTA[DO]" cortado a media
          palabra). Mismas filas .gs-row/.gs-row-main/.gs-row-meta que
          TabSedes.jsx/TabProgramas.jsx -- sin ancho mínimo por fila. */}
      <div className="s-card gs-list-card">
        {plantillas.length === 0 ? (
          <p className="gs-td-empty">Sin plantillas todavía.</p>
        ) : plantillas.map(p => (
          <div key={p.id} className="gs-row">
            <div className="gs-row-main">
              <span className="gs-row-nombre">{p.nombre}</span>
              <span className="gs-row-orden">
                {(p.columnas || []).filter(c => c.visible !== false).length} de {CAMPOS_PLANILLA_TURNO.length} columnas
              </span>
            </div>
            <div className="gs-row-meta">
              {p.es_default
                ? <span className="s-badge gs-badge--activa">Predeterminada</span>
                : <span className="s-badge gs-badge--inactiva">—</span>}
              <div className="gs-actions">
                <button
                  onClick={() => abrirEditorColumnas(p)}
                  title="Editar columnas"
                  className="gs-action-btn"
                ><i className="ti ti-columns" aria-hidden="true" /></button>
                {!p.es_default && (
                  <button
                    onClick={() => handleMarcarDefault(p)}
                    disabled={marcandoDefault === p.id}
                    title="Marcar como predeterminada"
                    className="gs-action-btn gs-action-btn--activar"
                  ><i className="ti ti-star" aria-hidden="true" /></button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="tp-asignacion-header">
        <h3 className="tp-asignacion-title">Asignación por sede</h3>
        <p className="gs-subtitle">
          Sin elegir nada, la sede usa la plantilla predeterminada.
        </p>
      </div>

      <div className="s-card gs-list-card">
        {sedes.length === 0 ? (
          <p className="gs-td-empty">No hay sedes activas.</p>
        ) : sedes.map(sede => {
          const asignacion = asignaciones.find(a => a.sede_id === sede.id);
          return (
            <div key={sede.id} className="gs-row">
              <div className="gs-row-main">
                <span className="gs-row-nombre">{sede.nombre}</span>
              </div>
              <div className="gs-row-meta">
                <select
                  className="s-input tp-asignacion-select"
                  value={asignacion?.plantilla_id || ""}
                  onChange={e => handleAsignar(sede, e.target.value)}
                >
                  <option value="">Predeterminada ({plantillas.find(p => p.es_default)?.nombre || "—"})</option>
                  {plantillas.filter(p => !p.es_default).map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      {modalNuevo && (
        <div className="gs-modal-backdrop">
          <div className="gs-modal s-card">
            <h3 className="gs-modal-title">Nueva plantilla</h3>
            <div className="gs-field">
              <label htmlFor="tp-nombre" className="gs-field-label">Nombre</label>
              <input
                id="tp-nombre"
                className="s-input s-input--full"
                value={nombreNuevo}
                maxLength={80}
                onChange={e => setNombreNuevo(e.target.value)}
                autoFocus
              />
              <p className="gs-field-hint">Empieza con las columnas del formato estándar; se pueden ajustar después de crearla.</p>
            </div>
            <div className="gs-modal-footer">
              <button type="button" className="s-btn s-btn--cancel" onClick={cerrarNueva} disabled={guardandoNuevo}>Cancelar</button>
              <button type="button" className="gs-btn-guardar" onClick={handleCrear} disabled={guardandoNuevo}>
                {guardandoNuevo ? "Creando…" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <div className="gs-modal-backdrop">
          <div className="gs-modal s-card tp-modal-columnas">
            <h3 className="gs-modal-title">Editar "{editando.nombre}"</h3>

            <div className="tp-editor-layout">
              <div className="tp-editor-panel">
                <div className="tp-pagina-fields">
                  <div className="gs-field">
                    <label htmlFor="tp-orientacion" className="gs-field-label">Orientación</label>
                    <select id="tp-orientacion" className="s-input" value={orientacionForm} onChange={e => setOrientacionForm(e.target.value)}>
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </div>
                  <div className="gs-field">
                    <label htmlFor="tp-tamano" className="gs-field-label">Tamaño de página</label>
                    <select id="tp-tamano" className="s-input" value={tamanoPaginaForm} onChange={e => setTamanoPaginaForm(e.target.value)}>
                      <option value="carta">Carta</option>
                      <option value="oficio">Oficio</option>
                    </select>
                  </div>
                </div>

                <label className="tp-layout-toggle">
                  <input type="checkbox" checked={!!layoutForm} onChange={e => activarLayoutLibre(e.target.checked)} />
                  Personalizar posición del encabezado y el pie
                </label>

                {layoutForm && (
                  <div className="tp-layout-canvases">
                    {[
                      { titulo: "Encabezado", ref: canvasHeaderRef, altoMm: ALTURA_MEMBRETE_MM, bloques: ["izq", "der"] },
                      { titulo: "Pie", ref: canvasPieRef, altoMm: ALTURA_PIE_MM, bloques: ["pie"] },
                    ].map(zona => (
                      <div key={zona.titulo} className="tp-layout-zona">
                        <div className="tp-layout-zona-titulo">{zona.titulo}</div>
                        <div
                          ref={zona.ref}
                          className="tp-layout-canvas"
                          style={{ width: anchoLienzoMm * pxPorMmEditor, height: zona.altoMm * pxPorMmEditor }}
                        >
                          {BLOQUES_LAYOUT.filter(b => zona.bloques.includes(b.key)).map(b => {
                            const punto = layoutForm.bloques[b.key] || { x: 0, y: 0 };
                            return (
                              <div
                                key={b.key}
                                className="tp-layout-chip"
                                style={{ left: punto.x * pxPorMmEditor, top: punto.y * pxPorMmEditor }}
                                onPointerDown={iniciarArrastre}
                                onPointerMove={arrastrar(b.key, zona.ref, zona.altoMm)}
                              >
                                {b.label}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <p className="gs-field-hint">Arrastra cada bloque a la posición deseada.</p>
                  </div>
                )}

                <p className="gs-field-hint">Marca las columnas visibles, ajusta su nombre y reordénalas con las flechas.</p>
                <div className="tp-columnas-lista">
                  {columnasForm.map((c, i) => (
                    <div key={c.campo} className={`tp-columna-fila ${c.visible ? "" : "tp-columna-fila--oculta"}`}>
                      <label className="tp-columna-check">
                        <input type="checkbox" checked={c.visible} onChange={() => toggleVisible(c.campo)} />
                      </label>
                      <input
                        className="s-input tp-columna-etiqueta"
                        value={c.etiqueta}
                        maxLength={40}
                        disabled={!c.visible}
                        onChange={e => cambiarEtiqueta(c.campo, e.target.value)}
                      />
                      <div className="tp-columna-mover">
                        <button type="button" className="gs-action-btn" disabled={i === 0} onClick={() => mover(i, -1)} title="Subir">
                          <i className="ti ti-arrow-up" aria-hidden="true" />
                        </button>
                        <button type="button" className="gs-action-btn" disabled={i === columnasForm.length - 1} onClick={() => mover(i, 1)} title="Bajar">
                          <i className="ti ti-arrow-down" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="tp-preview-panel">
                <div className="gs-field-label">Vista previa</div>
                <div className="tp-preview-wrap" style={{ height: dimensionPagina.h * ESCALA_PREVIEW }}>
                  <iframe
                    key={editando.id /* fuerza remount al cambiar de plantilla, evita preview "pegada" de la anterior */}
                    title="Vista previa de impresión"
                    srcDoc={previewHtml}
                    className="tp-preview-iframe"
                    style={{
                      width: dimensionPagina.w,
                      height: dimensionPagina.h,
                      transform: `scale(${ESCALA_PREVIEW})`,
                    }}
                  />
                </div>
                <p className="gs-field-hint">
                  Con datos de muestra, no del horario real. El membrete usa la
                  configuración de Reportes; el resultado impreso real puede
                  variar levemente según el navegador.
                </p>
              </div>
            </div>

            <div className="gs-modal-footer">
              <button type="button" className="s-btn s-btn--cancel" onClick={cerrarEditorColumnas} disabled={guardandoColumnas}>Cancelar</button>
              <button type="button" className="gs-btn-guardar" onClick={handleGuardarColumnas} disabled={guardandoColumnas}>
                {guardandoColumnas ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
