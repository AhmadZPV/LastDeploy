/**
 * Phase 10 - audit trail (port of PHPRunner's audit logging).
 *
 * Every add/edit/delete lands as one row in the physical table
 * `intex hausverwaltung_audit` (schema model `intex_hausverwaltung_audit`):
 *   id | datetime | ip | user | table | action | description
 *
 * Description format, matching the PHP pages:
 *   add:    "Bezeichnung=Haus A"            (field=value, one per line)
 *   edit:   "Ort: Berlin → München"         (only fields that actually changed)
 *   delete: "Bezeichnung=Haus A"            (dump of the removed row)
 *
 * Everything is best-effort: a failing audit write returns null and never
 * breaks the CRUD operation it was logging (the PHP code had the same
 * property via CustomQuery calls that ignored errors).
 */

const DELEGATES = ['intex_hausverwaltung_audit', 'intexHausverwaltungAudit'];

function delegateOf(prisma) {
  for (const name of DELEGATES) {
    if (prisma && prisma[name]) return prisma[name];
  }
  return null;
}

/** Human-readable cell value (dates, buffers, Prisma Decimals). */
function printable(value) {
  if (value == null) return '';
  if (Buffer.isBuffer(value)) return `[BLOB ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && typeof value.toNumber === 'function') return String(value.toNumber());
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Build the description line set for one audited action.
 *
 * @param action    'add' | 'edit' | 'delete'
 * @param recordId  the record's key value (logged as `ID=<recordId>` header)
 * @param oldData   row before the change (edit/delete)
 * @param newData   applied values (add/edit)
 */
export function describeChange(action, recordId, oldData, newData) {
  const lines = [];
  if (recordId !== undefined && recordId !== null) lines.push(`ID=${recordId}`);
  if (action === 'edit' && oldData && newData) {
    for (const [field, next] of Object.entries(newData)) {
      const a = printable(oldData[field]);
      const b = printable(next);
      if (a !== b) lines.push(`${field}: ${a} → ${b}`);
    }
  } else if (action === 'add' && newData) {
    for (const [field, v] of Object.entries(newData)) lines.push(`${field}=${printable(v)}`);
  } else if (action === 'delete' && oldData) {
    for (const [field, v] of Object.entries(oldData)) lines.push(`${field}=${printable(v)}`);
  }
  return lines.join('\n');
}

/**
 * Write one audit row.
 *
 * @returns the created row, or null when auditing is unavailable/failed.
 */
export async function auditLog({ prisma, req, table, action, recordId, oldData, newData } = {}) {
  try {
    const delegate = delegateOf(prisma);
    if (!delegate) return null;
    const data = {
      datetime: new Date().toISOString(),
      ip: req?.headers?.['x-forwarded-for'] || req?.ip || '',
      user: req?.session?.user?.Benutzername || req?.session?.user?.username || '',
      table: String(table || ''),
      action: String(action || ''),
      description: describeChange(action, recordId, oldData, newData),
    };
    if (typeof prisma.$executeRawUnsafe === 'function') {
      await prisma.$executeRawUnsafe(
        'INSERT INTO "intex hausverwaltung_audit" ("datetime", "ip", "user", "table", "action", "description") VALUES (?, ?, ?, ?, ?, ?)',
        data.datetime, data.ip, data.user, data.table, data.action, data.description,
      );
      return data;
    }
    const row = await delegate.create({ data: { ...data, datetime: new Date(data.datetime) } });
    return row;
  } catch (e) {
    console.warn('audit: logging failed for', action, 'on', table, '-', e.message);
    return null;
  }
}

export default { auditLog, describeChange };
