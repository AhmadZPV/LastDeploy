/**
 * Heuristic field formatting — the bootstrap layer beneath field-format.js.
 *
 * The source ships per-field view/edit blocks (field-format.js reads those),
 * but list pages, CSV exports and the fulltext endpoint need a quick answer
 * for fields without manifest coverage. This module guesses the field's
 * nature from the registry's schema type first and from its name second —
 * never the other way around, because German column names lie more often
 * than the schema does.
 */
import { registry } from './registry.js';
import { isRichTextField, sanitizeRichText } from './rich-text.js';

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const DATE_NAME = /datum|termin$|_am$|zeitpunkt|gueltig|von$|bis$|^von|^bis/i;
const BOOL_NAME = /^(ist|hat|aktiv|inactive|gesperrt|bezahlt|erledigt)/i;
const MONEY_NAME = /betrag|preis|miete|kosten|saldo|summe|wert|gebuehr|zins|mwst|anteil/i;

function fieldType(entity, field) {
  const meta = registry[String(entity || '').toLowerCase()];
  return meta?.fields?.[field]?.type || null;
}

/**
 * The coarse category of a field: 'lookup' | 'date' | 'bool' | 'money' |
 * 'int' | 'blob' | 'text'. Drives search coercion, CSV rendering and the
 * generic list display.
 */
export function fieldCategory(entity, field) {
  if (isRichTextField(entity, field)) return 'richtext';
  const slug = String(entity || '').toLowerCase();
  if (registry[slug]?.lookupFields?.[field]) return 'lookup';
  const type = fieldType(entity, field);
  switch (type) {
    case 'DateTime': return 'date';
    case 'Boolean': return 'bool';
    case 'Bytes': return 'blob';
    case 'Decimal':
    case 'Float': return 'money';
    case 'Int':
    case 'BigInt':
      // an Int can still be a lookup by naming convention (…Id columns)
      if (/^(objekt|einheit|adresse|mieter|vertrag|konto|kategorie|art)$/i.test(field)) return 'lookup';
      return 'int';
    default: break;
  }
  if (BOOL_NAME.test(field)) return 'bool';
  if (DATE_NAME.test(field)) return 'date';
  if (MONEY_NAME.test(field)) return 'money';
  return 'text';
}

const fmtCache = new Map();
function german(digits) {
  const key = String(digits);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** Decimal-aware Number(): Prisma Decimals, strings with a comma, plain values. */
export function toNum(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const n = Number(String(value).replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

/** German number rendering; null and non-numbers render as an empty cell. */
export function fmtNum(value, digits = 2) {
  if (value == null || value === '') return '';
  const n = toNum(value);
  if (Number.isNaN(n)) return '';
  return german(digits).format(n);
}

/** DD.MM.YYYY — the date format every PHP page printed. */
export function fmtDate(value) {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Value for <input type="date">: YYYY-MM-DD or ''. */
export function inputDate(value) {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The display string of one cell in a generic list/view. Never HTML-escapes:
 * callers (EJS templates, fulltext.php port) escape at their own boundary.
 */
export function display(entity, field, value) {
  if (value == null) return '';
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;
  const cat = fieldCategory(entity, field);
  if (cat === 'richtext') return sanitizeRichText(value);
  if (value instanceof Date) return escapeHtml(fmtDate(value));
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    return fmtNum(value, cat === 'int' ? 0 : 2);
  }
  if (cat === 'date') return escapeHtml(fmtDate(value));
  if (cat === 'bool') return (value === true || value === 1 || value === '1') ? 'Ja' : 'Nein';
  if (cat === 'money' && typeof value === 'number') return fmtNum(value, 2);
  if (cat === 'int' && typeof value === 'number') return String(value);
  return escapeHtml(value);
}

/**
 * Coerce one posted form value into the column's type. The caller already
 * skips empty strings, so '' never reaches here as a value to store.
 */
export function coerce(entity, field, raw) {
  if (raw == null) return null;
  const type = fieldType(entity, field);
  const cat = fieldCategory(entity, field);
  if (type === 'Int' || type === 'BigInt') {
    const n = Number(String(raw).replace(/\./g, '').replace(',', '.'));
    return Number.isNaN(n) ? null : Math.trunc(n);
  }
  if (type === 'Decimal' || type === 'Float' || cat === 'money') {
    const s = String(raw).trim();
    // both separators present: the dot is the German thousands separator
    const n = /,/.test(s) && /\./.test(s)
      ? Number(s.replace(/\./g, '').replace(',', '.'))
      : Number(s.replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }
  if (type === 'DateTime' || cat === 'date') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (type === 'Boolean') {
    return raw === true || raw === 1 || ['1', 'on', 'true', 'ja', 'Ja'].includes(String(raw));
  }
  return raw;
}

export default { fieldCategory, display, coerce, toNum, fmtNum, fmtDate, inputDate };
