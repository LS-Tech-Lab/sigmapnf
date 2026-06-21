/**
 * DocenteScan
 *
 * Página pública que abre el docente al escanear el QR.
 * No requiere sesión Supabase (acceso anónimo).
 *
 * Flujo:
 *  - Elige tipo de marca: Entrada o Salida
 *  - Primera vez: pide cédula + nombre completo
 *    -> FIX (cedula-validacion-formato): se valida el formato (V/E + 6-9
 *       dígitos) antes de continuar.
 *    -> FIX (cedula-confirmacion-visual): se muestra una pantalla de
 *       confirmación con la cédula en grande para que el docente revise que
 *       no se equivocó al escribirla, ANTES de guardarla en localStorage o
 *       enviarla al servidor.
 *  - Siguientes veces (mismo dispositivo, datos ya en localStorage): muestra
 *    los datos guardados y pide solo confirmar.
 *  - Llama a registrar_asistencia() RPC con el tipo elegido
 *  - Muestra resultado con UI clara según código de respuesta, incluyendo
 *    el detalle de materias/sección/hora que le tocan al docente ese día
 *    (horario_hoy, devuelto por la misma RPC)
 *
 * Este archivo orquesta las piezas del flujo, que viven divididas en:
 *   - cedula.js              normalización/validación/frescura de identidad
 *   - deviceFingerprint.js   huella de dispositivo
 *   - icons.jsx              iconos de resultado + mapa RESULTADO_UI
 *   - Shell.jsx, Campo.jsx   contenedor e input reutilizables
 *   - HorarioHoyCard.jsx     tarjeta de horario del día
 *   - SelectorTipo.jsx       pantalla inicial Entrada/Salida
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { fechaHoyVE } from "../../../utils/time";

import { LS_KEY, avisoStale, normalizarCedula, cedulaTieneFormatoValido } from "./cedula";
import { calcularDeviceFingerprint } from "./deviceFingerprint";
import { IconError, RESULTADO_UI } from "./icons";
import Shell from "./Shell";
import Campo from "./Campo";
import HorarioHoyCard from "./HorarioHoyCard";
import SelectorTipo from "./SelectorTipo";

export default function DocenteScan() {
  const token = new URLSearchParams(window.location.search).get("token");

  // Tipo de marca elegido por el docente: null | "ENTRADA" | "SALIDA"
  const [tipo, setTipo] = useState(null);

  // Datos guardados del docente
  const [datosGuardados, setDatosGuardados] = useState(null);
  // Formulario (primera vez)
  const [cedula,  setCedula]  = useState("");
  const [nombre,  setNombre]  = useState("");
  // FIX (cedula-validacion-formato): mensaje de error de formato de cédula
  const [errorCedula, setErrorCedula] = useState("");
  // FIX (cedula-confirmacion-visual): datos recién tipeados (primera vez),
  // pendientes de que el docente confirme visualmente antes de registrarlos.
  // Separado de `datosGuardados` (que es para datos YA guardados de visitas
  // anteriores) para no mezclar los dos flujos.
  const [datosNuevos, setDatosNuevos] = useState(null);
  // Estado de UI
  const [paso,      setPaso]      = useState("cargando"); // cargando | formulario | confirmar | confirmar_nuevo | resultado
  const [resultado, setResultado] = useState(null);
  const [loading,   setLoading]   = useState(false);

  // Al montar: verificar si hay datos guardados en localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const datos = JSON.parse(raw);
        if (datos?.cedula && datos?.nombre) {
          setDatosGuardados(datos);
          setCedula(datos.cedula);
          setNombre(datos.nombre);
          setPaso("confirmar");
          return;
        }
      }
    } catch {}
    setPaso("formulario");
  }, []);

  // Guardar datos en localStorage al confirmar
  const guardarDatos = (c, n) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        cedula: c,
        nombre: n,
        fecha: fechaHoyVE(),
        guardadoEn: Date.now(),
      }));
    } catch {}
  };

  const registrar = useCallback(async (cedulaFinal, nombreFinal, tipoFinal) => {
    setLoading(true);
    try {
      const fingerprint = await calcularDeviceFingerprint();
      const cedulaNorm  = normalizarCedula(cedulaFinal.trim());

      const { data, error: rpcErr } = await supabase.rpc("registrar_asistencia", {
        p_token:              token,
        p_cedula_docente:     cedulaNorm,
        p_nombre_docente:     nombreFinal.trim() || cedulaNorm,
        p_device_fingerprint: fingerprint,
        p_tipo:               tipoFinal,
      });

      if (rpcErr) throw rpcErr;
      if (data?.ok) {
        guardarDatos(cedulaNorm, nombreFinal.trim() || cedulaNorm);
        // Mantener el estado en memoria sincronizado con localStorage para
        // que "Registrar otra marca" (ej. salida tras entrada) en la misma
        // sesión use el paso de confirmación con estos datos ya validados.
        setDatosGuardados({
          cedula: cedulaNorm,
          nombre: nombreFinal.trim() || cedulaNorm,
          fecha: fechaHoyVE(),
          guardadoEn: Date.now(),
        });
      }
      setResultado(data);
      setPaso("resultado");
    } catch (err) {
      setResultado({ ok: false, codigo: "ERROR", mensaje: err.message || "Error de conexión." });
      setPaso("resultado");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const handleFormulario = (e) => {
    e.preventDefault();
    setErrorCedula("");
    if (!cedula.trim() || !nombre.trim()) return;

    // FIX (cedula-validacion-formato): rechazar formatos imposibles antes de
    // guardar nada (ej. letras sueltas, demasiados/pocos dígitos).
    const cedulaNorm = normalizarCedula(cedula.trim());
    if (!cedulaTieneFormatoValido(cedulaNorm)) {
      setErrorCedula("Eso no parece una cédula válida. Usa el formato V-12345678 o E-12345678 (solo números después del guion, entre 6 y 9 dígitos).");
      return;
    }

    // FIX (cedula-confirmacion-visual): en vez de registrar de una vez,
    // mostramos los datos en grande para que el docente revise que no se
    // equivocó al escribir su cédula (un solo dígito mal crea una
    // identidad duplicada que después no cruza con su horario real).
    setDatosNuevos({ cedula: cedulaNorm, nombre: nombre.trim() });
    setPaso("confirmar_nuevo");
  };

  const handleConfirmarNuevo = () => {
    if (!datosNuevos) return;
    registrar(datosNuevos.cedula, datosNuevos.nombre, tipo);
  };

  const handleCorregirNuevo = () => {
    setPaso("formulario");
  };

  const handleConfirmar = () => {
    registrar(datosGuardados.cedula, datosGuardados.nombre, tipo);
  };

  const handleCambiarDatos = () => {
    setPaso("formulario");
    setCedula("");
    setNombre("");
  };

  const handleVolverASelectorTipo = () => {
    setTipo(null);
    setResultado(null);
    // Recupera el paso correcto según si hay datos guardados o no
    setPaso(datosGuardados ? "confirmar" : "formulario");
  };

  // ── Sin token ────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <Shell>
        <IconError />
        <h2 style={{ margin:"16px 0 8px", fontSize:"clamp(19px,5vw,24px)", color:"#991B1B", textAlign:"center" }}>Enlace inválido</h2>
        <p style={{ margin:0, fontSize:14, color:"#6B7280", textAlign:"center" }}>
          Escanea el código QR desde la pantalla del aula para registrar tu asistencia.
        </p>
      </Shell>
    );
  }

  // ── Cargando ─────────────────────────────────────────────────────────────
  if (paso === "cargando") {
    return (
      <Shell>
        <div style={{ fontSize:36, marginBottom:12 }}>⏳</div>
        <p style={{ color:"#6B7280", fontSize:14 }}>Cargando…</p>
      </Shell>
    );
  }

  // ── Elegir tipo (Entrada/Salida) ─────────────────────────────────────────
  if (!tipo) {
    return <SelectorTipo onElegir={setTipo} />;
  }

  // ── Resultado ────────────────────────────────────────────────────────────
  if (paso === "resultado" && resultado) {
    const tipoUi = resultado.ok ? "ok" : (resultado.codigo || "ERROR");
    const ui     = RESULTADO_UI[tipoUi] || RESULTADO_UI.ERROR;
    const { Icon, titulo, color, hint } = ui;
    return (
      <Shell ancho={420}>
        <Icon />
        <h2 style={{ margin:"16px 0 6px", fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color, textAlign:"center" }}>{titulo}</h2>
        <p style={{ margin:0, fontSize:"clamp(15px,3.5vw,18px)", color:"#374151", textAlign:"center", lineHeight:1.55 }}>{resultado.mensaje}</p>
        {hint && <p style={{ margin:"10px 0 0", fontSize:13, color:"#6B7280", textAlign:"center" }}>{hint}</p>}

        {/* Si fue exitoso, mostrar datos registrados */}
        {resultado.ok && (
          <div style={{ marginTop:20, background:"#F0FDF4", border:"1px solid #86EFAC", borderRadius:12, padding:"14px 18px", width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:12, color:"#166534", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
              {resultado.tipo === "SALIDA" ? "Salida registrada" : "Entrada registrada"}
            </div>
            <div style={{ fontSize:15, fontWeight:700, color:"#15803D" }}>{nombre || datosGuardados?.nombre}</div>
            <div style={{ fontSize:13, color:"#166534", fontFamily:"monospace", marginTop:2 }}>{normalizarCedula(cedula || datosGuardados?.cedula || "")}</div>
          </div>
        )}

        {/* Detalle de materias/sección/hora del día, devuelto por la RPC */}
        {resultado.ok && (
          <HorarioHoyCard horarioHoy={resultado.horario_hoy} diaSemana={resultado.dia_semana} />
        )}

        {/* Permitir registrar el otro tipo (ej. salida tras entrada) sin recargar */}
        <button
          onClick={handleVolverASelectorTipo}
          style={{ marginTop:18, background:"none", border:"none", color:"#2563EB", fontSize:13, fontWeight:600, cursor:"pointer" }}
        >
          ← Registrar otra marca
        </button>
      </Shell>
    );
  }

  // ── Confirmación visual de datos nuevos (primera vez) ────────────────────
  // FIX (cedula-confirmacion-visual): paso intermedio entre el formulario y
  // el registro real. Muestra la cédula en grande y separada por caracteres
  // para que errores de un solo dígito (como V-18341488 vs V-18341588) sean
  // fáciles de detectar a simple vista antes de guardarse.
  if (paso === "confirmar_nuevo" && datosNuevos) {
    return (
      <Shell>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ width:"clamp(60px,14vw,76px)", height:"clamp(60px,14vw,76px)", borderRadius:14, background:"linear-gradient(135deg,#1E3A8A,#2563EB)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"clamp(28px,7vw,36px)", margin:"0 auto clamp(14px,3vw,18px)" }}>👀</div>
          <h1 style={{ margin:0, fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color:"#111827" }}>Verifica tus datos</h1>
          <p style={{ margin:"5px 0 0", fontSize:"clamp(15px,3.5vw,17px)", color:"#6B7280" }}>Revisa especialmente tu cédula antes de continuar</p>
        </div>

        <div style={{ width:"100%", background:"#FFFBEB", border:"1.5px solid #FCD34D", borderRadius:10, padding:"10px 14px", marginBottom:16, display:"flex", gap:8, alignItems:"flex-start" }}>
          <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
          <p style={{ margin:0, fontSize:12, color:"#92400E", lineHeight:1.5 }}>
            Un solo número equivocado registra tu asistencia con una identidad distinta y puede hacer que aparezcas como ausente.
          </p>
        </div>

        <div style={{ width:"100%", background:"#F8FAFC", border:"1.5px solid #E2E8F0", borderRadius:12, padding:"18px", marginBottom:20, textAlign:"center" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Tu cédula</div>
          <div style={{ fontSize:"clamp(28px,7vw,36px)", fontWeight:800, color:"#111827", fontFamily:"monospace", letterSpacing:"0.04em" }}>
            {datosNuevos.cedula}
          </div>
          <div style={{ height:1, background:"#E2E8F0", margin:"14px 0" }} />
          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Tu nombre</div>
          <div style={{ fontSize:"clamp(17px,4vw,20px)", fontWeight:700, color:"#111827" }}>{datosNuevos.nombre}</div>
        </div>

        <button
          onClick={handleConfirmarNuevo}
          disabled={loading}
          style={{ width:"100%", padding:"clamp(16px,4vw,20px) 0", background: loading ? "#93C5FD" : "#2563EB", color:"#fff", border:"none", borderRadius:12, fontSize:"clamp(17px,4.5vw,20px)", fontWeight:800, cursor: loading ? "not-allowed" : "pointer", marginBottom:10 }}
        >
          {loading ? "Registrando…" : `✅ Confirmar y registrar mi ${tipo === "SALIDA" ? "salida" : "entrada"}`}
        </button>

        <button
          onClick={handleCorregirNuevo}
          style={{ background:"none", border:"none", color:"#6B7280", fontSize:13, cursor:"pointer", textDecoration:"underline", marginBottom:6 }}
        >
          ✏️ Corregir mis datos
        </button>
      </Shell>
    );
  }

  if (paso === "confirmar" && datosGuardados) {
    const aviso = avisoStale(datosGuardados);
    return (
      <Shell>
        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ width:"clamp(60px,14vw,76px)", height:"clamp(60px,14vw,76px)", borderRadius:14, background:"linear-gradient(135deg,#1E3A8A,#2563EB)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"clamp(28px,7vw,36px)", margin:"0 auto clamp(14px,3vw,18px)" }}>{tipo === "SALIDA" ? "🔴" : "🟢"}</div>
          <h1 style={{ margin:0, fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color:"#111827" }}>{tipo === "SALIDA" ? "Registrar Salida" : "Registrar Entrada"}</h1>
          <p style={{ margin:"5px 0 0", fontSize:"clamp(15px,3.5vw,17px)", color:"#6B7280" }}>Confirma que eres tú para continuar</p>
        </div>

        {/* Aviso de datos viejos o de otro día — MEJORA #7 */}
        {aviso && (
          <div style={{ width:"100%", background:"#FFFBEB", border:"1.5px solid #FCD34D", borderRadius:10, padding:"10px 14px", marginBottom:14, display:"flex", gap:8, alignItems:"flex-start" }}>
            <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
            <p style={{ margin:0, fontSize:12, color:"#92400E", lineHeight:1.5 }}>{aviso}</p>
          </div>
        )}

        {/* Tarjeta de datos */}
        <div style={{ width:"100%", background:"#F8FAFC", border:"1.5px solid #E2E8F0", borderRadius:12, padding:"16px 18px", marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Datos guardados en este dispositivo</div>
          <div style={{ fontSize:"clamp(17px,4vw,21px)", fontWeight:700, color:"#111827", marginBottom:4 }}>{datosGuardados.nombre}</div>
          <div style={{ fontSize:"clamp(15px,3.5vw,18px)", color:"#6B7280", fontFamily:"monospace", fontWeight:700 }}>{datosGuardados.cedula}</div>
        </div>

        {/* Botón confirmar */}
        <button
          onClick={handleConfirmar}
          disabled={loading}
          style={{ width:"100%", padding:"clamp(16px,4vw,20px) 0", background: loading ? "#93C5FD" : "#2563EB", color:"#fff", border:"none", borderRadius:12, fontSize:"clamp(17px,4.5vw,20px)", fontWeight:800, cursor: loading ? "not-allowed" : "pointer", marginBottom:10 }}
        >
          {loading ? "Registrando…" : `${tipo === "SALIDA" ? "🔴" : "✅"} Confirmar mi ${tipo === "SALIDA" ? "salida" : "entrada"}`}
        </button>

        {/* Enlace para cambiar datos */}
        <button
          onClick={handleCambiarDatos}
          style={{ background:"none", border:"none", color:"#6B7280", fontSize:13, cursor:"pointer", textDecoration:"underline", marginBottom:6 }}
        >
          No soy yo — usar otros datos
        </button>

        {/* Volver a elegir entrada/salida */}
        <button
          onClick={() => setTipo(null)}
          style={{ background:"none", border:"none", color:"#9CA3AF", fontSize:12, cursor:"pointer" }}
        >
          ← Cambiar tipo de registro
        </button>
      </Shell>
    );
  }

  // ── Formulario (primera vez) ─────────────────────────────────────────────
  return (
    <Shell>
      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:24, width:"100%" }}>
        <div style={{ width:"clamp(60px,14vw,76px)", height:"clamp(60px,14vw,76px)", borderRadius:14, background:"linear-gradient(135deg,#1E3A8A,#2563EB)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"clamp(28px,7vw,36px)", margin:"0 auto clamp(14px,3vw,18px)" }}>{tipo === "SALIDA" ? "🔴" : "🟢"}</div>
        <h1 style={{ margin:0, fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color:"#111827" }}>{tipo === "SALIDA" ? "Registro de Salida" : "Registro de Entrada"}</h1>
        <p style={{ margin:"5px 0 0", fontSize:"clamp(15px,3.5vw,17px)", color:"#6B7280" }}>Primera vez — ingresa tus datos</p>
      </div>

      <form onSubmit={handleFormulario} style={{ width:"100%" }}>
        <Campo
          label="Cédula de identidad"
          value={cedula}
          onChange={e => { setCedula(e.target.value); if (errorCedula) setErrorCedula(""); }}
          required
          placeholder="V-12345678"
          inputMode="text"
          autoComplete="off"
          autoFocus
          error={errorCedula}
          hint="Solo números después del guion. Ej: V-12345678 o E-87654321"
        />
        <Campo
          label="Nombre completo"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          required
          placeholder="Prof. Juan García"
          autoComplete="name"
          hint="Será recordado para la próxima vez"
        />

        <button
          type="submit"
          disabled={loading || !cedula.trim() || !nombre.trim()}
          style={{ width:"100%", padding:"clamp(16px,4vw,20px) 0", background: loading || !cedula.trim() || !nombre.trim() ? "#93C5FD" : "#2563EB", color:"#fff", border:"none", borderRadius:12, fontSize:"clamp(17px,4.5vw,20px)", fontWeight:800, cursor: loading || !cedula.trim() || !nombre.trim() ? "not-allowed" : "pointer" }}
        >
          {loading ? "Registrando…" : `Registrar mi ${tipo === "SALIDA" ? "salida" : "entrada"}`}
        </button>
      </form>

      <button
        onClick={() => setTipo(null)}
        style={{ marginTop:14, background:"none", border:"none", color:"#9CA3AF", fontSize:12, cursor:"pointer" }}
      >
        ← Cambiar tipo de registro
      </button>

      <p style={{ marginTop:10, fontSize:11, color:"#9CA3AF", textAlign:"center", lineHeight:1.5 }}>
        Tus datos se guardan en este dispositivo para agilizar futuros registros.
      </p>
    </Shell>
  );
}
