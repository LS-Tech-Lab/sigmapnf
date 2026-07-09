import React from 'react';

// Fix A3/S3 (auditoría QA 5/jul/2026, Fase 5): los 4 usos reales en todo el
// repo solo pasan size={30|44|52} — tamaño fijo, ya no --av-size/--av-font-size
// inline. El tono de color por nombre (`hue`, hash de caracteres, 0-359°) SÍ
// es un dominio genuinamente continuo/arbitrario (nombres de docentes) — se
// bucketiza a pasos de 15° (24 clases .av-hue-0…av-hue-345 en index.css) en
// vez de dejarlo inline permanentemente. Se pierde precisión de tono exacto
// (nombres distintos pueden compartir bucket), se gana cierre completo de S3.
export default function Avatar({ name, size = 36 }) {
  const safeName = name || "Docente";
  const initials = typeof safeName === "string"
    ? safeName.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?"
    : "??";
  const hue = typeof safeName === "string"
    ? [...safeName].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
    : 0;
  const hueBucket = Math.round(hue / 15) * 15 % 360;
  // El default (36) no se usa en ningún call site real hoy; si llegara a
  // usarse, cae en el tamaño conocido más cercano (44) en vez de romper.
  const sizeSlug = [30, 44, 52].includes(size) ? size : 44;

  return (
    <div className={`av-root av-size-${sizeSlug} av-hue-${hueBucket}`}>
      {initials}
    </div>
  );
}
