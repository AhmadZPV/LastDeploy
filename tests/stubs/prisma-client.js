/**
 * In-memory @prisma/client stub for the offline test runner.
 *
 * Implements the slice of the Prisma surface the routes under test use:
 * findMany/findFirst/create/update/delete with a small where/select/orderBy
 * dialect, plus $queryRawUnsafe bound-parameter matching against the seeded
 * rows. It is deliberately NOT a Prisma emulator — the goal is that every
 * handler gets plausible data and every team-scope where-clause lands on a
 * shaped delegate, so routing/authorization logic is exercised for real.
 */

function matchWhere(row, where) {
  if (!where || typeof where !== 'object') return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!(Array.isArray(cond) ? cond : [cond]).some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === 'NOT') {
      if (matchWhere(row, cond)) return false;
      continue;
    }
    const val = row[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ('in' in cond) { if (!cond.in.includes(val)) return false; continue; }
      if ('contains' in cond) {
        if (!String(val ?? '').toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
        continue;
      }
      if ('gte' in cond && !(val >= cond.gte)) return false;
      if ('lte' in cond && !(val <= cond.lte)) return false;
      if ('gt' in cond && !(val > cond.gt)) return false;
      if ('lt' in cond && !(val < cond.lt)) return false;
      if ('equals' in cond) { if (val !== cond.equals) return false; continue; }
      if ('not' in cond) { if (val === cond.not) return false; continue; }
      continue;
    }
    if (val instanceof Date || cond instanceof Date) {
      const a = val instanceof Date ? val.getTime() : new Date(val).getTime();
      const b = cond instanceof Date ? cond.getTime() : new Date(cond).getTime();
      if (a !== b) return false;
      continue;
    }
    if (val !== cond) return false;
  }
  return true;
}

function applyOrder(rows, orderBy) {
  if (!orderBy) return rows;
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const o of list) {
      const [field, dir] = Object.entries(o)[0];
      const av = a[field];
      const bv = b[field];
      if (av === bv) continue;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

function applySelect(row, select) {
  if (!select) return row;
  const out = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = row[key];
  }
  return out;
}

function makeDelegate(store, name) {
  const rows = () => (store[name] = store[name] || []);
  return {
    async findMany({ where, orderBy, take, skip, select } = {}) {
      let out = rows().filter((r) => matchWhere(r, where));
      out = applyOrder(out, orderBy);
      if (skip) out = out.slice(skip);
      if (Number.isFinite(take) && take >= 0) out = out.slice(0, take);
      return out.map((r) => applySelect(r, select));
    },
    async findFirst({ where, orderBy, select } = {}) {
      let out = rows().filter((r) => matchWhere(r, where));
      out = applyOrder(out, orderBy);
      const hit = out[0] || null;
      return hit ? applySelect(hit, select) : null;
    },
    async findUnique({ where, select } = {}) {
      const hit = rows().find((r) => matchWhere(r, where)) || null;
      return hit ? applySelect(hit, select) : null;
    },
    async create({ data } = {}) {
      const row = { ...data };
      if (row.ID === undefined) {
        const max = rows().reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0);
        row.ID = max + 1;
      }
      rows().push(row);
      return row;
    },
    async update({ where, data } = {}) {
      const row = rows().find((r) => matchWhere(r, where));
      if (!row) throw new Error('Record not found');
      Object.assign(row, data);
      return row;
    },
    async updateMany({ where, data } = {}) {
      const hits = rows().filter((r) => matchWhere(r, where));
      hits.forEach((r) => Object.assign(r, data));
      return { count: hits.length };
    },
    async delete({ where } = {}) {
      const list = rows();
      const idx = list.findIndex((r) => matchWhere(r, where));
      if (idx === -1) throw new Error('Record not found');
      return list.splice(idx, 1)[0];
    },
    async deleteMany({ where } = {}) {
      const list = rows();
      const keep = list.filter((r) => !matchWhere(r, where));
      const count = list.length - keep.length;
      store[name] = keep;
      return { count };
    },
    async count({ where } = {}) {
      return rows().filter((r) => matchWhere(r, where)).length;
    },
  };
}

/** A delegate map covering every model name the callers may use. */
export function mkClient(seed = {}) {
  const store = { ...seed };
  const cache = new Map();
  const client = new Proxy({}, {
    get(_t, prop) {
      if (prop === '$queryRawUnsafe') {
        return async (sql, ...binds) => rawQuery(store, String(sql), binds);
      }
      if (prop === '$executeRawUnsafe') {
        return async (sql) => {
          const m = /(?:insert\s+into|INSERT\s+INTO)\s+`?([\w ]+?)`?\s*\(/i.exec(String(sql));
          if (m) {
            const table = m[1].trim();
            store[table] = store[table] || [];
            store[table].push({ ID: store[table].length + 1 });
            return 1;
          }
          return 0;
        };
      }
      if (prop === '$transaction') {
        return async (ops) => (typeof ops === 'function' ? ops(client) : Promise.all(ops));
      }
      if (typeof prop !== 'string') return undefined;
      if (!cache.has(prop)) cache.set(prop, makeDelegate(store, prop));
      return cache.get(prop);
    },
  });
  client.__store = store;
  return client;
}

/** Tiny raw-SQL evaluator for the chart/handler tests. */
function rawQuery(store, sql, binds) {
  // SELECT ... FROM `Table` [WHERE ...] [GROUP BY x] [ORDER BY ...]
  const from = /\bfrom\s+`?([\w ]+?)`?\s*(?:\bwhere\b|\bgroup\b|\border\b|$)/i.exec(sql);
  if (!from) return [];
  const table = from[1].trim();
  const rows = store[table] || store[table.replace(/ /g, '_')] || [];

  let filtered = rows;
  const whereM = /\bwhere\b(.*?)(?:\bgroup\s+by\b|\border\s+by\b|$)/is.exec(sql);
  if (whereM) {
    let clause = whereM[1];
    // bind ? placeholders sequentially
    let bi = 0;
    clause = clause.replace(/\?/g, () => {
      const v = binds[bi++];
      return typeof v === 'number' ? String(v) : `'${String(v ?? '')}'`;
    });
    // Team = 'x' style filters only; anything fancier passes everything.
    const m = /^\s*`?(\w+)`?\s*=\s*'([^']*)'\s*$/s.exec(clause);
    if (m) filtered = filtered.filter((r) => String(r[m[1]]) === m[2]);
  }

  const groupM = /\bgroup\s+by\s+`?([\w]+)`?/i.exec(sql);
  if (groupM) {
    const g = groupM[1];
    const sumM = /sum\(\s*`?(\w+)`?\s*\)\s*(?:as\s+`?(\w+)`?)?/i.exec(sql);
    const buckets = new Map();
    for (const r of filtered) {
      const key = r[g];
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
    return [...buckets.entries()].map(([key, bucket]) => {
      const out = { [g]: key };
      if (sumM) out[sumM[2] || 'value'] = bucket.reduce((a, r) => a + (Number(r[sumM[1]]) || 0), 0);
      return out;
    });
  }
  return filtered;
}

/**
 * Class-style entry point. The real @prisma/client exports `PrismaClient`,
 * and several scripts import it by name, so the stub must provide it too.
 * Constructing it returns the same proxy-backed client mkClient() builds,
 * plus no-op lifecycle helpers ($connect/$disconnect/$on/$use).
 */
export class PrismaClient {
  constructor(options = {}) {
    const seed = (options && options.__seed) || {};
    const client = mkClient(seed);
    return new Proxy(client, {
      get(target, prop) {
        if (prop === '$connect' || prop === '$disconnect') return async () => {};
        if (prop === '$on' || prop === '$use') return () => {};
        return target[prop];
      },
    });
  }
}

/** Minimal `Prisma` namespace for code that touches error types or raw sql. */
export const Prisma = {
  PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
    constructor(message, meta = {}) {
      super(message);
      this.name = 'PrismaClientKnownRequestError';
      Object.assign(this, meta);
    }
  },
  PrismaClientValidationError: class PrismaClientValidationError extends Error {},
  sql: (strings, ...values) => ({ strings, values }),
  raw: (value) => value,
  join: (values) => values,
};

export default { mkClient, PrismaClient, Prisma };
