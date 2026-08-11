/**
 * Migration runner, ported from the revision ladder in include/events.php.
 *
 * The source migrates its database at application start: Einstellungen.Revision
 * (row ID=1) holds the current revision, and each guarded block brings the
 * schema/data from one revision to the next, ending with the new number:
 *
 *   if(DBLookup("Select Revision from Einstellungen where ID=1")=="1806") {
 *     ... CustomQuery(...) calls ...
 *     Update Einstellungen set Revision='1807' where ID=1
 *   }
 *
 * scripts/extract-migrations.py pulled the ladder into src/meta/migrations.json
 * (7 steps, 250 statements, 1804 -> 1812). This runner applies the pending
 * steps in order, translating the MySQL dialect to SQLite, and records —
 * instead of crashing on — statements that no longer apply, exactly like the
 * source's CustomQuery which swallows per-statement errors.
 *
 * It never logs anyone in and never touches the session: it only needs a
 * prisma-like object with $queryRawUnsafe.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FILE = path.join(HERE, 'meta', 'migrations.json');

/** The revision the bootstrap lands on (the first guarded step expects it). */
export const BOOTSTRAP_REVISION = '1804';

let cache = null;

/** Reads src/meta/migrations.json once, tolerating a BOM. */
export function loadMigrations() {
  if (!cache) {
    let raw = fs.readFileSync(MIGRATIONS_FILE, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    cache = JSON.parse(raw);
  }
  return cache;
}

export function resetMigrationsCache() {
  cache = null;
}

/** MySQL column type -> SQLite affinity. */
export function mapColumnType(typeSpec) {
  const t = String(typeSpec || '').toLowerCase().replace(/\s+/g, '');
  if (/^(varchar|char|tinytext|text|mediumtext|longtext|enum|set)\b/.test(t)) return 'TEXT';
  if (/^(tinyint|smallint|mediumint|int|integer|bigint)\b/.test(t)) return 'INTEGER';
  if (/^(decimal|numeric|float|double|real)\b/.test(t)) return 'NUMERIC';
  if (/^(datetime|timestamp|date|time|year)\b/.test(t)) return 'TEXT';
  if (/^(blob|mediumblob|longblob|binary|varbinary)\b/.test(t)) return 'BLOB';
  return 'TEXT';
}

/**
 * Translates one MySQL statement into SQLite, or returns null when the
 * statement has no meaning here (e.g. `show columns`, a MySQL-only probe).
 */
export function translateSql(sql) {
  if (sql == null) return null;
  let out = String(sql).trim().replace(/;$/, '');
  if (!out) return null;

  // MySQL information probes are app-level checks, not statements to run.
  if (/^show\s+/i.test(out)) return null;

  out = out.replace(/`/g, '"');

  // ALTER TABLE x ADD col TYPE -> SQLite ADD COLUMN with a mapped type
  const addMatch = out.match(/^ALTER\s+TABLE\s+"?([\w ]+?)"?\s+ADD\s+(?:COLUMN\s+)?"?([\w]+)"?\s+([\s\S]+)$/i);
  if (addMatch) {
    const [, table, column, typeSpec] = addMatch;
    const type = mapColumnType(typeSpec.replace(/\s+DEFAULT\s+.*$/i, '').trim());
    const defaultM = typeSpec.match(/DEFAULT\s+('[^']*'|"[^"]*"|[\w.]+)/i);
    const def = defaultM ? ` DEFAULT ${defaultM[1]}` : '';
    return `ALTER TABLE "${table.trim()}" ADD COLUMN "${column}" ${type}${def}`;
  }

  // CREATE TABLE: drop the MySQL engine tail, map types, fix AUTO_INCREMENT
  if (/^CREATE\s+TABLE/i.test(out)) {
    out = out.replace(/\)\s*ENGINE\s*=\s*[\s\S]*$/i, ')');
    out = out.replace(/\bint\(\d+\)\s+AUTO_INCREMENT/gi, 'INTEGER');
    out = out.replace(/\bAUTO_INCREMENT\b/gi, '');
    out = out.replace(/\b(varchar|char)\s*\(\s*\d+\s*\)/gi, 'TEXT');
    out = out.replace(/\b(tinyint|smallint|mediumint|bigint|int|integer)\s*\(\s*\d+\s*\)/gi, 'INTEGER');
    out = out.replace(/\bdecimal\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'NUMERIC');
    out = out.replace(/\b(mediumtext|longtext|tinytext)\b/gi, 'TEXT');
    out = out.replace(/\b(mediumblob|longblob)\b/gi, 'BLOB');
    out = out.replace(/\bdatetime\b/gi, 'TEXT');
    return out;
  }

  out = out.replace(/\bNOW\(\)/gi, "datetime('now')");
  return out;
}

/** Steps whose target revision is newer than the current one. */
export function pendingMigrations(currentRevision) {
  const steps = (loadMigrations().steps || []).filter((s) => s.from && s.to);
  if (!currentRevision) return steps;
  const current = String(currentRevision);
  return steps.filter((s) => s.to > current);
}

/**
 * The revision stored in Einstellungen (ID=1), or null when the column does
 * not exist yet (a pre-1804 database that needs the bootstrap first).
 */
export async function currentRevision(prisma) {
  const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("Einstellungen")');
  const hasRevision = Array.isArray(columns) && columns.some((c) => c && c.name === 'Revision');
  if (!hasRevision) return null;
  const rows = await prisma.$queryRawUnsafe('SELECT "Revision" FROM "Einstellungen" WHERE "ID" = 1');
  const row = Array.isArray(rows) ? rows[0] : null;
  return row && row.Revision != null ? String(row.Revision) : null;
}

async function execTranslated(prisma, sql, report, revision) {
  const translated = translateSql(sql);
  if (translated == null) {
    report.statementsSkipped += 1;
    return;
  }
  try {
    await prisma.$queryRawUnsafe(translated);
    report.statementsRun += 1;
  } catch (e) {
    // faithful to CustomQuery(): a statement that no longer applies (column
    // already exists, row already present) must not stop the ladder.
    report.statementsFailed += 1;
    report.errors.push({ revision, sql: String(sql).slice(0, 140), error: String(e && e.message || e) });
  }
}

/**
 * Brings the database to the newest revision.
 *
 * @param {object} args.prisma  anything with $queryRawUnsafe
 * @returns {object} report { from, to, bootstrapped, applied[],
 *   statementsRun, statementsFailed, statementsSkipped, errors[] }
 */
export async function runMigrations({ prisma } = {}) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') {
    throw new Error('runMigrations needs a prisma-like object with $queryRawUnsafe');
  }
  const report = {
    from: null, to: null, bootstrapped: false, applied: [],
    statementsRun: 0, statementsFailed: 0, statementsSkipped: 0, errors: [],
  };

  let revision = await currentRevision(prisma);
  if (revision == null) {
    // bootstrap: the Revision column itself was introduced by the 1804 step
    await execTranslated(prisma, 'ALTER TABLE Einstellungen ADD Revision TEXT', report, 'bootstrap');
    await execTranslated(prisma, `UPDATE "Einstellungen" SET "Revision" = '${BOOTSTRAP_REVISION}' WHERE "ID" = 1`, report, 'bootstrap');
    revision = BOOTSTRAP_REVISION;
    report.bootstrapped = true;
  }
  report.from = revision;

  for (const step of pendingMigrations(revision)) {
    for (const sql of step.sql) {
      await execTranslated(prisma, sql, report, step.to);
    }
    await prisma.$queryRawUnsafe(`UPDATE "Einstellungen" SET "Revision" = '${step.to}' WHERE "ID" = 1`);
    report.applied.push(step.to);
  }

  report.to = report.applied.length ? report.applied[report.applied.length - 1] : revision;
  return report;
}

export default {
  BOOTSTRAP_REVISION,
  loadMigrations,
  resetMigrationsCache,
  mapColumnType,
  translateSql,
  pendingMigrations,
  currentRevision,
  runMigrations,
};
