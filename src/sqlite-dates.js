import { parseSchema } from './registry.js';

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Prisma SQLite DateTime must be ISO-8601 text. Date objects and PHP-style
 * unix timestamps land as 10- or 13-digit numbers; the query engine then
 * refuses to decode them (locking create/RETURNING is the user-visible case).
 */
export function epochToIsoSql(table, column) {
  const t = quoteIdentifier(table);
  const c = quoteIdentifier(column);
  const asInt = `CAST(${c} AS INTEGER)`;
  const isoMs = `strftime('%Y-%m-%dT%H:%M:%fZ', ${asInt} / 1000.0, 'unixepoch')`;
  const isoSec = `strftime('%Y-%m-%dT%H:%M:%fZ', ${asInt}, 'unixepoch')`;
  const numericText = `(typeof(${c}) = 'text' AND ${c} GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*' AND ${c} NOT GLOB '*[^0-9]*')`;
  const numeric = `(typeof(${c}) IN ('integer', 'real') OR ${numericText})`;
  return `UPDATE ${t}
         SET ${c} = CASE WHEN ${asInt} >= 100000000000 THEN ${isoMs} ELSE ${isoSec} END
         WHERE ${c} IS NOT NULL AND ${numeric} AND ${asInt} >= 1000000000`;
}

/** Normalize date-only dump values so Prisma can decode DateTime columns. */
export async function normalizeSqliteDateTimes(prisma) {
  let updated = 0;
  for (const model of Object.values(parseSchema())) {
    for (const field of Object.values(model.fields || {})) {
      if (field.type !== 'DateTime') continue;
      const table = quoteIdentifier(model.table);
      const column = quoteIdentifier(field.column);
      updated += await prisma.$executeRawUnsafe(
        `UPDATE ${table}
         SET ${column} = ${column} || 'T00:00:00.000Z'
         WHERE typeof(${column}) = 'text'
           AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
      );
      updated += await prisma.$executeRawUnsafe(
        `UPDATE ${table}
         SET ${column} = ${column} || '.000Z'
         WHERE typeof(${column}) = 'text'
           AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'`,
      );
      updated += await prisma.$executeRawUnsafe(epochToIsoSql(model.table, field.column));
    }
  }
  return updated;
}

export default { normalizeSqliteDateTimes, epochToIsoSql };
