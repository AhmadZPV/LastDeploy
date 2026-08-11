import { parseSchema } from './registry.js';

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
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
    }
  }
  return updated;
}

export default { normalizeSqliteDateTimes };
