// scripts/qr-load-test.mjs
//
// Pendiente L: test de carga con 30-50 escaneos QR simultáneos contra
// registrar_asistencia() (la RPC real que usa DocenteScan en producción).
//
// Por qué existe: ARCH-32/ARCH-33 (docs/AUDITORIA_INDICE.md) encontraron y
// corrigieron una condición de carrera real en el rate limiting de esta
// misma RPC — reproducida contra Postgres real con llamadas concurrentes
// del mismo device_fingerprint sin fila previa en scan_rate_limit
// ("duplicate key value violates unique constraint"). Ese hallazgo se
// probó a mano una vez y se corrigió, pero nunca quedó como un test
// repetible — nada impide que una migración futura reintroduzca el mismo
// patrón (SELECT-then-INSERT en vez de UPSERT atómico) sin que CI lo note.
// Este script cierra ese hueco: simula el escenario real de un operativo
// con fila de docentes escaneando casi al mismo tiempo.
//
// DOS OLEADAS:
//   1) "throughput": N docentes DISTINTOS (cédula + device_fingerprint
//      únicos) escaneando la MISMA sesión QR al mismo tiempo. Sin
//      relación entre sí — no debería haber ningún error inesperado, y
//      con ON CONFLICT (cedula_docente, fecha, tipo) DO NOTHING de por
//      medio, tampoco debería haber colisiones de PK. 100% éxito esperado.
//   2) "rate-limit-concurrente": ~15 llamadas concurrentes que COMPARTEN
//      un solo device_fingerprint (cédulas distintas, para que el
//      INSERT en sí no choque) — este es el escenario exacto que rompía
//      antes de 0059: la primera llamada de ese dispositivo no tiene fila
//      todavía en scan_rate_limit, así que N llamadas simultáneas pueden
//      intentar el INSERT inicial al mismo tiempo. Con el UPSERT atómico
//      (ON CONFLICT DO UPDATE) esto debe resolverse sin error de Postgres,
//      dejando pasar hasta MAX_INTENTOS (10) y rechazando el resto con
//      'RATE_LIMIT' — nunca con un error crudo de base de datos.
//
// SEGURIDAD DEL PROPIO TEST (mismo criterio que rls-smoke-test.mjs):
// - Todos los datos usan un marcador canario fácil de identificar
//   (LOAD_TEST_CANARY_PREFIX) para no confundirse con datos reales.
// - La sesión QR, las filas de asistencia y las filas de rate limit que
//   este script crea se BORRAN al final en un `finally`, con la clave de
//   servicio — corre incluso si el test falla a mitad de camino.
// - La clave de servicio (SUPABASE_SERVICE_ROLE_KEY) SOLO se usa para
//   preparar/limpiar el fixture (crear la sesión QR de prueba, y borrar
//   todo al final). Las llamadas a registrar_asistencia() en sí — la
//   parte que realmente se está probando — usan la clave ANÓNIMA, igual
//   que un teléfono real escaneando el QR.
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY. Si falta alguna, el script se salta con
// exit 0 (mismo criterio que rls-smoke-test.mjs) — no bloquea el pipeline
// mientras se configuran los secrets.
//
// Opcional: LOAD_TEST_CONCURRENCY (default 40, dentro del rango 30-50
// pedido) para la oleada de throughput.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONCURRENCY = Number(process.env.LOAD_TEST_CONCURRENCY) || 40;
const RATE_LIMIT_WAVE_SIZE = 15; // > MAX_INTENTOS (10) a propósito, para forzar el rechazo

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
  console.warn(
    "\n⚠️  Load test de QR omitido: faltan SUPABASE_URL / SUPABASE_ANON_KEY / " +
    "SUPABASE_SERVICE_ROLE_KEY como secrets de GitHub Actions.\n" +
    "   Este paso no bloquea el pipeline hasta que se configuren.\n"
  );
  process.exit(0);
}

const LOAD_TEST_CANARY_PREFIX = "__LOAD_TEST_CANARY__";
const SEDE_PRUEBA = "cabimas"; // sede real usada como fixture; nunca se le escribe nada fuera de filas canario

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function fechaHoyVE() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
}

function percentil(msOrdenados, p) {
  if (msOrdenados.length === 0) return 0;
  const idx = Math.min(msOrdenados.length - 1, Math.ceil((p / 100) * msOrdenados.length) - 1);
  return msOrdenados[Math.max(0, idx)];
}

async function llamarRegistrarAsistencia({ token, cedula, nombre, deviceFingerprint }) {
  const inicio = performance.now();
  try {
    const { data, error } = await anon.rpc("registrar_asistencia", {
      p_token: token,
      p_cedula_docente: cedula,
      p_nombre_docente: nombre,
      p_device_fingerprint: deviceFingerprint,
      p_tipo: "ENTRADA",
    });
    const ms = performance.now() - inicio;
    if (error) {
      // Un error a nivel de transporte/Postgres (no un rechazo controlado
      // de la RPC, que siempre devuelve { ok:false, codigo, mensaje } sin
      // "error") es la señal real de una regresión tipo ARCH-33.
      return { ok: false, tipo: "ERROR_POSTGRES", detalle: error.message, ms };
    }
    return { ok: data?.ok === true, codigo: data?.codigo || null, ms };
  } catch (err) {
    const ms = performance.now() - inicio;
    return { ok: false, tipo: "EXCEPCION", detalle: err.message, ms };
  }
}

function resumir(nombreOleada, resultados) {
  const latencias = resultados.map((r) => r.ms).sort((a, b) => a - b);
  const exitosos = resultados.filter((r) => r.ok);
  const rateLimited = resultados.filter((r) => !r.ok && r.codigo === "RATE_LIMIT");
  const erroresInesperados = resultados.filter(
    (r) => !r.ok && r.tipo === "ERROR_POSTGRES" || r.tipo === "EXCEPCION"
  );
  const otrosRechazos = resultados.filter(
    (r) => !r.ok && r.codigo && r.codigo !== "RATE_LIMIT"
  );

  console.log(`\n── Oleada: ${nombreOleada} (${resultados.length} llamadas concurrentes) ──`);
  console.log(`   ✅ Exitosos:            ${exitosos.length}`);
  console.log(`   🚦 Rechazados (RATE_LIMIT, esperado si aplica): ${rateLimited.length}`);
  console.log(`   ⚠️  Rechazados (otro código): ${otrosRechazos.length}${otrosRechazos.length ? " → " + [...new Set(otrosRechazos.map(r => r.codigo))].join(", ") : ""}`);
  console.log(`   🔴 Errores inesperados: ${erroresInesperados.length}`);
  if (erroresInesperados.length > 0) {
    erroresInesperados.slice(0, 5).forEach((e) => console.log(`      - [${e.tipo}] ${e.detalle}`));
  }
  console.log(`   ⏱  Latencia: p50=${percentil(latencias, 50).toFixed(0)}ms  p95=${percentil(latencias, 95).toFixed(0)}ms  max=${latencias[latencias.length - 1]?.toFixed(0) ?? 0}ms`);

  return { exitosos, rateLimited, otrosRechazos, erroresInesperados };
}

async function main() {
  console.log(`\n🚀 Load test de QR contra ${SUPABASE_URL} (${CONCURRENCY} escaneos concurrentes, oleada de throughput)\n`);

  const canaryIds = { cedulas: [], deviceFingerprints: [] };
  let sessionId = null;
  let token = null;
  const fallas = [];

  try {
    // ── Fixture: sesión QR canario (clave de servicio, bypassa RLS) ──────
    token = randomUUID();
    const { data: sesion, error: errSesion } = await admin
      .from("qr_sessions")
      .insert({
        token,
        fecha: fechaHoyVE(),
        turno: "DIURNO",
        programa: null,
        sede_id: SEDE_PRUEBA,
        activa: true,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();

    if (errSesion) {
      console.error(`💥 No se pudo crear la sesión QR de prueba: ${errSesion.message}`);
      process.exit(1);
    }
    sessionId = sesion.id;
    console.log(`✅ Sesión QR canario creada (id=${sessionId}, token=${token})`);

    // ── Oleada 1: throughput — N docentes distintos, mismo token ─────────
    const llamadasThroughput = Array.from({ length: CONCURRENCY }, (_, i) => {
      const cedula = `${LOAD_TEST_CANARY_PREFIX}-THR-${i}`;
      const device = `${LOAD_TEST_CANARY_PREFIX}-DEVICE-THR-${i}`;
      canaryIds.cedulas.push(cedula);
      canaryIds.deviceFingerprints.push(device);
      return llamarRegistrarAsistencia({
        token,
        cedula,
        nombre: `${LOAD_TEST_CANARY_PREFIX} Docente ${i}`,
        deviceFingerprint: device,
      });
    });
    const resultadosThroughput = await Promise.all(llamadasThroughput);
    const rThroughput = resumir("throughput (docentes distintos)", resultadosThroughput);

    if (rThroughput.erroresInesperados.length > 0) {
      fallas.push(`Oleada throughput: ${rThroughput.erroresInesperados.length} error(es) inesperado(s) — posible regresión de condición de carrera (ARCH-33).`);
    }
    if (rThroughput.exitosos.length !== CONCURRENCY) {
      fallas.push(`Oleada throughput: se esperaban ${CONCURRENCY} éxitos (docentes/dispositivos únicos, sin motivo de rechazo), se obtuvieron ${rThroughput.exitosos.length}.`);
    }

    // ── Oleada 2: rate limit bajo concurrencia — mismo device_fingerprint ─
    const deviceCompartido = `${LOAD_TEST_CANARY_PREFIX}-DEVICE-SHARED`;
    canaryIds.deviceFingerprints.push(deviceCompartido);
    const llamadasRateLimit = Array.from({ length: RATE_LIMIT_WAVE_SIZE }, (_, i) => {
      const cedula = `${LOAD_TEST_CANARY_PREFIX}-RL-${i}`;
      canaryIds.cedulas.push(cedula);
      return llamarRegistrarAsistencia({
        token,
        cedula,
        nombre: `${LOAD_TEST_CANARY_PREFIX} Docente RL ${i}`,
        deviceFingerprint: deviceCompartido,
      });
    });
    const resultadosRateLimit = await Promise.all(llamadasRateLimit);
    const rRateLimit = resumir("rate-limit-concurrente (mismo dispositivo)", resultadosRateLimit);

    if (rRateLimit.erroresInesperados.length > 0) {
      fallas.push(
        `Oleada rate-limit-concurrente: ${rRateLimit.erroresInesperados.length} error(es) inesperado(s) — ` +
        `esto es EXACTAMENTE el síntoma de ARCH-33 (condición de carrera en el UPSERT de scan_rate_limit al ` +
        `no existir fila previa para el dispositivo). Revisar la migración vigente de registrar_asistencia().`
      );
    }
    if (rRateLimit.rateLimited.length === 0) {
      fallas.push(
        `Oleada rate-limit-concurrente: ${RATE_LIMIT_WAVE_SIZE} llamadas concurrentes del mismo dispositivo ` +
        `(por encima de MAX_INTENTOS=10) no generaron NINGÚN rechazo RATE_LIMIT — el rate limiting podría no ` +
        `estar aplicándose bajo concurrencia real.`
      );
    }
  } finally {
    // ── Limpieza (siempre corre, con clave de servicio) ──────────────────
    console.log("\n🧹 Limpiando datos canario...");
    if (canaryIds.cedulas.length > 0) {
      const { error: errAsist } = await admin
        .from("asistencias_diarias")
        .delete()
        .in("cedula_docente", canaryIds.cedulas);
      if (errAsist) console.error(`   ⚠️  No se pudieron borrar todas las asistencias canario: ${errAsist.message}`);
    }
    if (canaryIds.deviceFingerprints.length > 0) {
      const { error: errRL } = await admin
        .from("scan_rate_limit")
        .delete()
        .in("device_fingerprint", canaryIds.deviceFingerprints);
      if (errRL) console.error(`   ⚠️  No se pudieron borrar todas las filas de rate limit canario: ${errRL.message}`);
    }
    if (sessionId) {
      const { error: errSes } = await admin.from("qr_sessions").delete().eq("id", sessionId);
      if (errSes) console.error(`   ⚠️  No se pudo borrar la sesión QR canario (id=${sessionId}): ${errSes.message}`);
    }
    console.log("✅ Limpieza completada.\n");
  }

  if (fallas.length > 0) {
    console.error(`💥 ${fallas.length} problema(s) encontrados en el load test:\n`);
    fallas.forEach((f) => console.error(`   - ${f}`));
    process.exit(1);
  }

  console.log("✅ Load test de QR pasó: sin errores inesperados, rate limiting correcto bajo concurrencia.\n");
}

main().catch((err) => {
  console.error("\n💥 El load test de QR terminó con un error inesperado:", err);
  process.exit(1);
});
