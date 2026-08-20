// scripts/health-check.mjs
//
// Fix ARCH-48 (auditoría E2E, 19 de agosto): la única verificación activa
// de disponibilidad del proyecto era qr-load-test.yml, semanal. Si
// Supabase tiene una degradación o corte fuera de esa ventana, el primer
// indicio hoy es un usuario reportando el problema — sin alerta
// automática, el tiempo de detección no está acotado.
//
// Qué hace: una consulta liviana de solo lectura (SELECT 1 fila de
// `sedes`, tabla pequeña y siempre presente) con la clave ANÓNIMA — mide
// tanto disponibilidad como latencia real del mismo camino que usa la app
// (PostgREST vía @supabase/supabase-js), no un ping genérico al dominio.
// No usa la Service Role Key: un health-check no necesita bypasear RLS,
// y así el propio check también verifica indirectamente que la política
// de lectura pública de `sedes` sigue como se espera.
//
// Se considera una falla si:
//   - La consulta tarda más de HEALTH_CHECK_TIMEOUT_MS (default 5000).
//   - Devuelve un error de transporte/Postgres.
// Un resultado vacío (0 filas) NO es una falla — solo indica que la tabla
// está vacía, no que el servicio esté caído (mismo criterio que
// rls-smoke-test.mjs para tablas de solo-lectura-restringida).
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_ANON_KEY. Si
// faltan, el script se salta con exit 0 (mismo criterio que el resto de
// scripts/*.mjs de este proyecto) — no bloquea el pipeline mientras se
// configuran los secrets.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 5000;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "\n⚠️  Health check omitido: faltan SUPABASE_URL / SUPABASE_ANON_KEY " +
    "como secrets de GitHub Actions.\n" +
    "   Este paso no bloquea el pipeline hasta que se configuren.\n"
  );
  process.exit(0);
}

const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function conTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout de ${ms}ms superado`)), ms)
    ),
  ]);
}

async function main() {
  const inicio = performance.now();
  try {
    const { error } = await conTimeout(
      anon.from("sedes").select("id").limit(1),
      TIMEOUT_MS
    );
    const ms = Math.round(performance.now() - inicio);

    if (error) {
      console.error(`💥 Health check falló (${ms}ms): ${error.message}`);
      process.exit(1);
    }

    console.log(`✅ Health check OK — ${ms}ms (umbral ${TIMEOUT_MS}ms)`);
    process.exit(0);
  } catch (err) {
    const ms = Math.round(performance.now() - inicio);
    console.error(`💥 Health check falló (${ms}ms): ${err.message}`);
    process.exit(1);
  }
}

main();
