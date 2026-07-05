import React from 'react';

export default function StatCard({ label, value, icon, color = "#2563EB" }) {
  return (
    <div className="s-card sc-root" style={{ '--stat-bg': `${color}18`, '--stat-color': color }}>
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
