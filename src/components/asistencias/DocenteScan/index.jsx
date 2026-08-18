/**
 * DocenteScan — Página pública que abre el docente al escanear el QR.
 * No requiere sesión Supabase (acceso anónimo).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { fechaHoyVE } from "../../../utils/time";
import { encolarAsistencia } from "../../../utils/offlineQueue";

import {
  LS_KEY, normalizarCedula, cedulaTieneFormatoValido,
  leerBorrador, guardarBorrador, borrarBorrador,
} from "./cedula";
import { calcularDeviceFingerprint } from "./deviceFingerprint";
import { IconError } from "./icons";
// Fix UX-59 (auditoría 16 ago, cierre del alcance dejado pendiente por
// UX-55): catch de abajo relanza el error original de registrar_asistencia()
// (`throw rpcErr`, conserva `.code`) sin traducir — este RPC además usa
// RAISE EXCEPTION para sus propios guards (ej. entrada duplicada), que la
// regla P0001 de mensajeAmigable() ya sabe respetar sin aplanarlos.
import { mensajeAmigable } from "../../../utils/errorMessages";
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
  // UX-33: borrador recuperado del formulario de "primera vez" (ver cedula.js)
  const [borradorRecuperado, setBorradorRecuperado] = useState(null);
  const guardarBorradorTimerRef = useRef(null);

  // Solo se usa dentro de cargarConValidacion, cuando se decide mandar al
  // docente al formulario en blanco: si hay un borrador reciente sin
  // expirar, lo precarga y muestra el aviso. No se usa en handleCambiarDatos
  // ("No soy yo"), que es un reinicio deliberado del docente.
  const irAFormulario = () => {
    const borrador = leerBorrador();
    if (borrador) {
      setCedula(borrador.cedula || "");
      setNombre(borrador.nombre || "");
      setBorradorRecuperado(borrador);
    }
    setPaso("formulario");
  };

  useEffect(() => {
    // Fix #11: antes de mostrar datos guardados, verificar que el token QR
    // del URL corresponde al día actual consultando la BD. Si el token es de
    // un día anterior (sesión QR vencida) o no existe, ir directo al formulario
    // para evitar que el próximo docente en el dispositivo vea datos del anterior.
    // OFF-8: timeout de 3 s — sin red, el spinner no queda infinito.
    const cargarConValidacion = async () => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) { irAFormulario(); return; }

        const datos = JSON.parse(raw);
        if (!datos?.cedula || !datos?.nombre) { irAFormulario(); return; }

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
          irAFormulario();
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
        irAFormulario();
      }
    };

    if (token) {
      cargarConValidacion();
    } else {
      setPaso("formulario");
    }
  }, [token]);

  // Autocompletar nombre al escribir la cédula (solo en el formulario de
  // primera vez). SEDE-3/4: antes hacía dos SELECT directos y anónimos
  // contra `docentes` y `asistencias_diarias`; esas tablas ya no tienen
  // lectura pública (0063), así que ahora pasa por la RPC
  // `buscar_docente_scan`, que resuelve la sede desde `token` (nunca
  // desde algo que el cliente anónimo pueda elegir) y hace el mismo
  // fallback en dos fuentes del lado del servidor.
  useEffect(() => {
    if (paso !== "formulario") return;

    const cedulaNorm = normalizarCedula(cedula.trim());
    if (!cedulaTieneFormatoValido(cedulaNorm)) {
      setDocenteEncontrado(false);
      setBuscandoDocente(false);
      return;
    }

    // Sin token no hay forma de saber a qué sede pertenece esta cédula
    // (el catálogo de docentes es independiente por sede) — se deja sin
    // autocompletar y el docente escribe su nombre a mano, igual que
    // cuando no se encuentra ninguna coincidencia.
    if (!token) {
      setDocenteEncontrado(false);
      setBuscandoDocente(false);
      return;
    }

    let cancelado = false;
    setBuscandoDocente(true);

    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc("buscar_docente_scan", {
          p_token:  token,
          p_cedula: cedulaNorm,
        });

        if (cancelado) return;

        if (data?.encontrado && data?.nombre) {
          setDocenteEncontrado(true);
          setNombre(actual => {
            if (!actual.trim() || actual === nombreAuto) {
              setNombreAuto(data.nombre);
              return data.nombre;
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

  // UX-33: mientras el docente llena el formulario de primera vez, guarda
  // un borrador con debounce (independiente de guardarDatos, que solo se
  // ejecuta tras un registro exitoso). Así, si el token QR rota antes de
  // que termine de escribir, no pierde lo tecleado al volver a escanear.
  useEffect(() => {
    if (paso !== "formulario") return;
    if (guardarBorradorTimerRef.current) clearTimeout(guardarBorradorTimerRef.current);
    guardarBorradorTimerRef.current = setTimeout(() => {
      guardarBorrador(cedula, nombre);
    }, 500);
    return () => clearTimeout(guardarBorradorTimerRef.current);
  }, [cedula, nombre, paso]);

  const handleDescartarBorrador = () => {
    borrarBorrador();
    setBorradorRecuperado(null);
    setCedula("");
    setNombre("");
  };

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
        borrarBorrador();
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
        borrarBorrador();
        setDatosGuardados({
          cedula: cedulaNorm, nombre: nombreFinal.trim() || cedulaNorm,
          fecha: fechaHoyVE(), guardadoEn: Date.now(),
        });
      }
      setResultado(data);
      setPaso("resultado");
    } catch (err) {
      setResultado({ ok: false, codigo: "ERROR", mensaje: err.message ? mensajeAmigable(err) : "Error de conexión." });
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
      borradorRecuperado={borradorRecuperado}
      onDescartarBorrador={handleDescartarBorrador}
      onCedulaChange={e => { setCedula(e.target.value); if (errorCedula) setErrorCedula(""); }}
      onNombreChange={e => { setNombre(e.target.value); setNombreAuto(""); }}
      onSubmit={handleFormulario}
      onConfirmarNuevo={handleConfirmarNuevo}
      onCorregirNuevo={handleCorregirNuevo}
      onVolverTipo={() => setTipo(null)}
    />
  );
}
