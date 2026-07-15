/**
 * DocenteScan — Página pública que abre el docente al escanear el QR.
 * No requiere sesión Supabase (acceso anónimo).
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { fechaHoyVE } from "../../../utils/time";
import { encolarAsistencia } from "../../../utils/offlineQueue";

import { LS_KEY, normalizarCedula, cedulaTieneFormatoValido } from "./cedula";
import { calcularDeviceFingerprint } from "./deviceFingerprint";
import { IconError } from "./icons";
import Shell from "./Shell";
import SelectorTipo from "./SelectorTipo";
import PasoValidacionCedula from "./PasoValidacionCedula";
import PasoRegistro from "./PasoRegistro";
import "./DocenteScan.css";

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
    // OFF-8: timeout de 3 s — sin red, el spinner no queda infinito.
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
  // primera vez). Busca primero en `docentes` (nombre canónico del catálogo
  // de horarios) y si no está vinculado, busca en `asistencias_diarias` el
  // nombre que el mismo docente escribió la última vez que escaneó.
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
        // Fuente 1: tabla docentes (catálogo de horarios, nombre canónico)
        const { data: docente } = await supabase
          .from("docentes")
          .select("nombre_raw")
          .eq("cedula", cedulaNorm)
          .maybeSingle();

        if (cancelado) return;

        if (docente?.nombre_raw) {
          setDocenteEncontrado(true);
          setNombre(actual => {
            if (!actual.trim() || actual === nombreAuto) {
              setNombreAuto(docente.nombre_raw);
              return docente.nombre_raw;
            }
            return actual;
          });
        } else {
          // Fuente 2: asistencias_diarias — el docente pudo haber marcado
          // antes aunque su cédula no esté vinculada en el catálogo de horarios.
          // Se toma el registro más reciente para obtener el nombre que él mismo
          // escribió la última vez.
          const { data: registros } = await supabase
            .from("asistencias_diarias")
            .select("nombre_docente")
            .eq("cedula_docente", cedulaNorm)
            .not("nombre_docente", "is", null)
            .order("fecha", { ascending: false })
            .order("hora_registro", { ascending: false })
            .limit(1);

          if (cancelado) return;

          const nombrePrevio = registros?.[0]?.nombre_docente;
          if (nombrePrevio) {
            setDocenteEncontrado(true);
            setNombre(actual => {
              if (!actual.trim() || actual === nombreAuto) {
                setNombreAuto(nombrePrevio);
                return nombrePrevio;
              }
              return actual;
            });
          } else {
            setDocenteEncontrado(false);
          }
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

      // OFF-7: sin red, encolar en IndexedDB y mostrar confirmación optimista
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
        <h2 className="scan-invalid-title scan-color-danger">Enlace inválido</h2>
        <p className="scan-error-desc">
          Escanea el código QR desde la pantalla del aula para registrar tu asistencia.
        </p>
      </Shell>
    );
  }

  // ── Cargando ─────────────────────────────────────────────────────────────
  if (paso === "cargando") {
    return (
      <Shell>
        <i className="ti ti-loader-2 scan-spinner-icon" aria-hidden="true" />
        <p className="scan-loading-text">Cargando…</p>
      </Shell>
    );
  }

  // ── Elegir tipo (Entrada/Salida) ─────────────────────────────────────────
  if (!tipo) return <SelectorTipo onElegir={setTipo} />;

  // ── Confirmación (datos guardados) o Resultado ───────────────────────────
  if ((paso === "confirmar" && datosGuardados) || (paso === "resultado" && resultado)) {
    return (
      <PasoRegistro
        paso={paso}
        tipo={tipo}
        cedula={cedula}
        nombre={nombre}
        datosGuardados={datosGuardados}
        resultado={resultado}
        loading={loading}
        onConfirmar={handleConfirmar}
        onCambiarDatos={handleCambiarDatos}
        onVolverTipo={() => setTipo(null)}
        onVolverASelectorTipo={handleVolverASelectorTipo}
      />
    );
  }

  // ── Formulario (primera vez) o confirmación visual de datos nuevos ───────
  return (
    <PasoValidacionCedula
      paso={paso}
      tipo={tipo}
      cedula={cedula}
      nombre={nombre}
      errorCedula={errorCedula}
      docenteEncontrado={docenteEncontrado}
      buscandoDocente={buscandoDocente}
      datosNuevos={datosNuevos}
      loading={loading}
      onCedulaChange={e => { setCedula(e.target.value); if (errorCedula) setErrorCedula(""); }}
      onNombreChange={e => { setNombre(e.target.value); setNombreAuto(""); }}
      onSubmit={handleFormulario}
      onConfirmarNuevo={handleConfirmarNuevo}
      onCorregirNuevo={handleCorregirNuevo}
      onVolverTipo={() => setTipo(null)}
    />
  );
}
