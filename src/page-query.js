/**
 * Page row fetching.
 *
 * Every metadata-driven page (export, print, report) asks the same question:
 * "give me the rows of entity X with the columns its field set declares, in
 * the order its settings declare". This module answers it against Prisma,
 * mapping physical columns (@map) to model fields so umlaut columns like
 * `Zubehör` never leak into a query as identifiers.
 */
import { loadMeta, pageFields, resolveEntityName } from './meta-store.js';
import { parseSchema, delegateName } from './registry.js';

let _schema = null;
function schema() {
  if (!_schema) _schema = parseSchema();
  return _schema;
}

/** Model entry for an entity/base-table spelling, or null. */
function modelFor(entity) {
  const want = String(entity || '').toLowerCase();
  for (const model of Object.values(schema())) {
    if (model.name.toLowerCase() === want || model.table.toLowerCase() === want) {
      return model;
    }
  }
  return null;
}

/**
 * Physical column (or model field) -> Prisma field name, or null when the
 * column does not exist. Matching is exact first, case-insensitive second.
 */
export function columnToField(entity, column) {
  const model = modelFor(entity) || modelFor(resolveEntityName(entity));
  if (!model || column == null) return null;
  const col = String(column);
  for (const [name, def] of Object.entries(model.fields)) {
    if (name === col || def.column === col) return name;
  }
  const lower = col.toLowerCase();
  for (const [name, def] of Object.entries(model.fields)) {
    if (name.toLowerCase() === lower || def.column.toLowerCase() === lower) return name;
  }
  return null;
}

/** "Kurzname ASC, ID DESC" -> [{ Kurzname: 'asc' }, { ID: 'desc' }]. */
export function orderByFromSql(entity, strOrderBy) {
  const out = [];
  for (const part of String(strOrderBy || '').split(',')) {
    const m = part.trim().match(/^[`"\[]?([\w\u00c0-\u00ff ]+?)[`"\]]?\s*(ASC|DESC)?$/i);
    if (!m) continue;
    const field = columnToField(entity, m[1].trim());
    if (!field) continue;
    out.push({ [field]: (m[2] || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc' });
  }
  return out;
}

/**
 * Fetch the rows of one page kind.
 *
 * @param entity  entity slug or name
 * @param kind    'export' | 'print' | 'list' | ... (field set key)
 * @param where   team scope / caller filters (Prisma where fragment)
 * @param keys    optional selected record keys (strings, ?keys=1,2,3)
 * @param take    row cap; null/undefined means "no limit"
 * @returns {Promise<{columns: Array<{meta, prismaField}>, rows: Array}>}
 */
export async function fetchPageRows({ entity, kind = 'export', prisma, where = {}, keys = null, take = null } = {}) {
  const meta = loadMeta(entity);
  if (!meta) return { columns: [], rows: [] };

  const base = meta.baseTable || meta.entity;
  const model = modelFor(base);
  const delegate = model ? prisma?.[delegateName(model.name)] : null;
  if (!delegate) return { columns: [], rows: [] };

  const fields = pageFields(meta, kind);
  const columns = fields.map((f) => ({
    meta: f,
    prismaField: columnToField(base, f.name) || f.name,
  }));

  const finalWhere = { ...(where || {}) };
  if (keys && keys.length) {
    const keyCols = (meta.keys && meta.keys.length ? meta.keys : ['ID']);
    const ands = keyCols.map((kc, i) => {
      const field = columnToField(base, kc) || kc;
      const values = keys.map((k) => (/^-?\d+$/.test(String(k)) ? Number(k) : String(k)));
      return { [field]: values.length === 1 ? values[0] : { in: values } };
    });
    if (ands.length) finalWhere.AND = [...(finalWhere.AND || []), ...ands];
  }

  const orderBy = orderByFromSql(base, meta.sql && meta.sql.strOrderBy);
  const args = { where: finalWhere };
  if (orderBy.length) args.orderBy = orderBy;
  if (Number.isFinite(take) && take > 0) args.take = take;

  const rows = await delegate.findMany(args);
  return { columns, rows: rows || [] };
}

export function resetPageQueryCache() {
  _schema = null;
}

export default { columnToField, fetchPageRows, orderByFromSql, resetPageQueryCache };
