// Offline stub for bcryptjs. Not cryptographically real: it produces a
// deterministic, clearly-marked hash so tests can assert "not stored plain"
// and round-trip compare() without any native dependency.
const PREFIX = '$2a$10$stub$';

function digest(s) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function hashSync(plain) { return PREFIX + digest(String(plain)); }
export async function hash(plain) { return hashSync(plain); }
export function compareSync(plain, stored) {
  return String(stored) === hashSync(plain);
}
export async function compare(plain, stored) { return compareSync(plain, stored); }
export function genSaltSync() { return 'stub'; }

export default { hash, hashSync, compare, compareSync, genSaltSync };
