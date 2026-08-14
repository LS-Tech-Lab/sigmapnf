// TabAsignacion.jsx — PROG-4 (12 ago 2026)
//
// Matriz sede × programa: por cada combinación, un toggle sobre
// `sedes_programas.activo` (0090). Solo muestra sedes y programas
// ACTIVOS del catálogo (una sede/programa desactivado ya no aparece en
// ningún selector de la app, así que ajustar su asignación no tiene
// efecto observable -- para reactivarlos primero hay que activarlos en
// sus pestañas respectivas).
//
// A diferencia de TabSedes/TabProgramas, acá no hay alta/edición/
// activar-desactivar de la sede o el programa en sí -- solo del cruce
// entre ambos. Por diseño de 0090 se espera que exista una fila por cada
// combinación sede×programa (backfill + creación automática al dar de
// alta una sede o programa nuevos) -- si por algún motivo faltara una
// fila (dato corrupto o migración a medias), el toggle la crea con
// upsert en vez de fallar.
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import "../usuarios/PestanaUsuarios.css"; // rediseño 14 ago 2026: pu-toolbar/pu-search-input
import "../GestionSedes.css";

export default function TabAsignacion({ showToast, logAudit, refrescarClave }) {
  const [sedes,     setSedes]     = useState([]);
  const [programas, setProgramas] = useState([]);
  const [activos,   setActivos]   = useState({}); // { "sedeId::programaId": boolean }
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [guardando, setGuardando] = useState(null); // clave "sedeId::programaId" en vuelo
  const [busqueda,  setBusqueda]  = useState(""); // UX-37: filtro por nombre de sede

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [resSedes, resProgramas, resAsignacion] = await Promise.all([
      supabase.from("sedes").select("id, nombre").eq("activa", true).order("orden", { ascending: true }),
      supabase.from("programas").select("id, nombre").eq("activa", true).order("orden", { ascending: true }),
      supabase.from("sedes_programas").select("sede_id, programa_id, activo"),
    ]);

    const err = resSedes.error || resProgramas.error || resAsignacion.error;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setSedes(resSedes.data || []);
    setProgramas(resProgramas.data || []);

    const mapa = {};
    for (const fila of resAsignacion.data || []) {
      mapa[`${fila.sede_id}::${fila.programa_id}`] = fila.activo;
    }
    setActivos(mapa);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar, refrescarClave]);

  const toggle = async (sede, programa) => {
    const clave = `${sede.id}::${programa.id}`;
    const actual = activos[clave] ?? true; // ausencia de fila = tratar como activa (backfill garantiza que exista)
    const nuevoValor = !actual;

    setGuardando(clave);
    try {
      // upsert por si faltara la fila (no debería, ver comentario arriba).
      const { error: err } = await supabase
        .from("sedes_programas")
        .upsert({ sede_id: sede.id, programa_id: programa.id, activo: nuevoValor }, { onConflict: "sede_id,programa_id" });
      if (err) throw err;

      await logAudit?.({
        accion:     nuevoValor ? "ACTIVAR_PROGRAMA_EN_SEDE" : "DESACTIVAR_PROGRAMA_EN_SEDE",
        entidad:    "sedes_programas",
        entidad_id: clave,
        resumen:    `"${programa.nombre}" ${nuevoValor ? "activado" : "desactivado"} en "${sede.nombre}".`,
      });
      setActivos(prev => ({ ...prev, [clave]: nuevoValor }));
    } catch (e) {
      showToast?.(e.message || "No se pudo actualizar la asignación.", "error");
    }
    setGuardando(null);
  };

  if (loading) {
    return (
      <div className="gs-loading">
        <i className="ti ti-loader-2 lazy-spin" aria-hidden="true" /> Cargando asignación…
      </div>
    );
  }

  return (
    <div>
      {/* Rediseño 14 ago 2026 (pedido LS): sin título propio -- lo
          muestra el header único de GestionSedes.jsx (mismo criterio
          que TabSedes.jsx/TabProgramas.jsx). Queda solo la línea de
          ayuda, como hint suelto (mismo estilo que uv-subtitle), y el
          buscador pasa a pu-toolbar/pu-search-input para verse igual
          que la barra de búsqueda de Usuarios y Roles. */}
      <p className="uv-subtitle gs-hint">
        Marca qué programas están activos en cada sede. Un programa
        desactivado en una sede deja de ofrecerse ahí (selectores de
        usuarios, panel QR, etc.) sin afectar su historial ni a las
        demás sedes.
      </p>

      {error && <div className="gs-error">{error}</div>}

      {sedes.length === 0 || programas.length === 0 ? (
        <div className="s-card gs-list-card">
          <p className="gs-td-empty">
            Hace falta al menos una sede y un programa activos para configurar la asignación.
          </p>
        </div>
      ) : (
        <>
          {/* UX-37 (LS, 12 ago 2026): la matriz sede×programa se reemplazó
              por una lista de sedes, cada una con sus programas como
              chips en flex-wrap. Una matriz necesita el ancho de TODOS
              los programas en una sola fila -- con 5+ programas eso ya
              obligaba a scroll horizontal aunque sobrara pantalla a los
              lados (medido con Playwright: 1065px de contenido vs 858px
              disponibles a max-width:900px, y seguía pidiendo scroll
              incluso ampliado a 1200px en ventanas angostas o en
              móvil). Los chips en cambio se envuelven a la siguiente
              línea solos -- nunca necesitan más ancho del que hay, sin
              importar cuántas sedes o programas se agreguen a futuro.
              El buscador es nuevo: con 11 sedes la lista ya es larga
              verticalmente, y encontrar una sede por nombre es más
              rápido que desplazarse. */}
          {sedes.length > 5 && (
            <div className="pu-toolbar">
              <input
                type="text"
                className="s-input pu-search-input"
                placeholder="Buscar sede…"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
              />
            </div>
          )}
          <div className="gs-asig-lista">
            {sedes
              .filter(sede => sede.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
              .map(sede => (
                <div key={sede.id} className="s-card gs-asig-sede">
                  <div className="gs-asig-sede-nombre">{sede.nombre}</div>
                  <div className="gs-asig-chips">
                    {programas.map(programa => {
                      const clave = `${sede.id}::${programa.id}`;
                      const activo = activos[clave] ?? true;
                      const enVuelo = guardando === clave;
                      return (
                        <button
                          key={programa.id}
                          type="button"
                          disabled={enVuelo}
                          onClick={() => toggle(sede, programa)}
                          title={`${programa.nombre} en ${sede.nombre}: ${activo ? "activo" : "inactivo"}`}
                          aria-pressed={activo}
                          className={`gs-chip ${activo ? "gs-chip--activo" : "gs-chip--inactivo"}`}
                        >
                          <i className={`ti ${activo ? "ti-check" : "ti-x"}`} aria-hidden="true" />
                          {programa.nombre}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
