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
import "../GestionSedes.css";

export default function TabAsignacion({ showToast, logAudit, refrescarClave }) {
  const [sedes,     setSedes]     = useState([]);
  const [programas, setProgramas] = useState([]);
  const [activos,   setActivos]   = useState({}); // { "sedeId::programaId": boolean }
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [guardando, setGuardando] = useState(null); // clave "sedeId::programaId" en vuelo

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
      <div className="gs-header">
        <div>
          <h2 className="gs-title">
            <i className="ti ti-grid-dots" aria-hidden="true" /> Asignación
          </h2>
          <p className="gs-subtitle">
            Marca qué programas están activos en cada sede. Un programa
            desactivado en una sede deja de ofrecerse ahí (selectores de
            usuarios, panel QR, etc.) sin afectar su historial ni a las
            demás sedes.
          </p>
        </div>
      </div>

      {error && <div className="gs-error">{error}</div>}

      {sedes.length === 0 || programas.length === 0 ? (
        <div className="s-card gs-table-card">
          <p className="s-td gs-td-empty">
            Hace falta al menos una sede y un programa activos para configurar la asignación.
          </p>
        </div>
      ) : (
        <div className="s-card gs-table-card gs-matriz-wrap">
          <table className="gs-table gs-matriz">
            <thead>
              <tr>
                <th className="s-th gs-matriz-esquina">Sede \ Programa</th>
                {programas.map(p => (
                  <th key={p.id} className="s-th gs-matriz-col">{p.nombre}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sedes.map(sede => (
                <tr key={sede.id}>
                  <td className="s-td gs-nombre gs-matriz-fila">{sede.nombre}</td>
                  {programas.map(programa => {
                    const clave = `${sede.id}::${programa.id}`;
                    const activo = activos[clave] ?? true;
                    const enVuelo = guardando === clave;
                    return (
                      <td key={programa.id} className="s-td gs-matriz-celda">
                        <button
                          type="button"
                          disabled={enVuelo}
                          onClick={() => toggle(sede, programa)}
                          title={`${programa.nombre} en ${sede.nombre}: ${activo ? "activo" : "inactivo"}`}
                          aria-pressed={activo}
                          className={`gs-matriz-toggle ${activo ? "gs-matriz-toggle--activo" : "gs-matriz-toggle--inactivo"}`}
                        >
                          <i className={`ti ${activo ? "ti-check" : "ti-x"}`} aria-hidden="true" />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
