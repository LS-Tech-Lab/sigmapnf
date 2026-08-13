// plantillasImpresion.js — Fase 1 del editor de plantillas (migración
// 0091, 12 ago 2026).
//
// Única fuente de verdad para el set de `campo` válidos de
// tipo_reporte='planilla_asistencia_turno' y su etiqueta por defecto.
// La comparten:
//   - PlanillaImprimibleBase.jsx (el renderer -- usa DEFAULT_COLUMNAS_BLOQUE
//     como respaldo si no hay plantilla resuelta, y valida `campo` contra
//     este set antes de pintar una columna).
//   - TabPlantillas.jsx (el panel admin -- usa CAMPOS_PLANILLA_TURNO para
//     saber qué campos existen y ofrecerlos al armar/editar una plantilla,
//     incluso los que estén ocultos en la plantilla actual).
// Si en el futuro se agrega un campo nuevo (por ejemplo si se suma una
// columna de "trayecto"), se agrega UNA vez acá y ambos lados lo ven.
export const CAMPOS_PLANILLA_TURNO = [
  { campo: "hora",          etiquetaDefault: "Hora" },
  { campo: "asignatura",    etiquetaDefault: "Asignatura" },
  { campo: "seccion",       etiquetaDefault: "Sección" },
  { campo: "profesor",      etiquetaDefault: "Profesor" },
  { campo: "actividad",     etiquetaDefault: "Actividad" },
  { campo: "firma_entrada", etiquetaDefault: "Firma Entrada" },
  { campo: "firma_salida",  etiquetaDefault: "Firma Salida" },
  { campo: "aula",          etiquetaDefault: "Aula" },
  { campo: "observacion",   etiquetaDefault: "Observación" },
];

// Mismo contenido que la semilla de la migración 0091 -- si se edita acá,
// hay que editar también el INSERT de esa migración (no se puede
// importar SQL desde JS). Sirve de respaldo cuando no hay ninguna
// plantilla resuelta desde la BD.
export const DEFAULT_COLUMNAS_BLOQUE = CAMPOS_PLANILLA_TURNO.map((c, i) => ({
  campo: c.campo,
  etiqueta: c.etiquetaDefault,
  orden: i + 1,
  visible: true,
}));
