/**
 * Central guard so that no write path can ever put a plain-text credential in
 * the database.
 *
 * Background: `routes/admin.js` hashed passwords, but the generic CRUD editor
 * (`routes/crud.js` POST /:id) wrote whatever the form posted straight through
 * `coerce()`. Editing a user through the normal record form therefore replaced
 * the bcrypt hash with the raw password. `routes/auth.js` accepts "plain or
 * bcrypt" on login, so the bug never surfaced as a broken login.
 *
 * This module is deliberately conservative:
 *   - it only touches columns whose NAME looks like a credential
 *   - a value that is already a bcrypt hash is left untouched (no double hash)
 *   - an empty value is removed from the payload, so "leave blank" keeps the
 *     stored password instead of clearing it
 */
import bcrypt from 'bcryptjs';

/** Same vocabulary the display masking in src/formatters.js uses. */
export const SECRET_NAME = /(passwort|password|passwd|kennwort)/i;

/** $2a$ / $2b$ / $2y$ + cost + 53 chars of salt|digest. */
const BCRYPT_RE = /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(value) {
  return typeof value === 'string' && BCRYPT_RE.test(value);
}

export function isPasswordField(name) {
  return SECRET_NAME.test(String(name || ''));
}

/**
 * Hash every credential column found in `values`, in place.
 *
 * @param {object} values  the payload about to be handed to prisma
 * @returns {Promise<string[]>} names of the columns that were hashed
 */
export async function hashPasswordFields(values) {
  if (!values || typeof values !== 'object') return [];
  const hashed = [];
  for (const key of Object.keys(values)) {
    if (!isPasswordField(key)) continue;
    const raw = values[key];
    // "leave blank to keep the current password"
    if (raw == null || raw === '') {
      delete values[key];
      continue;
    }
    // Buffer/Date/number are never a password the user typed.
    if (typeof raw !== 'string') continue;
    // already hashed (e.g. a re-submitted form, or an import of hashes)
    if (isBcryptHash(raw)) continue;
    values[key] = await bcrypt.hash(raw, 10);
    hashed.push(key);
  }
  return hashed;
}

/** Hash a single value unless it already is a bcrypt hash. */
export async function hashPassword(plain) {
  const s = String(plain == null ? '' : plain);
  return isBcryptHash(s) ? s : bcrypt.hash(s, 10);
}

export default { SECRET_NAME, isBcryptHash, isPasswordField, hashPasswordFields, hashPassword };
