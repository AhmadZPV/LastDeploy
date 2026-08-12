/**
 * Build a Prisma write payload from a form POST.
 *
 * Generic CRUD used to copy every body key, including `_csrf` (unknown to
 * Prisma → every save failed) and privilege columns such as Gruppe/active
 * (a user with Edit on Benutzer could promote themselves to Admins).
 */

const RESERVED = new Set(['_csrf', '_method', '_token']);

/** Columns a non-admin must never set through the generic record form. */
export const PRIVILEGED_FIELDS = new Set([
  'Gruppe', 'active', 'reset_token', 'reset_date', 'Freigabe',
]);

export function recordValuesFromBody(body, {
  entity,
  fields,
  coerce,
  isEdit = false,
  isAdmin = false,
} = {}) {
  const data = {};
  const allowed = fields && typeof fields === 'object' ? fields : null;
  for (const [k, v] of Object.entries(body || {})) {
    if (RESERVED.has(k) || k.startsWith('_')) continue;
    if (k === 'ID') continue;
    if (isEdit && k === 'Team') continue;
    if (!isAdmin && PRIVILEGED_FIELDS.has(k)) continue;
    if (allowed && !Object.prototype.hasOwnProperty.call(allowed, k)) continue;
    if (v === '') continue;
    data[k] = coerce ? coerce(entity, k, v) : v;
  }
  return data;
}

export default { RESERVED, PRIVILEGED_FIELDS, recordValuesFromBody };
