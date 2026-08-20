// scripts/verify-backup.mjs
//
// Fix ARCH-50 (fase de optimización fina, 20 de agosto): scheduled-backup.mjs
// (ARCH-47) escribe el JSON del backup diario a disco y el workflow lo sube
// como artifact, pero nada confirmaba que ese JSON fuera realmente
// restaurable — un archivo truncado por un job matado a mitad de escritura,
// una fila de error de Supabase serializada por accidente en vez de datos
// reales, o una consulta que silenciosamente devuelve 0 filas en TODAS las
// sedes (p. ej. Service Role Key rotada/inválida) habría subido igual como
// artifact "exitoso" durante los 30 días de retención, sin que nadie lo
// notara hasta el día que hiciera falta restaurar de verdad.
//
// Qué NO hace este script (alcance explícito): no restaura datos a ninguna
// base — sería un riesgo mayor que el problema que resuelve, y este
// proyecto no tiene una BD de staging separada contra la cual probar un
// restore real. Es una verificación estructural (integridad del snapshot),
// no un restore-test funcional. Mismo espíritu que rls-smoke-test.mjs:
// confirma una propiedad concreta, no simula el sistema completo.
//
// Qué SÍ hace:
//   1. Lee el manifiesto del día (manifiesto-<fecha>.json) y confirma que
//      cada sede que declara ok:true tiene su archivo real en disco.
//   2. Por cada archivo de sede: JSON.parse íntegro (detecta truncamiento),
//      forma exacta esperada (las 4 claves de exportarBackupSede — ni de
//      más ni de menos — y cada una es un array), y cada fila es un objeto
//      plano con `id` (detecta que no se haya colado un objeto de error de
//      Supabase u otra forma inesperada en vez de filas reales).
//   3. Señal anti-falso-positivo (mismo criterio que health-check.yml/
//      ARCH-48): que UNA sede tenga las 4 tablas vacías es plausible (sede
//      nueva sin actividad aún) — solo advierte. Que TODAS las sedes
//      tengan las 4 tablas vacías a la vez no lo es — casi seguro indica
//      una credencial rota o una query fallando en silencio, y sí falla el
//      job (exit 1).
//
// Variables de entorno: ninguna nueva — reusa BACKUP_OUTPUT_DIR (default
// "backups", igual que scheduled-backup.mjs). Si el directorio no existe o
// está vacío, se salta con exit 0 (mismo criterio que el resto de scripts
// de infraestructura del proyecto: secrets/backup ausentes no bloquean el
// pipeline mientras se configuran).

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = process.env.BACKUP_OUTPUT_DIR || "backups";
const TABLAS_ESPERADAS = ["horarios", "docentes", "materias", "asistencias"];

function fechaHoyVE() {
  // Mismo criterio que scheduled-backup.mjs: ancla explícita a hora VE,
  // no al huso horario del runner (UTC), para encontrar el manifiesto del
  // mismo día que acaba de generar el paso anterior del workflow.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
}

async function dirExiste(dir) {
  try {
    await readdir(dir);
    return true;
  } catch {
    return false;
  }
}

function esObjetoPlano(valor) {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function validarFormaBackup(backup, etiqueta, errores) {
  if (!esObjetoPlano(backup)) {
    errores.push(`${etiqueta}: el JSON raíz no es un objeto`);
    return { totalFilas: 0 };
  }

  const claves = Object.keys(backup).sort();
  const esperadas = [...TABLAS_ESPERADAS].sort();
  if (claves.length !== esperadas.length || !claves.every((c, i) => c === esperadas[i])) {
    errores.push(
      `${etiqueta}: claves inesperadas — se esperaba exactamente [${esperadas.join(", ")}], se encontró [${claves.join(", ")}]`
    );
  }

  let totalFilas = 0;
  for (const tabla of TABLAS_ESPERADAS) {
    const filas = backup[tabla];
    if (!Array.isArray(filas)) {
      errores.push(`${etiqueta}: "${tabla}" no es un array (¿se coló un objeto de error?)`);
      continue;
    }
    for (const [i, fila] of filas.entries()) {
      if (!esObjetoPlano(fila) || !("id" in fila)) {
        errores.push(`${etiqueta}: "${tabla}"[${i}] no tiene la forma de una fila real (sin "id")`);
        break; // una fila rota por tabla alcanza para marcar el archivo como sospechoso
      }
    }
    totalFilas += filas.length;
  }

  return { totalFilas };
}

async function main() {
  const existe = await dirExiste(OUTPUT_DIR);
  if (!existe) {
    console.warn(
      `\n⚠️  Verificación de backup omitida: no existe "${OUTPUT_DIR}" ` +
      "(el paso de backup no llegó a correr, probablemente por secrets ausentes).\n"
    );
    process.exit(0);
  }

  const fecha = fechaHoyVE();
  const manifiestoPath = path.join(OUTPUT_DIR, `manifiesto-${fecha}.json`);

  let manifiesto;
  try {
    manifiesto = JSON.parse(await readFile(manifiestoPath, "utf-8"));
  } catch (err) {
    console.error(`\n💥 No se pudo leer/parsear el manifiesto del día (${manifiestoPath}): ${err.message}\n`);
    process.exit(1);
  }

  const sedes = manifiesto.sedes ?? [];
  if (sedes.length === 0) {
    console.warn("\n⚠️  El manifiesto no lista ninguna sede — nada que verificar.\n");
    process.exit(0);
  }

  console.log(`\n🔍 Verificando integridad del backup — ${fecha} (${sedes.length} sede(s))\n`);

  const errores = [];
  let totalFilasGlobal = 0;
  let sedesTotalmenteVacias = 0;

  for (const entrada of sedes) {
    const etiqueta = `sede ${entrada.sede}`;
    if (!entrada.ok) {
      errores.push(`${etiqueta}: el manifiesto ya la marca como no-ok`);
      continue;
    }
    if (!entrada.archivo) {
      errores.push(`${etiqueta}: el manifiesto no tiene ruta de archivo`);
      continue;
    }

    let contenido;
    try {
      contenido = JSON.parse(await readFile(entrada.archivo, "utf-8"));
    } catch (err) {
      errores.push(`${etiqueta}: archivo "${entrada.archivo}" ilegible o JSON truncado (${err.message})`);
      continue;
    }

    const erroresAntes = errores.length;
    const { totalFilas } = validarFormaBackup(contenido, etiqueta, errores);
    totalFilasGlobal += totalFilas;
    const sedeTuvoErrores = errores.length > erroresAntes;

    if (sedeTuvoErrores) {
      console.log(`   ❌ ${etiqueta}: problema(s) de forma — ver detalle abajo`);
    } else if (totalFilas === 0) {
      sedesTotalmenteVacias += 1;
      console.log(`   ⚠️  ${etiqueta}: 0 filas en las 4 tablas (posible, no se falla por esto solo)`);
    } else {
      console.log(`   ✅ ${etiqueta}: estructura válida, ${totalFilas} fila(s) en total`);
    }
  }

  // Señal fuerte: TODAS las sedes vacías a la vez, no solo una — mismo
  // criterio anti-falso-positivo documentado en la cabecera del archivo.
  if (sedesTotalmenteVacias === sedes.length && sedes.length > 0) {
    errores.push(
      `Las ${sedes.length} sede(s) del backup están vacías en las 4 tablas simultáneamente — ` +
      "señal de credencial inválida o consulta fallando en silencio, no de falta de datos real."
    );
  }

  if (errores.length > 0) {
    console.error(`\n💥 Backup con ${errores.length} problema(s) de integridad:\n`);
    for (const e of errores) console.error(`   - ${e}`);
    console.error("");
    process.exit(1);
  }

  console.log(`\n✅ Backup íntegro: ${sedes.length} sede(s), ${totalFilasGlobal} fila(s) en total.\n`);
}

main().catch((err) => {
  console.error("\n💥 La verificación de backup terminó con un error inesperado:", err);
  process.exit(1);
});
