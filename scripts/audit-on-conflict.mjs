#!/usr/bin/env node
/**
 * audit-on-conflict.mjs
 *
 * Detecta drift entre el ON CONFLICT de funciones/triggers de Postgres y
 * las unique constraints / unique indexes reales de las tablas a las que
 * apuntan.
 *
 * Nace del post-mortem del 2026-08-10: registrar_asistencia(),
 * registrar_asistencia_manual(), restaurar_backup() y el trigger
 * horarios_resolver_docente_materia() quedaron con un ON CONFLICT
 * desactualizado tras agregar sede_id a las unique constraints de
 * asistencias_diarias / materias / docentes (épica SEDE-N). Postgres
 * exige que el target de ON CONFLICT calce EXACTAMENTE con un índice
 * único existente — si no calza, CUALQUIER insert falla con:
 *   "there is no unique or exclusion constraint matching the
 *    ON CONFLICT specification"
 *
 * Este script solo LEE catálogos del sistema (pg_proc, pg_indexes).
 * No modifica datos ni esquema. Seguro de correr contra producción o
 * contra un branch/staging de Supabase.
 *
 * Uso:
 *   DATABASE_URL="postgres://..." node scripts/audit-on-conflict.mjs
 *
 * En GitHub Actions: guardar la connection string de Supabase
 * (Settings → Database → Connection string → URI, usar el "pooler"
 * o "direct connection" con el usuario de solo lectura si existe)
 * como secret DATABASE_URL y correr este script en el job de CI.
 * Exit code 1 si encuentra algún mismatch.
 */

import pg from 'pg';

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Falta la variable de entorno DATABASE_URL.');
  console.error('   Ejemplo: DATABASE_URL="postgres://postgres:***@db.xxxx.supabase.co:5432/postgres"');
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

/**
 * Extrae pares (tabla, columnas_on_conflict) del código fuente de una
 * función/trigger. Trabaja por sentencia (split por ';') para evitar
 * emparejar un INSERT con el ON CONFLICT de otro INSERT posterior.
 */
function extractOnConflictTargets(prosrc) {
  const results = [];
  const statements = prosrc.split(';');

  for (const stmt of statements) {
    const insertMatch = stmt.match(/insert\s+into\s+(?:public\.)?([a-zA-Z_][\w]*)/i);
    const conflictMatch = stmt.match(/on\s+conflict\s*\(([^)]*)\)/i);

    if (insertMatch && conflictMatch) {
      const table = insertMatch[1].toLowerCase();
      const columns = conflictMatch[1]
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      results.push({ table, columns });
    }
    // ON CONFLICT sin columnas explícitas, ej. "ON CONFLICT DO NOTHING"
    // a secas, se ignora: no hay target que validar.
  }

  return results;
}

function normalizeColSet(cols) {
  return [...cols].sort().join(',');
}

async function getUniqueIndexColumnSets(table) {
  const { rows } = await client.query(
    `select indexdef from pg_indexes where schemaname = 'public' and tablename = $1 and indexdef ilike 'create unique index%'`,
    [table]
  );

  return rows.map((r) => {
    const match = r.indexdef.match(/\(([^)]*)\)/);
    if (!match) return null;
    const cols = match[1]
      .split(',')
      .map((c) => c.trim().toLowerCase())
      // columnas de expresión (ej. lower(nombre_raw)) no cuentan como
      // columna simple; se dejan tal cual para no dar falsos positivos
      .filter(Boolean);
    return normalizeColSet(cols);
  }).filter(Boolean);
}

async function main() {
  await client.connect();

  const { rows: funcs } = await client.query(`
    select n.nspname as schema, p.proname, p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ilike '%on conflict%'
  `);

  const problems = [];
  const checked = [];

  for (const fn of funcs) {
    const targets = extractOnConflictTargets(fn.prosrc);

    for (const target of targets) {
      const uniqueSets = await getUniqueIndexColumnSets(target.table);
      const normalizedTarget = normalizeColSet(target.columns);
      const matches = uniqueSets.includes(normalizedTarget);

      checked.push({ fn: fn.proname, table: target.table, columns: target.columns });

      if (!matches) {
        problems.push({
          fn: fn.proname,
          table: target.table,
          onConflictColumns: target.columns,
          realUniqueIndexes: uniqueSets,
        });
      }
    }
  }

  await client.end();

  console.log(`🔍 Revisadas ${checked.length} clausula(s) ON CONFLICT en ${funcs.length} funcion(es)/trigger(s).\n`);

  if (problems.length === 0) {
    console.log('✅ Todos los ON CONFLICT coinciden con una unique constraint/index real.');
    process.exit(0);
  }

  console.error(`🔴 ${problems.length} mismatch(es) encontrados:\n`);
  for (const p of problems) {
    console.error(`  Función: ${p.fn}`);
    console.error(`  Tabla:   ${p.table}`);
    console.error(`  ON CONFLICT (${p.onConflictColumns.join(', ')})  ← no coincide con ninguna constraint real`);
    console.error(`  Unique indexes reales en ${p.table}:`);
    if (p.realUniqueIndexes.length === 0) {
      console.error(`    (ninguno)`);
    } else {
      for (const u of p.realUniqueIndexes) {
        console.error(`    (${u.split(',').join(', ')})`);
      }
    }
    console.error('');
  }

  process.exit(1);
}

main().catch((err) => {
  console.error('Error ejecutando la auditoría:', err);
  process.exit(1);
});
