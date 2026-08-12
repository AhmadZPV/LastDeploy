/**
 * Login identity. Prisma drops `undefined` keys from `where`, so
 * `{ Benutzername: undefined, active: 1 }` becomes `{ active: 1 }` and
 * matches the first active user. A POST /login with only a password would
 * then authenticate as that user (often the seeded admin).
 */

export function loginUsername(body = {}) {
  const raw = body.Benutzername ?? body.username;
  const name = String(raw ?? '').trim();
  return name || null;
}

export function loginWhere(body = {}) {
  const Benutzername = loginUsername(body);
  if (!Benutzername) return null;
  return { Benutzername, active: 1 };
}

export default { loginUsername, loginWhere };
