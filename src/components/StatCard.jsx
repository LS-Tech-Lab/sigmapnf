import React from 'react';
import PropTypes from 'prop-types';

// Fix A3/S3 (auditoría QA 5/jul/2026, Fase 2): antes recibía un `color`
// arbitrario e inyectaba `--stat-bg`/`--stat-color` vía style inline. Los 8
// usos reales en todo el repo (ResumenView, DocentesView) solo pasan uno de
// 7 colores fijos — se reemplaza por `variant` + clases en index.css.
// De paso corrige un bug latente: cuando `color` venía como `var(--brand-500)`
// (DocentesView), `${color}18` producía el string inválido
// "var(--brand-500)18" — el tinte de fondo de esas 4 tarjetas nunca se veía.
export default function StatCard({ label, value, icon, variant = "brand" }) {
  return (
    <div className={`s-card sc-root sc-root--${variant}`}>
      <div className="sc-icon-wrap">
        <i className={`ti ${icon} sc-icon`} aria-hidden="true" />
      </div>
      <div>
        <div className="sc-value">{value}</div>
        <div className="sc-label">{label}</div>
      </div>
    </div>
  );
}

// Fix ARCH-17 (auditoría 12 de julio): PropTypes agregado como contrato de
// props — no cambia comportamiento. `value` acepta string o number: se usa
// tanto para conteos (number) como para valores ya formateados (string) en
// los 8 usos reales (ResumenView, DocentesView). `variant` restringido a
// los 7 valores reales confirmados contra `sc-root--*` en index.css y los
// dos call sites (ResumenView, DocentesView): brand, danger, purple,
// role-coord, sky, success, warning.
StatCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  icon: PropTypes.string.isRequired,
  variant: PropTypes.oneOf(["brand", "danger", "purple", "role-coord", "sky", "success", "warning"]),
};
