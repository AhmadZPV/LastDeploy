/**
 * Phase 6 smoke test: run every translated chart query against the real
 * SQLite database and report row counts.
 *
 * This is the check that unit tests cannot make: it proves the MySQL -> SQLite
 * translation produces SQL that the engine actually accepts.
 *
 *   node scripts/smoke-charts.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { charts, getChart, buildChartSql, toChartData } from '../src/charts/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(HERE, '..', 'prisma', 'dev.db');

const db = new DatabaseSync(DB, { readOnly: true });

let ok = 0;
let failed = 0;
const problems = [];

for (const name of Object.keys(charts().charts).sort()) {
  const spec = getChart(name);
  const built = buildChartSql(spec);
  try {
    const rows = db.prepare(built.sql).all();
    const data = toChartData(spec, rows);
    const nonNull = data.series[0]?.data.filter((v) => v !== null).length ?? 0;
    ok++;
    console.log(
      `  OK   ${name.padEnd(40)} ${String(rows.length).padStart(4)} rows  `
      + `${data.series.length} series  ${nonNull} numeric`);
  } catch (e) {
    failed++;
    problems.push({ name, message: e.message, sql: built.sql });
    console.log(`  FAIL ${name.padEnd(40)} ${e.message}`);
  }
}

console.log(`\n  ran ${ok + failed} charts: ${ok} ok, ${failed} failed`);
for (const p of problems) {
  console.log(`\n--- ${p.name}\n${p.message}\n${p.sql}\n`);
}
db.close();
process.exit(failed ? 1 : 0);
