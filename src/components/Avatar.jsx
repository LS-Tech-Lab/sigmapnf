import React from 'react';

export default function Avatar({ name, size = 36 }) {
  const safeName = name || "Docente";
  const initials = typeof safeName === "string"
    ? safeName.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?"
    : "??";
  const hue = typeof safeName === "string"
    ? [...safeName].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
    : 0;

  return (
    <div
      className="av-root"
      style={{
        '--av-size': `${size}px`,
        '--av-font-size': `${size * 0.38}px`,
        '--av-bg': `hsl(${hue},55%,90%)`,
        '--av-color': `hsl(${hue},55%,35%)`,
      }}
    >
      {initials}
    </div>
  );
}
