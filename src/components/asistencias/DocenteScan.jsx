
/**
 * DocenteScan.jsx
 *
 * Página pública que abre el docente al escanear el QR.
 * No requiere sesión Supabase (acceso anónimo).
 *
 * Flujo:
 *  - Primera vez: pide cédula + nombre completo, guarda en localStorage
 *  - Siguientes veces: muestra datos guardados y pide solo confirmar
 *  - Llama a registrar_asistencia() RPC
 *  - Muestra resultado con UI clara según código de respuesta
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";

const LS_KEY = "pnf_docente_datos";

// ── Device fingerprint ───────────────────────────────────────────────────────
async function calcularDeviceFingerprint() {
  const raw = [
    navigator.userAgent, navigator.language,
    screen.width, screen.height, screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || "",
  ].join("|");

  if (window.crypto?.subtle) {
    try {
      const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch {}
  }
  let h = 5381;
  for (let i = 0; i < raw.length; i++) { h = (h << 5) + h + raw.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16);
}

// ── Normalizar cédula ────────────────────────────────────────────────────────
function normalizarCedula(raw) {
  const limpio = raw.replace(/\s/g, "").toUpperCase();
  if (/^[VEve]-?\d+$/.test(limpio)) {
    return `${limpio[0]}-${limpio.replace(/[^0-9]/g, "")}`;
  }
  if (/^\d+$/.test(limpio)) return `V-${limpio}`;
  return limpio;
}

// ── Iconos ───────────────────────────────────────────────────────────────────
const IconCheck = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="12" fill="#22C55E"/>
    <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconError = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="12" fill="#EF4444"/>
    <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
  </svg>
);
const IconWarn = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="12" fill="#F59E0B"/>
    <path d="M12 7v6M12 16v1" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
  </svg>
);

const RESULTADO_UI = {
  ok:               { Icon: IconCheck, titulo: "¡Asistencia registrada!", color: "#15803D" },
  YA_REGISTRADO:    { Icon: IconWarn,  titulo: "Ya registraste tu asistencia hoy", color: "#92400E",
                      hint: "Tu presencia ya estaba registrada. No es necesario hacer nada más." },
  TOKEN_EXPIRADO:   { Icon: IconError, titulo: "Código QR expirado", color: "#991B1B",
                      hint: "Pide al administrador que regenere el código." },
  TOKEN_INVALIDO:   { Icon: IconError, titulo: "Código QR no válido", color: "#991B1B",
                      hint: "Asegúrate de escanear el código desde la pantalla del aula." },
  SESION_INACTIVA:  { Icon: IconError, titulo: "Sesión cerrada", color: "#1E40AF",
                      hint: "El administrador cerró esta sesión. Consulta si hay una nueva." },
  DEVICE_DUPLICADO: { Icon: IconError, titulo: "Dispositivo ya utilizado", color: "#991B1B",
                      hint: "Este celular ya registró la asistencia de otro docente en esta sesión." },
  ERROR:            { Icon: IconError, titulo: "Error de conexión", color: "#991B1B",
                      hint: "Intenta de nuevo o contacta al administrador." },
};

// ── Shell centrado ───────────────────────────────────────────────────────────
function Shell({ children }) {
  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0F172A 0%,#1E3A5F 100%)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:"system-ui,-apple-system,sans-serif" }}>
      <div style={{ background:"#fff", borderRadius:20, padding:"36px 28px", width:"100%", maxWidth:380, boxShadow:"0 20px 60px rgba(0,0,0,0.35)", display:"flex", flexDirection:"column", alignItems:"center" }}>
        {children}
      </div>
    </div>
  );
}

// ── Input con estilo ─────────────────────────────────────────────────────────
function Campo({ label, hint, ...props }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display:"block", fontSize:13, fontWeight:600, color:"#374151", marginBottom:6 }}>{label}</label>
      <input
        {...props}
        style={{ width:"100%", padding:"11px 14px", borderRadius:9, border:"1.5px solid #D1D5DB", fontSize:15, color:"#111827", outline:"none", boxSizing:"border-box", fontWeight:600 }}
        onFocus={e => { e.target.style.borderColor="#2563EB"; e.target.style.boxShadow="0 0 0 3px rgba(37,99,235,0.12)"; }}
        onBlur={e  => { e.target.style.borderColor="#D1D5DB"; e.target.style.boxShadow="none"; }}
      />
      {hint && <p style={{ margin:"4px 0 0", fontSize:11, color:"#9CA3AF" }}>{hint}</p>}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function DocenteScan() {
  const token = new URLSearchParams(window.location.search).get("token");

  // Datos guardados del docente
  const [datosGuardados, setDatosGuardados] = useState(null);
  // Formulario (primera vez)
  const [cedula,  setCedula]  = useState("");
  const [nombre,  setNombre]  = useState("");
  // Estado de UI
  const [paso,      setPaso]      = useState("cargando"); // cargando | formulario | confirmar | resultado
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
    try { localStorage.setItem(LS_KEY, JSON.stringify({ cedula: c, nombre: n })); } catch {}
  };

  const registrar = useCallback(async (cedulaFinal, nombreFinal) => {
    setLoading(true);
    try {
      const fingerprint = await calcularDeviceFingerprint();
      const cedulaNorm  = normalizarCedula(cedulaFinal.trim());

      const { data, error: rpcErr } = await supabase.rpc("registrar_asistencia", {
        p_token:              token,
        p_cedula_docente:     cedulaNorm,
        p_nombre_docente:     nombreFinal.trim() || cedulaNorm,
        p_device_fingerprint: fingerprint,
      });

      if (rpcErr) throw rpcErr;
      if (data?.ok) guardarDatos(cedulaNorm, nombreFinal.trim() || cedulaNorm);
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
    if (!cedula.trim() || !nombre.trim()) return;
    registrar(cedula, nombre);
  };

  const handleConfirmar = () => {
    registrar(datosGuardados.cedula, datosGuardados.nombre);
  };

  const handleCambiarDatos = () => {
    setPaso("formulario");
    setCedula("");
    setNombre("");
  };

  // ── Sin token ────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <Shell>
        <IconError />
        <h2 style={{ margin:"16px 0 8px", fontSize:18, color:"#991B1B", textAlign:"center" }}>Enlace inválido</h2>
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

  // ── Resultado ────────────────────────────────────────────────────────────
  if (paso === "resultado" && resultado) {
    const tipo = resultado.ok ? "ok" : (resultado.codigo || "ERROR");
    const ui   = RESULTADO_UI[tipo] || RESULTADO_UI.ERROR;
    const { Icon, titulo, color, hint } = ui;
    return (
      <Shell>
        <Icon />
        <h2 style={{ margin:"16px 0 6px", fontSize:19, fontWeight:700, color, textAlign:"center" }}>{titulo}</h2>
        <p style={{ margin:0, fontSize:14, color:"#374151", textAlign:"center", lineHeight:1.55 }}>{resultado.mensaje}</p>
        {hint && <p style={{ margin:"10px 0 0", fontSize:13, color:"#6B7280", textAlign:"center" }}>{hint}</p>}
        {/* Si fue exitoso, mostrar datos registrados */}
        {resultado.ok && (
          <div style={{ marginTop:20, background:"#F0FDF4", border:"1px solid #86EFAC", borderRadius:12, padding:"14px 18px", width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:12, color:"#166534", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Datos registrados</div>
            <div style={{ fontSize:15, fontWeight:700, color:"#15803D" }}>{nombre || datosGuardados?.nombre}</div>
            <div style={{ fontSize:13, color:"#166534", fontFamily:"monospace", marginTop:2 }}>{normalizarCedula(cedula || datosGuardados?.cedula || "")}</div>
          </div>
        )}
      </Shell>
    );
  }

  // ── Confirmar (datos recordados) ─────────────────────────────────────────
  if (paso === "confirmar" && datosGuardados) {
    return (
      <Shell>
        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ width:52, height:52, borderRadius:14, background:"linear-gradient(135deg,#1E3A8A,#2563EB)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, margin:"0 auto 12px" }}>✅</div>
          <h1 style={{ margin:0, fontSize:19, fontWeight:700, color:"#111827" }}>Registrar Asistencia</h1>
          <p style={{ margin:"5px 0 0", fontSize:13, color:"#6B7280" }}>Confirma que eres tú para continuar</p>
        </div>

        {/* Tarjeta de datos */}
        <div style={{ width:"100%", background:"#F8FAFC", border:"1.5px solid #E2E8F0", borderRadius:12, padding:"16px 18px", marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Tus datos registrados</div>
          <div style={{ fontSize:16, fontWeight:700, color:"#111827", marginBottom:3 }}>{datosGuardados.nombre}</div>
          <div style={{ fontSize:13, color:"#6B7280", fontFamily:"monospace", fontWeight:600 }}>{datosGuardados.cedula}</div>
        </div>

        {/* Botón confirmar */}
        <button
          onClick={handleConfirmar}
          disabled={loading}
          style={{ width:"100%", padding:"13px 0", background: loading ? "#93C5FD" : "#2563EB", color:"#fff", border:"none", borderRadius:10, fontSize:15, fontWeight:700, cursor: loading ? "not-allowed" : "pointer", marginBottom:10 }}
        >
          {loading ? "Registrando…" : "✅ Confirmar mi asistencia"}
        </button>

        {/* Enlace para cambiar datos */}
        <button
          onClick={handleCambiarDatos}
          style={{ background:"none", border:"none", color:"#6B7280", fontSize:13, cursor:"pointer", textDecoration:"underline" }}
        >
          No soy yo — usar otros datos
        </button>
      </Shell>
    );
  }

  // ── Formulario (primera vez) ─────────────────────────────────────────────
  return (
    <Shell>
      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:24, width:"100%" }}>
        <div style={{ width:52, height:52, borderRadius:14, background:"linear-gradient(135deg,#1E3A8A,#2563EB)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, margin:"0 auto 12px" }}>✅</div>
        <h1 style={{ margin:0, fontSize:19, fontWeight:700, color:"#111827" }}>Registro de Asistencia</h1>
        <p style={{ margin:"5px 0 0", fontSize:13, color:"#6B7280" }}>Primera vez — ingresa tus datos</p>
      </div>

      <form onSubmit={handleFormulario} style={{ width:"100%" }}>
        <Campo
          label="Cédula de identidad"
          value={cedula}
          onChange={e => setCedula(e.target.value)}
          required
          placeholder="V-12345678"
          inputMode="text"
          autoComplete="off"
          autoFocus
          hint="Ej: V-12345678 o E-87654321"
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
          style={{ width:"100%", padding:"13px 0", background: loading || !cedula.trim() || !nombre.trim() ? "#93C5FD" : "#2563EB", color:"#fff", border:"none", borderRadius:10, fontSize:15, fontWeight:700, cursor: loading || !cedula.trim() || !nombre.trim() ? "not-allowed" : "pointer" }}
        >
          {loading ? "Registrando…" : "Registrar mi asistencia"}
        </button>
      </form>

      <p style={{ marginTop:14, fontSize:11, color:"#9CA3AF", textAlign:"center", lineHeight:1.5 }}>
        Tus datos se guardan en este dispositivo para agilizar futuros registros.
      </p>
    </Shell>
  );
}
