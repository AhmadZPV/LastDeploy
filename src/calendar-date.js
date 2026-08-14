/**
 * Date-only values in this app are calendar dates (MySQL DATE / SQLite text).
 * `normalizeSqliteDateTimes` stores them as UTC midnight (`…T00:00:00.000Z`)
 * so Prisma can decode the column. Local getters (`getDate` / `getMonth`)
 * then shift the day backwards in any timezone behind UTC — a DATEV export
 * of 2026-08-09 becomes 08082026 in Pacific time, which is a wrong booking
 * date, not a display preference.
 *
 * Always read Y-M-D from the stored calendar date, never from local time.
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** @returns {{ y: number, m: number, d: number } | null} */
export function calendarParts(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Date constructors without a timezone represent a local calendar day;
  // preserve that day while normalized database values remain UTC midnight.
  if (value instanceof Date && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** DD.MM.YYYY — the date format every PHP page printed. */
export function formatDeDate(value) {
  const p = calendarParts(value);
  if (!p) return value == null || value === '' ? '' : String(value);
  return `${pad(p.d)}.${pad(p.m)}.${p.y}`;
}

/** YYYY-MM-DD for <input type="date"> and ISO raw cells. */
export function formatIsoDate(value) {
  const p = calendarParts(value);
  if (!p) return value == null || value === '' ? '' : String(value);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** DDMMYYYY — DATEV / DATEV_Export concat(lpad(day), lpad(month), year). */
export function formatDatevDate(value) {
  const p = calendarParts(value);
  if (!p) return '';
  return `${pad(p.d)}${pad(p.m)}${p.y}`;
}

export default { calendarParts, formatDeDate, formatIsoDate, formatDatevDate };
