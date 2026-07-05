// Chip visual con el estado real del docente (entrada/salida/anómalo).
const ESTADOS = {
  completo:     { label: "Entrada y salida", icon: "ti-checks" },
  solo_entrada: { label: "Solo entrada",     icon: "ti-circle-half" },
  solo_salida:  { label: "Solo salida",      icon: "ti-alert-circle" },
};

function EstadoChip({ estado }) {
  const key = ESTADOS[estado] ? estado : "solo_entrada";
  const ui = ESTADOS[key];
  return (
    <span className={`ec-chip ec-chip--${key}`}>
      <i className={`ti ${ui.icon} ec-chip-icon`} aria-hidden="true" />
      {ui.label}
    </span>
  );
}

export default EstadoChip;
