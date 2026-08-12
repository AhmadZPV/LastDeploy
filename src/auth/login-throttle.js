/**
 * In-memory login throttle. Five failed attempts per username+IP inside a
 * 15-minute window lock further tries. Success clears the bucket.
 *
 * This is process-local (fine for a single Node instance / Docker replica).
 * It does not replace a reverse-proxy rate limit, but it stops the obvious
 * password-spray against /login without a new dependency.
 */

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;

const hits = new Map();

function bucketKey(username, ip) {
  return `${String(username || '').trim().toLowerCase()}|${String(ip || '')}`;
}

export function loginAllowed(username, ip, now = Date.now()) {
  const key = bucketKey(username, ip);
  const row = hits.get(key);
  if (!row) return true;
  if (now - row.start > LOGIN_WINDOW_MS) {
    hits.delete(key);
    return true;
  }
  return row.count < LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(username, ip, now = Date.now()) {
  const key = bucketKey(username, ip);
  const row = hits.get(key);
  if (!row || now - row.start > LOGIN_WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    return;
  }
  row.count += 1;
}

export function recordLoginSuccess(username, ip) {
  hits.delete(bucketKey(username, ip));
}

export function resetLoginThrottle() {
  hits.clear();
}

export default {
  LOGIN_WINDOW_MS, LOGIN_MAX_FAILURES,
  loginAllowed, recordLoginFailure, recordLoginSuccess, resetLoginThrottle,
};
