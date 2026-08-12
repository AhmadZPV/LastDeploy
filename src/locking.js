/**
 * Phase 10 - record locking (port of PHPRunner's edit locking).
 *
 * Locks live in the physical table `intex hausverwaltung_locking`
 * (schema model `intex_hausverwaltung_locking`):
 *   id | table | startdatetime | confirmdatetime | keys | sessionid | userid | action
 *
 * Semantics, mirroring the source:
 *   - Opening an edit page acquires the lock for (table, keys).
 *   - The same session re-entering just heartbeats (confirmdatetime = now).
 *   - Another session gets { locked: true, own: false, by: <user> }.
 *   - A lock without a heartbeat for LOCK_TTL_MINUTES is stale: it is
 *     deleted on touch and the record becomes lockable again.
 *   - Saving or cancelling releases the lock.
 *
 * All operations fail open (a locking error never blocks editing), matching
 * the PHP pages that kept working when the locking table was unreachable.
 */

const DELEGATES = ['intex_hausverwaltung_locking', 'intexHausverwaltungLocking'];

/** PHPRunner's default heartbeat timeout: 10 minutes. */
export const LOCK_TTL_MINUTES = 10;

function delegateOf(prisma) {
  for (const name of DELEGATES) {
    if (prisma && prisma[name]) return prisma[name];
  }
  return null;
}

/** { ID: 7 } -> "ID=7" — the stored keys format of the source. */
export function lockKeys(keys) {
  if (keys == null) return '';
  if (typeof keys !== 'object') return String(keys);
  return Object.entries(keys).map(([k, v]) => `${k}=${v}`).join('&');
}

/** Prisma SQLite DateTime columns must be ISO-8601, not Date.getTime(). */
export function lockTimestamp(value = new Date()) {
  const d = value instanceof Date ? value : new Date(typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function parseLockTime(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number' || /^\d+$/.test(String(value || ''))) return new Date(Number(value));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Try to lock a record.
 *
 * @returns {Promise<{own:true, lockId?, refreshed?} | {locked:true, own:false, by:string, since:any}>}
 */
export async function acquireLock({ prisma, table, keys, sessionId, userId } = {}) {
  const delegate = delegateOf(prisma);
  if (!delegate) return { own: true, lockId: null };
  const ks = lockKeys(keys);
  const now = new Date();
  const stamp = lockTimestamp(now);
  const cutoff = new Date(now.getTime() - LOCK_TTL_MINUTES * 60000);
  try {
    // Stale rows are deleted on touch, then the record is free.
    await delegate.deleteMany({
      where: { table: String(table), keys: ks, confirmdatetime: { lt: cutoff } },
    });
    const existing = await delegate.findFirst({ where: { table: String(table), keys: ks } });
    if (existing && String(existing.sessionid) !== String(sessionId)) {
      return {
        locked: true,
        own: false,
        by: String(existing.userid ?? ''),
        since: existing.startdatetime || null,
      };
    }
    if (existing) {
      await delegate.update({ where: { id: existing.id }, data: { confirmdatetime: stamp } });
      return { own: true, refreshed: true, lockId: existing.id };
    }
    const row = await delegate.create({
      data: {
        table: String(table),
        keys: ks,
        sessionid: String(sessionId ?? ''),
        userid: String(userId ?? ''),
        startdatetime: stamp,
        confirmdatetime: stamp,
        action: 0,
      },
    });
    return { own: true, locked: false, lockId: row.id ?? null };
  } catch (e) {
    console.warn('locking: acquire failed for', table, ks, '-', e.message);
    return { own: true, lockId: null };
  }
}

/** Release the caller's lock on a record (save / cancel). */
export async function releaseLock({ prisma, table, keys, sessionId } = {}) {
  const delegate = delegateOf(prisma);
  if (!delegate) return { released: false };
  try {
    const where = { table: String(table), keys: lockKeys(keys) };
    if (sessionId !== undefined) where.sessionid = String(sessionId);
    const res = await delegate.deleteMany({ where });
    return { released: true, count: res?.count ?? 0 };
  } catch (e) {
    console.warn('locking: release failed -', e.message);
    return { released: false };
  }
}

/** Current live lock for a record, or null. Stale rows count as unlocked. */
export async function checkLock({ prisma, table, keys } = {}) {
  const delegate = delegateOf(prisma);
  if (!delegate) return null;
  try {
    const row = await delegate.findFirst({ where: { table: String(table), keys: lockKeys(keys) } });
    if (!row) return null;
    const stamp = parseLockTime(row.confirmdatetime || row.startdatetime);
    if (!stamp || Date.now() - stamp.getTime() >= LOCK_TTL_MINUTES * 60000) {
      return null;
    }
    return { locked: true, by: String(row.userid ?? ''), sessionId: row.sessionid, since: row.startdatetime };
  } catch {
    return null;
  }
}

export default { acquireLock, releaseLock, checkLock, lockKeys, lockTimestamp, LOCK_TTL_MINUTES };
