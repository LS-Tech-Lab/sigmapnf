/**
 * DocenteScan — Página pública que abre el docente al escanear el QR.
 * No requiere sesión Supabase (acceso anónimo).
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

  const [tipo, setTipo] = useState(null);
  const [datosGuardados, setDatosGuardados] = useState(null);
  const [cedula,  setCedula]  = useState("");
  const [nombre,  setNombre]  = useState("");
  const [errorCedula, setErrorCedula] = useState("");
  const [datosNuevos, setDatosNuevos] = useState(null);
  const [paso,      setPaso]      = useState("cargando");
  const [resultado, setResultado] = useState(null);
  const [loading,   setLoading]   = useState(false);

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

  const guardarDatos = (c, n) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        cedula: c, nombre: n, fecha: fechaHoyVE(), guardadoEn: Date.now(),
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
        setDatosGuardados({
          cedula: cedulaNorm, nombre: nombreFinal.trim() || cedulaNorm,
          fecha: fechaHoyVE(), guardadoEn: Date.now(),
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

    const cedulaNorm = normalizarCedula(cedula.trim());
    if (!cedulaTieneFormatoValido(cedulaNorm)) {
      setErrorCedula("Eso no parece una cédula válida. Usa el formato V-12345678 o E-12345678 (solo números después del guion, entre 6 y 9 dígitos).");
      return;
    }

    setDatosNuevos({ cedula: cedulaNorm, nombre: nombre.trim() });
    setPaso("confirmar_nuevo");
  };

  const handleConfirmarNuevo = () => { if (!datosNuevos) return; registrar(datosNuevos.cedula, datosNuevos.nombre, tipo); };
  const handleCorregirNuevo  = () => setPaso("formulario");
  const handleConfirmar      = () => registrar(datosGuardados.cedula, datosGuardados.nombre, tipo);
  const handleCambiarDatos   = () => { setPaso("formulario"); setCedula(""); setNombre(""); };
  const handleVolverASelectorTipo = () => {
    setTipo(null); setResultado(null);
    setPaso(datosGuardados ? "confirmar" : "formulario");
  };

  // ── Sin token ────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <Shell>
        <IconError />
        <h2 style={{ margin:"16px 0 8px", fontSize:"clamp(19px,5vw,24px)", color:"#991B1B", textAlign:"center" }}>Enlace inválido</h2>
        <p style={{ margin:0, fontSize:14, color:"#64748B", textAlign:"center" }}>
          Escanea el código QR desde la pantalla del aula para registrar tu asistencia.
        </p>
      </Shell>
    );
  }

  // ── Cargando ─────────────────────────────────────────────────────────────
  if (paso === "cargando") {
    return (
      <Shell>
        <i className="ti ti-loader-2" style={{ fontSize:40, color:"#2563EB", marginBottom:12, display:"block", animation:"spin 1s linear infinite" }} aria-hidden="true" />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <p style={{ color:"#64748B", fontSize:14 }}>Cargando…</p>
      </Shell>
    );
  }

  // ── Elegir tipo (Entrada/Salida) ─────────────────────────────────────────
  if (!tipo) return <SelectorTipo onElegir={setTipo} />;

  // ── Resultado ────────────────────────────────────────────────────────────
  if (paso === "resultado" && resultado) {
    const tipoUi = resultado.ok ? "ok" : (resultado.codigo || "ERROR");
    const ui     = RESULTADO_UI[tipoUi] || RESULTADO_UI.ERROR;
    const { Icon, titulo, color, hint } = ui;
    return (
      <Shell ancho={420}>
        <Icon />
        <h2 style={{ margin:"16px 0 6px", fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color, textAlign:"center" }}>{titulo}</h2>
        <p style={{ margin:0, fontSize:"clamp(15px,3.5vw,18px)", color:"#334155", textAlign:"center", lineHeight:1.55 }}>{resultado.mensaje}</p>
        {hint && <p style={{ margin:"10px 0 0", fontSize:13, color:"#64748B", textAlign:"center" }}>{hint}</p>}

        {resultado.ok && (
          <div style={{ marginTop:20, background:"#F0FDF4", border:"1px solid #86EFAC", borderRadius:12, padding:"14px 18px", width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:12, color:"#166534", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
              {resultado.tipo === "SALIDA" ? "Salida registrada" : "Entrada registrada"}
            </div>
            <div style={{ fontSize:15, fontWeight:700, color:"#15803D" }}>{nombre || datosGuardados?.nombre}</div>
            <div style={{ fontSize:13, color:"#166534", fontFamily:"monospace", marginTop:2 }}>{normalizarCedula(cedula || datosGuardados?.cedula || "")}</div>
          </div>
        )}

        {resultado.ok && (
          <HorarioHoyCard horarioHoy={resultado.horario_hoy} diaSemana={resultado.dia_semana} />
        )}

        <button
          onClick={handleVolverASelectorTipo}
          style={{ marginTop:18, background:"none", border:"none", color:"#2563EB", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}
        >
          <i className="ti ti-arrow-left" style={{ fontSize:13 }} aria-hidden="true" />
          Registrar otra marca
        </button>
      </Shell>
    );
  }

  // ── Confirmación visual de datos nuevos (primera vez) ────────────────────
  if (paso === "confirmar_nuevo" && datosNuevos) {
    return (
      <Shell>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ width:52, height:52, borderRadius:14, background:"linear-gradient(135deg,#1E3A8A,#2563EB)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
            <i className="ti ti-eye" style={{ fontSize:26, color:"#fff" }} aria-hidden="true" />
          </div>
          <h1 style={{ margin:0, fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color:"#0F172A" }}>Verifica tus datos</h1>
          <p style={{ margin:"5px 0 0", fontSize:"clamp(15px,3.5vw,17px)", color:"#64748B" }}>Revisa especialmente tu cédula antes de continuar</p>
        </div>

        <div style={{ width:"100%", background:"#FFFBEB", border:"1.5px solid #FCD34D", borderRadius:10, padding:"10px 14px", marginBottom:16, display:"flex", gap:8, alignItems:"flex-start" }}>
          <i className="ti ti-alert-triangle" style={{ fontSize:18, color:"#D97706", flexShrink:0, marginTop:1 }} aria-hidden="true" />
          <p style={{ margin:0, fontSize:12, color:"#92400E", lineHeight:1.5 }}>
            Un solo número equivocado registra tu asistencia con una identidad distinta y puede hacer que aparezcas como ausente.
          </p>
        </div>

        <div style={{ width:"100%", background:"#F8FAFC", border:"1.5px solid #E2E8F0", borderRadius:12, padding:"18px", marginBottom:20, textAlign:"center" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Tu cédula</div>
          <div style={{ fontSize:"clamp(28px,7vw,36px)", fontWeight:800, color:"#0F172A", fontFamily:"monospace", letterSpacing:"0.04em" }}>
            {datosNuevos.cedula}
          </div>
          <div style={{ height:1, background:"#E2E8F0", margin:"14px 0" }} />
          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Tu nombre</div>
          <div style={{ fontSize:"clamp(17px,4vw,20px)", fontWeight:700, color:"#0F172A" }}>{datosNuevos.nombre}</div>
        </div>

        <button
          onClick={handleConfirmarNuevo}
          disabled={loading}
          style={{ width:"100%", padding:"clamp(16px,4vw,20px) 0", background: loading ? "#93C5FD" : "#2563EB", color:"#fff", border:"none", borderRadius:12, fontSize:"clamp(17px,4.5vw,20px)", fontWeight:800, cursor: loading ? "not-allowed" : "pointer", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
        >
          <i className="ti ti-check" style={{ fontSize:18 }} aria-hidden="true" />
          {loading ? "Registrando…" : `Confirmar y registrar mi ${tipo === "SALIDA" ? "salida" : "entrada"}`}
        </button>

        <button
          onClick={handleCorregirNuevo}
          style={{ background:"none", border:"none", color:"#64748B", fontSize:13, cursor:"pointer", textDecoration:"underline", marginBottom:6, display:"flex", alignItems:"center", gap:4 }}
        >
          <i className="ti ti-pencil" style={{ fontSize:13 }} aria-hidden="true" />
          Corregir mis datos
        </button>
      </Shell>
    );
  }

  // ── Confirmación (datos guardados) ───────────────────────────────────────
  if (paso === "confirmar" && datosGuardados) {
    const aviso = avisoStale(datosGuardados);
    return (
      <Shell>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ width:52, height:52, borderRadius:14, background:"linear-gradient(135deg,#1E3A8A,#2563EB)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
            <i className={tipo === "SALIDA" ? "ti ti-logout" : "ti ti-login"} style={{ fontSize:26, color:"#fff" }} aria-hidden="true" />
          </div>
          <h1 style={{ margin:0, fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color:"#0F172A" }}>{tipo === "SALIDA" ? "Registrar Salida" : "Registrar Entrada"}</h1>
          <p style={{ margin:"5px 0 0", fontSize:"clamp(15px,3.5vw,17px)", color:"#64748B" }}>Confirma que eres tú para continuar</p>
        </div>

        {aviso && (
          <div style={{ width:"100%", background:"#FFFBEB", border:"1.5px solid #FCD34D", borderRadius:10, padding:"10px 14px", marginBottom:14, display:"flex", gap:8, alignItems:"flex-start" }}>
            <i className="ti ti-alert-triangle" style={{ fontSize:18, color:"#D97706", flexShrink:0, marginTop:1 }} aria-hidden="true" />
            <p style={{ margin:0, fontSize:12, color:"#92400E", lineHeight:1.5 }}>{aviso}</p>
          </div>
        )}

        <div style={{ width:"100%", background:"#F8FAFC", border:"1.5px solid #E2E8F0", borderRadius:12, padding:"16px 18px", marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Datos guardados en este dispositivo</div>
          <div style={{ fontSize:"clamp(17px,4vw,21px)", fontWeight:700, color:"#0F172A", marginBottom:4 }}>{datosGuardados.nombre}</div>
          <div style={{ fontSize:13, color:"#64748B", fontFamily:"monospace", fontWeight:600 }}>{datosGuardados.cedula}</div>
        </div>

        <button
          onClick={handleConfirmar}
          disabled={loading}
          style={{ width:"100%", padding:"clamp(16px,4vw,20px) 0", background: loading ? "#93C5FD" : "#2563EB", color:"#fff", border:"none", borderRadius:12, fontSize:"clamp(17px,4.5vw,20px)", fontWeight:800, cursor: loading ? "not-allowed" : "pointer", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
        >
          <i className={tipo === "SALIDA" ? "ti ti-logout" : "ti ti-check"} style={{ fontSize:18 }} aria-hidden="true" />
          {loading ? "Registrando…" : `Confirmar mi ${tipo === "SALIDA" ? "salida" : "entrada"}`}
        </button>

        <button onClick={handleCambiarDatos} style={{ background:"none", border:"none", color:"#64748B", fontSize:13, cursor:"pointer", textDecoration:"underline", marginBottom:6 }}>
          No soy yo — usar otros datos
        </button>

        <button onClick={() => setTipo(null)} style={{ background:"none", border:"none", color:"#94A3B8", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
          <i className="ti ti-arrow-left" style={{ fontSize:12 }} aria-hidden="true" />
          Cambiar tipo de registro
        </button>
      </Shell>
    );
  }

  // ── Formulario (primera vez) ─────────────────────────────────────────────
  return (
    <Shell>
      <div style={{ textAlign:"center", marginBottom:24, width:"100%" }}>
        <div style={{ width:52, height:52, borderRadius:14, background:"linear-gradient(135deg,#1E3A8A,#2563EB)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
          <i className={tipo === "SALIDA" ? "ti ti-logout" : "ti ti-login"} style={{ fontSize:26, color:"#fff" }} aria-hidden="true" />
        </div>
        <h1 style={{ margin:0, fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color:"#0F172A" }}>{tipo === "SALIDA" ? "Registro de Salida" : "Registro de Entrada"}</h1>
        <p style={{ margin:"5px 0 0", fontSize:"clamp(15px,3.5vw,17px)", color:"#64748B" }}>Primera vez — ingresa tus datos</p>
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

      <button onClick={() => setTipo(null)} style={{ marginTop:14, background:"none", border:"none", color:"#94A3B8", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
        <i className="ti ti-arrow-left" style={{ fontSize:12 }} aria-hidden="true" />
        Cambiar tipo de registro
      </button>

      <p style={{ marginTop:10, fontSize:11, color:"#64748B", textAlign:"center", lineHeight:1.5 }}>
        Tus datos se guardan en este dispositivo para agilizar futuros registros.
      </p>
    </Shell>
  );
}
