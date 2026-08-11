/**
 * Phase 1 - event runtime.
 *
 * The original app keeps its real business logic in 91 include/*_events.php
 * files (134 hooks). scripts/extract-events.py catalogues them and
 * scripts/compile-events.py turns the recognised statements into declarative
 * ops. This module executes those ops at the matching CRUD lifecycle points.
 *
 * Hooks whose bodies could not be compiled are recorded with status
 * "manual" / "partial" and are reported by `pendingHooks()` so the port has an
 * explicit, countable backlog instead of silent gaps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

let _ops = null;
function ops() {
  if (!_ops) _ops = readJson(path.join(root, 'src', 'meta', 'event-ops.json'), { summary: {}, entities: {} });
  return _ops;
}

/** Case-insensitive entity lookup, routes use lowercase slugs. */
function entityOps(entity) {
  const all = ops().entities || {};
  if (all[entity]) return all[entity];
  const want = String(entity || '').toLowerCase();
  const key = Object.keys(all).find((k) => k.toLowerCase() === want);
  return key ? all[key] : null;
}

export function hasHook(entity, hook) {
  const e = entityOps(entity);
  return !!(e && e[hook] && e[hook].ops && e[hook].ops.length);
}

/** Every hook that still needs a hand-written implementation. */
export function pendingHooks() {
  const out = [];
  for (const [entity, hooks] of Object.entries(ops().entities || {})) {
    for (const [hook, def] of Object.entries(hooks)) {
      if (def.status === 'manual' || def.status === 'partial') {
        out.push({ entity, hook, status: def.status, lines: def.lines, statements: def.statements });
      }
    }
  }
  return out.sort((a, b) => b.lines - a.lines);
}

export function summary() {
  return { ...(ops().summary || {}), pending: pendingHooks().length };
}

async function nextNumber(ctx, op) {
  const { prisma, session } = ctx;
  const table = String(op.table).replace(/[^A-Za-z0-9_]/g, '');
  const col = String(op.column).replace(/[^A-Za-z0-9_]/g, '');
  let sql = `SELECT MAX("${col}") AS mx FROM "${table}"`;
  const params = [];
  if (op.scopeTeam && session?.Team) {
    sql += ' WHERE "Team" = ?';
    params.push(session.Team);
  }
  try {
    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    const mx = rows?.[0]?.mx;
    return (mx == null ? 0 : Number(mx)) + 1;
  } catch {
    return null;
  }
}

/**
 * Run one hook.
 * @param entity  entity slug or PHP table name
 * @param hook    e.g. "BeforeAdd", "BeforeInsert", "BeforeEdit"
 * @param ctx     { values, rawValues, session, prisma }
 * @returns { applied: string[], skipped: string[], message: string|null }
 */
export async function runHook(entity, hook, ctx) {
  const e = entityOps(entity);
  const def = e && e[hook];
  const result = { applied: [], skipped: [], message: null, status: def?.status || 'none' };
  if (!def || !Array.isArray(def.ops) || !def.ops.length) return result;

  const values = ctx.values || {};
  const raw = ctx.rawValues || values;
  const session = ctx.session || {};

  for (const op of def.ops) {
    try {
      switch (op.op) {
        case 'sessionCopy': {
          const v = session[op.sessionKey];
          if (v !== undefined) { values[op.field] = v; result.applied.push(op.field); }
          else result.skipped.push(op.field);
          break;
        }
        case 'now':
          values[op.field] = new Date();
          result.applied.push(op.field);
          break;
        case 'constant':
          values[op.field] = op.value;
          result.applied.push(op.field);
          break;
        case 'copyField':
          values[op.field] = raw[op.from];
          result.applied.push(op.field);
          break;
        case 'nextNumber': {
          const n = await nextNumber({ ...ctx, session }, op);
          if (n != null) { values[op.field] = n; result.applied.push(op.field); }
          else result.skipped.push(op.field);
          break;
        }
        default:
          result.skipped.push(op.field || op.op);
      }
    } catch {
      result.skipped.push(op.field || op.op);
    }
  }
  ctx.values = values;
  return result;
}

export default { runHook, hasHook, pendingHooks, summary };
