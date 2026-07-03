// scripts/rls-smoke-test.mjs
//
// Smoke test de seguridad: verifica, con la clave ANÓNIMA real (la misma
// que usa el frontend en producción), que las tablas sensibles se
// comportan como deben — ni más abiertas ni más cerradas de lo esperado.
//
// Nace del hallazgo S1 de la auditoría de julio 2026 (docentes/materias)
// y del historial de este proyecto: dos veces ya (horarios en 0035/0045,
// docentes/materias en 0046) una política de RLS quedó más permisiva de
// lo que la UI asumía, sin que nada lo detectara hasta una auditoría
// manual. Este script es el guardián automático para que no pase una
// tercera vez sin que el CI se ponga en rojo.
//
// DISEÑO DE SEGURIDAD DEL PROPIO TEST (importante):
// - Los intentos de escritura usan un valor "canario" fácilmente
//   identificable (SMOKE_TEST_MARKER). Si por algún motivo el INSERT
//   llegara a tener éxito (es decir, si RLS estuviera roto), el script
//   BORRA esa fila inmediatamente en el mismo paso, y además hace fallar
//   el job con un mensaje explícito — nunca lo deja pasar en silencio.
// - No se hacen pruebas de UPDATE/DELETE contra filas reales (ids
//   existentes), para no arriesgarse a modificar o borrar datos de
//   producción si una política estuviera mal configurada. El INSERT+DELETE
//   del canario ya ejercita el mismo mecanismo de permisos
//   (tiene_permiso) que protege UPDATE/DELETE en las mismas tablas.
// - Para las tablas de solo-lectura-restringida (logs, sesiones, perfiles)
//   solo se prueba SELECT: si devuelve alguna fila, es una falla dura
//   (evidencia inequívoca de fuga). Si devuelve 0 filas, se toma como
//   "OK" — no se puede distinguir "RLS bloqueando" de "tabla vacía" sin
//   una clave de servicio adicional, así que este caso no es motivo de
//   alarma para no generar falsos positivos.
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_ANON_KEY.
// Si no están definidas, el script se salta con un aviso (exit 0) en vez
// de romper el pipeline — así no bloquea a nadie mientras se configuran
// los secrets de GitHub Actions.

import { createClient } from "@supabase/supabase-js";

const SMOKE_TEST_MARKER = "__SMOKE_TEST_CANARY__";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "\n⚠️  Smoke test de RLS omitido: faltan SUPABASE_URL / SUPABASE_ANON_KEY " +
    "como secrets de GitHub Actions.\n" +
    "   Este paso no bloquea el pipeline hasta que se configuren.\n"
  );
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
  console.error(`❌ ${msg}`);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

function warn(msg) {
  warnings.push(msg);
  console.warn(`⚠️  ${msg}`);
}

// ── 1) Lectura pública que SÍ debe funcionar ────────────────────────────
// docentes/materias: necesario para el autocompletado sin sesión en
// DocenteScan. horarios: lectura pública intencional (0035/0045).
async function checkSelectPermitido(table, columns = "id") {
  const { error } = await supabase.from(table).select(columns).limit(1);
  if (error) {
    fail(`SELECT en "${table}" debería funcionar para anon, pero falló: ${error.message}`);
  } else {
    ok(`SELECT en "${table}" funciona para anon (esperado).`);
  }
}

// ── 2) Lectura que NO debe exponer datos a anon ─────────────────────────
// Nunca se espera error (RLS filtra filas, no lanza excepción), así que
// la señal real es: ¿volvieron filas? Si sí, es una fuga confirmada.
async function checkSelectRestringido(table, columns = "id") {
  const { data, error } = await supabase.from(table).select(columns).limit(1);
  if (error) {
    ok(`SELECT en "${table}" rechazado para anon (esperado): ${error.message}`);
    return;
  }
  if (data && data.length > 0) {
    fail(`SELECT en "${table}" devolvió ${data.length} fila(s) a anon — no debería ser legible sin sesión.`);
  } else {
    warn(`SELECT en "${table}" devolvió 0 filas para anon. Probablemente correcto, pero no se puede ` +
         `distinguir con certeza de "tabla vacía" sin una clave de servicio. Revisar si se quiere blindar mejor.`);
  }
}

// ── 3) Escritura que NO debe funcionar (con auto-limpieza si falla) ────
async function checkInsertRechazado(table, payload) {
  const { data, error } = await supabase.from(table).insert(payload).select("id");

  if (error) {
    ok(`INSERT en "${table}" rechazado para anon (esperado): ${error.message}`);
    return;
  }

  // Si llegamos aquí, el INSERT tuvo éxito: RLS está roto. Limpiar y
  // reportar como falla crítica, no dejarlo pasar en silencio.
  const insertedIds = (data || []).map((row) => row.id);
  fail(
    `🔴 CRÍTICO: INSERT en "${table}" tuvo éxito con la clave anon (id(s): ${insertedIds.join(", ") || "?"}). ` +
    `RLS no está bloqueando escrituras no autorizadas.`
  );

  if (insertedIds.length > 0) {
    const { error: cleanupError } = await supabase.from(table).delete().in("id", insertedIds);
    if (cleanupError) {
      fail(`Además, no se pudo limpiar la fila canario insertada en "${table}": ${cleanupError.message}. Borrar manualmente id(s) ${insertedIds.join(", ")}.`);
    } else {
      console.error(`   → Fila canario en "${table}" (id ${insertedIds.join(", ")}) borrada automáticamente.`);
    }
  }
}

async function main() {
  console.log(`\n🔒 Smoke test de RLS contra ${SUPABASE_URL} (clave anon)\n`);

  // Lecturas que deben funcionar (comportamiento público intencional)
  await checkSelectPermitido("docentes", "id");
  await checkSelectPermitido("materias", "id");
  await checkSelectPermitido("horarios", "id");

  // Escrituras que deben rechazarse — foco de S1 (docentes/materias)
  await checkInsertRechazado("docentes", {
    nombre_raw: SMOKE_TEST_MARKER,
    nombre_display: SMOKE_TEST_MARKER,
  });
  await checkInsertRechazado("materias", {
    nombre_raw: SMOKE_TEST_MARKER,
    nombre_display: SMOKE_TEST_MARKER,
  });

  // Lecturas que NO deben exponer datos a anon
  await checkSelectRestringido("user_profiles", "id");
  await checkSelectRestringido("qr_sessions", "id");
  await checkSelectRestringido("asistencias_diarias", "id");
  await checkSelectRestringido("audit_logs", "id");
  await checkSelectRestringido("session_logs", "id");
  await checkSelectRestringido("login_attempts", "id");
  await checkSelectRestringido("scan_rate_limit", "id");

  console.log("");
  if (warnings.length > 0) {
    console.log(`${warnings.length} advertencia(s) informativa(s), no bloquean el pipeline.\n`);
  }

  if (failures.length > 0) {
    console.error(`💥 ${failures.length} verificación(es) de RLS fallaron:\n`);
    failures.forEach((f) => console.error(`   - ${f}`));
    process.exit(1);
  }

  console.log("✅ Todas las verificaciones de RLS pasaron.\n");
}

main().catch((err) => {
  console.error("\n💥 El smoke test de RLS terminó con un error inesperado:", err);
  process.exit(1);
});
