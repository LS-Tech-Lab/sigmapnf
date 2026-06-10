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
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        background: `hsl(${hue},55%,90%)`,
        color: `hsl(${hue},55%,35%)`,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
