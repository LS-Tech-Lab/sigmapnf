/**
 * DocenteScan — Página pública que abre el docente al escanear el QR.
 * No requiere sesión Supabase (acceso anónimo).
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { fechaHoyVE } from "../../../utils/time";
import { encolarAsistencia } from "../../../utils/offlineQueue";

import { LS_KEY, avisoStale, normalizarCedula, cedulaTieneFormatoValido } from "./cedula";
import { calcularDeviceFingerprint } from "./deviceFingerprint";
import { IconError, RESULTADO_UI, IconScan, CODIGOS_REQUIEREN_REESCANEO } from "./icons";
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
  // Autocompletado de nombre a partir de la cédula (solo aplica en el
  // formulario de "primera vez"). nombreAuto guarda el último valor que
  // NOSOTROS pusimos en el campo, para no pisar lo que el docente haya
  // escrito manualmente si luego sigue editando la cédula.
  const [docenteEncontrado, setDocenteEncontrado] = useState(false);
  const [buscandoDocente,   setBuscandoDocente]   = useState(false);
  const [nombreAuto,        setNombreAuto]        = useState("");
  const [datosNuevos, setDatosNuevos] = useState(null);
  const [paso,      setPaso]      = useState("cargando");
  const [resultado, setResultado] = useState(null);
  const [loading,   setLoading]   = useState(false);

  useEffect(() => {
    // Fix #11: antes de mostrar datos guardados, verificar que el token QR
    // del URL corresponde al día actual consultando la BD. Si el token es de
    // un día anterior (sesión QR vencida) o no existe, ir directo al formulario
    // para evitar que el próximo docente en el dispositivo vea datos del anterior.
    // P-3: timeout de 3 s — sin red, el spinner no queda infinito.
    const cargarConValidacion = async () => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) { setPaso("formulario"); return; }

        const datos = JSON.parse(raw);
        if (!datos?.cedula || !datos?.nombre) { setPaso("formulario"); return; }

        // Sin red: saltar la validación y mostrar datos guardados directamente
        if (!navigator.onLine) {
          setDatosGuardados(datos);
          setCedula(datos.cedula);
          setNombre(datos.nombre);
          setPaso("confirmar");
          return;
        }

        // Verificar que el token QR sigue activo hoy (con timeout de 3 s)
        const consulta = supabase
          .from("qr_sessions")
          .select("id, fecha")
          .eq("token", token)
          .eq("activo", true)
          .eq("fecha", fechaHoyVE())
          .maybeSingle();

        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), 3000)
        );

        const { data: sesionActiva, error } = await Promise.race([consulta, timeout]);

        if (error || !sesionActiva) {
          // Token vencido o de otro día — no pre-cargar datos
          setPaso("formulario");
          return;
        }

        // Token válido y del día de hoy — mostrar datos guardados
        setDatosGuardados(datos);
        setCedula(datos.cedula);
        setNombre(datos.nombre);
        setPaso("confirmar");
      } catch {
        // Timeout o error de red — si hay datos guardados, usarlos directamente
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          try {
            const datos = JSON.parse(raw);
            if (datos?.cedula && datos?.nombre) {
              setDatosGuardados(datos);
              setCedula(datos.cedula);
              setNombre(datos.nombre);
              setPaso("confirmar");
              return;
            }
          } catch {}
        }
        setPaso("formulario");
      }
    };

    if (token) {
      cargarConValidacion();
    } else {
      setPaso("formulario");
    }
  }, [token]);

  // Autocompletar nombre al escribir la cédula (solo en el formulario de
  // primera vez). Busca en `docentes` con un pequeño debounce para no
  // disparar una consulta por cada tecla. Si la cédula ya está registrada
  // en el sistema, rellena el campo Nombre con el nombre_raw vinculado —
  // así el docente no tiene que volver a escribirlo y evitamos typos que
  // creen una identidad "fantasma" duplicada (ver cedula.js).
  useEffect(() => {
    if (paso !== "formulario") return;

    const cedulaNorm = normalizarCedula(cedula.trim());
    if (!cedulaTieneFormatoValido(cedulaNorm)) {
      setDocenteEncontrado(false);
      setBuscandoDocente(false);
      return;
    }

    let cancelado = false;
    setBuscandoDocente(true);

    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from("docentes")
          .select("nombre_raw")
          .eq("cedula", cedulaNorm)
          .maybeSingle();

        if (cancelado) return;

        if (data?.nombre_raw) {
          setDocenteEncontrado(true);
          // Solo autocompletar si el campo está vacío o si lo que hay
          // escrito es justo lo que nosotros mismos pusimos antes —
          // así nunca se pisa un nombre que el docente escribió a mano.
          setNombre(actual => {
            if (!actual.trim() || actual === nombreAuto) {
              setNombreAuto(data.nombre_raw);
              return data.nombre_raw;
            }
            return actual;
          });
        } else {
          setDocenteEncontrado(false);
        }
      } catch {
        // Sin red o error de consulta: el docente sigue pudiendo
        // escribir su nombre manualmente, sin bloquear el formulario.
      } finally {
        if (!cancelado) setBuscandoDocente(false);
      }
    }, 450);

    return () => { cancelado = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cedula, paso]);

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

      const payload = {
        p_token:              token,
        p_cedula_docente:     cedulaNorm,
        p_nombre_docente:     nombreFinal.trim() || cedulaNorm,
        p_device_fingerprint: fingerprint,
        p_tipo:               tipoFinal,
      };

      // P-2: sin red, encolar en IndexedDB y mostrar confirmación optimista
      if (!navigator.onLine) {
        await encolarAsistencia(payload);
        guardarDatos(cedulaNorm, nombreFinal.trim() || cedulaNorm);
        setDatosGuardados({
          cedula: cedulaNorm, nombre: nombreFinal.trim() || cedulaNorm,
          fecha: fechaHoyVE(), guardadoEn: Date.now(),
        });
        setResultado({
          ok: true,
          codigo: 'OFFLINE',
          mensaje: 'Registro guardado en este dispositivo. Se sincronizará automáticamente al recuperar conexión.',
        });
        setPaso("resultado");
        setLoading(false);
        return;
      }

      const { data, error: rpcErr } = await supabase.rpc("registrar_asistencia", payload);

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
      setErrorCedula("Eso no parece una cédula válida. Ingresa solo los números (ej: 5174134), entre 6 y 9 dígitos.");
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
    // Caso especial: el token QR de esta página ya rotó o venció (sucede
    // siempre que el docente vuelve a abrir la pantalla guardada —por
    // ejemplo desde el historial del navegador— para marcar su salida
    // después de haber marcado la entrada con otro código). No es un error
    // del docente ni de su identidad, así que en vez del mensaje genérico
    // "Código QR no válido" le mostramos su identidad ya confirmada y una
    // instrucción clara para volver a escanear el código vigente del aula.
    const requiereReescaneo =
      !resultado.ok &&
      CODIGOS_REQUIEREN_REESCANEO.includes(resultado.codigo) &&
      !!datosGuardados;

    if (requiereReescaneo) {
      return (
        <Shell ancho={420}>
          <IconScan />
          <h2 style={{ margin:"16px 0 6px", fontSize:"clamp(20px,5vw,26px)", fontWeight:800, color:"#1D4ED8", textAlign:"center" }}>
            Escanea el código QR para registrar tu {tipo === "SALIDA" ? "salida" : "entrada"}
          </h2>
          <p style={{ margin:0, fontSize:"clamp(15px,3.5vw,18px)", color:"#334155", textAlign:"center", lineHeight:1.55 }}>
            Por seguridad, el código QR cambia constantemente. Abre la cámara de tu teléfono y apunta al código QR que está ahora en la pantalla del aula para completar tu registro.
          </p>

          <div style={{ marginTop:20, background:"#F8FAFC", border:"1.5px solid #E2E8F0", borderRadius:12, padding:"16px 18px", width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>
              Tus datos ya están confirmados — no necesitas escribirlos de nuevo
            </div>
            <div style={{ fontSize:"clamp(16px,4vw,19px)", fontWeight:700, color:"#0F172A" }}>{datosGuardados.nombre}</div>
            <div style={{ fontSize:13, color:"#64748B", fontFamily:"monospace", marginTop:2 }}>{datosGuardados.cedula}</div>
          </div>

          <button
            onClick={handleVolverASelectorTipo}
            style={{ marginTop:18, background:"none", border:"none", color:"#2563EB", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}
          >
            <i className="ti ti-arrow-left" style={{ fontSize:13 }} aria-hidden="true" />
            Cambiar tipo de registro
          </button>
        </Shell>
      );
    }

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
          hint={buscandoDocente ? "Buscando en el sistema…" : "Solo números después del guion. Ej: V-12345678 o E-87654321"}
        />
        <Campo
          label="Nombre completo"
          value={nombre}
          onChange={e => { setNombre(e.target.value); setNombreAuto(""); }}
          required
          placeholder="Prof. Juan García"
          autoComplete="name"
          success={docenteEncontrado}
          hint={docenteEncontrado ? "Encontrado en el sistema — puedes corregirlo si no es correcto" : "Será recordado para la próxima vez"}
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
