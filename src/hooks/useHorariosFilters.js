import { useState, useMemo } from "react";

/**
 * Mejora 11: hook que encapsula el estado de filtros y la celda expandida
 * de HorariosView. Antes vivían en App.jsx causando prop drilling innecesario.
 *
 * Uso en HorariosView:
 *   const filters = useHorariosFilters(data);
 *   // filters.selectedTrayecto, filters.setSelectedTrayecto, etc.
 */
export default function useHorariosFilters(data = []) {
  const [selectedTrayecto, setSelectedTrayecto] = useState("all");
  const [selectedSeccion, setSelectedSeccion] = useState("all");
  const [activeDay, setActiveDay] = useState("all");
  const [expandedCell, setExpandedCell] = useState(null);

  // Secciones disponibles según el trayecto seleccionado
  const seccionesByTrayecto = useMemo(() => {
    if (!data.length) return [];
    return [...new Set(data.map(d => d.sheet.trim()))].sort().filter(s =>
      selectedTrayecto === "all" || data.some(d => d.sheet.trim() === s && d.trayecto === selectedTrayecto)
    );
  }, [selectedTrayecto, data]);

  const handleSetTrayecto = (t) => {
    setSelectedTrayecto(t);
    setSelectedSeccion("all"); // resetear sección al cambiar trayecto
  };

  // A-4: al cambiar lapso desde App.jsx, los filtros del lapso anterior
  // pueden no existir en el nuevo lapso → resetear todo para evitar
  // que `filtered` quede vacío sin aviso al usuario.
  const resetFilters = () => {
    setSelectedTrayecto("all");
    setSelectedSeccion("all");
    setActiveDay("all");
    setExpandedCell(null);
  };

  return {
    selectedTrayecto, setSelectedTrayecto: handleSetTrayecto,
    selectedSeccion, setSelectedSeccion,
    activeDay, setActiveDay,
    expandedCell, setExpandedCell,
    seccionesByTrayecto,
    resetFilters,
  };
}
