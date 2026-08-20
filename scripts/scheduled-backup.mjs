// scripts/scheduled-backup.mjs
//
// Fix ARCH-47 (auditoría E2E, 19 de agosto): el proyecto está confirmado en
// plan Free de Supabase (ver SEC-37, docs/AUDITORIA_INDICE.md), que
// típicamente no incluye point-in-time recovery — la recuperación ante un
// borrado/corrupción de datos depende solo del backup diario nativo con
// retención corta. Combinado con el contexto operativo ya documentado
// (cortes eléctricos de 5+ horas, OFF-10) y el hecho de que
// admin_borrar_asistencias_rango() ya tiene guardas de permiso/sede/
// trimestre pero no es infalible ante un error humano con permiso
// legítimo, un incidente detectado más de un día después puede caer fuera
// de la ventana de recuperación del backup nativo.
//
// Este script NO reemplaza un backup real de infraestructura (sin WAL,
// solo un snapshot lógico) — es una mitigación de bajo costo mientras se
// evalúa si el proyecto justifica Supabase Pro (mismo criterio de
// "decisión de producto, no bloqueante" que SEC-37).
//
// Qué hace:
//   1. Consulta horarios/docentes/materias/asistencias_diarias DIRECTO con
//      la Service Role Key (bypasea RLS), filtrando por sede a mano — NO
//      llama al RPC exportar_backup_completo() (PERM-6/PROG-1a).
//   2. Escribe el JSON resultante a disco (backups/sigmapnf-backup-<fecha>.json)
//      para que el workflow lo suba como artifact de GitHub Actions.
//   3. Corre una vez POR SEDE activa, iterando el catálogo de `sedes`.
//
// *** Por qué NO se reutiliza exportar_backup_completo() (decisión
// verificada, no solo preferida): *** ese RPC es SECURITY DEFINER pero
// hace `tiene_permiso(auth.uid(), 'puedeHacerBackup')` como primer chequeo
// y luego `SELECT sede_id FROM user_profiles WHERE id = auth.uid()` para
// resolver la sede. Con la Service Role Key, auth.uid() es NULL (no hay
// JWT de usuario real detrás) — el mismo patrón que SEC-33 ya documentó
// para admin_delete_user ("lo primero que hace es el chequeo de permiso
// sobre auth.uid(), que es NULL para un caller anónimo — falla de
// inmediato"). Llamar el RPC así solo produciría la excepción "No tienes
// permiso para exportar un backup." — por eso este script consulta las
// tablas directo, como hacía backupActions.js ANTES de PERM-6 (ese cambio
// se hizo para el cliente de la app, autenticado con un usuario real; un
// job de infraestructura con la Service Role Key es un caso distinto, sin
// usuario detrás que gatee).
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Si falta alguna, el script se salta con exit 0 (mismo criterio que
// rls-smoke-test.mjs / qr-load-test.mjs) — no bloquea el pipeline mientras
// se configuran los secrets.

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_DIR = process.env.BACKUP_OUTPUT_DIR || "backups";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn(
    "\n⚠️  Backup programado omitido: faltan SUPABASE_URL / " +
    "SUPABASE_SERVICE_ROLE_KEY como secrets de GitHub Actions.\n" +
    "   Este paso no bloquea el pipeline hasta que se configuren.\n"
  );
  process.exit(0);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function fechaHoyVE() {
  // Mismo criterio que el resto del proyecto (utils/time.js) — ancla
  // explícita a hora VE para que el nombre del archivo no dependa del
  // huso horario del runner de CI (UTC).
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
}

async function obtenerSedesActivas() {
  const { data, error } = await admin
    .from("sedes")
    .select("id, nombre")
    .eq("activa", true);
  if (error) {
    throw new Error(`No se pudo leer el catálogo de sedes: ${error.message}`);
  }
  return data ?? [];
}

async function consultarTabla(tabla, sedeId) {
  const { data, error } = await admin
    .from(tabla)
    .select("*")
    .eq("sede_id", sedeId);
  if (error) {
    throw new Error(`Consulta a "${tabla}" (sede=${sedeId}) falló: ${error.message}`);
  }
  return data ?? [];
}

async function exportarBackupSede(sedeId) {
  // Mismas 4 tablas y mismo criterio de filtrado por sede que
  // exportar_backup_completo() (PERM-6/PROG-1a) — replicado a mano porque
  // ese RPC no es invocable desde un contexto sin auth.uid() real (ver
  // nota de cabecera del archivo). Se consulta en paralelo, no en
  // secuencia, mismo criterio de eficiencia que backupActions.js.
  const [horarios, docentes, materias, asistencias] = await Promise.all([
    consultarTabla("horarios", sedeId),
    consultarTabla("docentes", sedeId),
    consultarTabla("materias", sedeId),
    consultarTabla("asistencias_diarias", sedeId),
  ]);
  return { horarios, docentes, materias, asistencias };
}

async function main() {
  const fecha = fechaHoyVE();
  console.log(`\n📦 Backup programado — ${fecha} (hora VE)\n`);

  const sedes = await obtenerSedesActivas();
  if (sedes.length === 0) {
    console.warn("⚠️  No se encontraron sedes activas — nada que respaldar.");
    process.exit(0);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const resumen = [];
  for (const sede of sedes) {
    console.log(`   → Exportando sede "${sede.nombre}" (${sede.id})...`);
    const backup = await exportarBackupSede(sede.id);
    const archivo = path.join(OUTPUT_DIR, `sigmapnf-backup-${fecha}-${sede.id}.json`);
    await writeFile(archivo, JSON.stringify(backup, null, 2), "utf-8");
    resumen.push({ sede: sede.id, archivo, ok: true });
    console.log(`     ✅ ${archivo}`);
  }

  const manifiesto = path.join(OUTPUT_DIR, `manifiesto-${fecha}.json`);
  await writeFile(manifiesto, JSON.stringify({ fecha, sedes: resumen }, null, 2), "utf-8");

  console.log(`\n✅ Backup programado completo: ${resumen.length} sede(s) exportada(s).\n`);
}

main().catch((err) => {
  console.error("\n💥 El backup programado terminó con un error inesperado:", err);
  process.exit(1);
});
