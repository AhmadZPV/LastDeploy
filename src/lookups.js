/**
 * Dependent lookups and suggestion queries.
 *
 * src/field-format.js reads the STATIC half of a lookup: which table it points
 * at, which column is the key and which one is shown. This module reads the
 * DYNAMIC half that scripts/extract-lookups.py pulled out of the same settings
 * files:
 *
 *   DependentLookups    68  the edit fields to reload when this one changes
 *   parentFilters       73  the field this one is narrowed BY
 *   dependentFilters    73  the fields this one narrows
 *   LookupUnique        60  the chosen value may not repeat
 *
 * covering 175 fields across 73 entities.
 *
 * Without this, a cascading dropdown such as Objekt -> Einheit -> Raum shows
 * every Einheit in the database instead of only those of the chosen Objekt,
 * which is exactly the bug the PHP app does not have.
 *
 * The module stays free of Prisma and express: it turns metadata into a plain
 * query description, and routes/ajax.js executes it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LINKS_FILE = path.join(HERE, 'meta', 'lookup-links.json');

export const DEFAULT_SUGGEST_LIMIT = 20;
export const MAX_SUGGEST_LIMIT = 100;

let cache = null;

/** Reads src/meta/lookup-links.json once, tolerating a BOM. */
export function loadLinks() {
  if (cache) return cache;
  let parsed = { counts: {}, entities: {} };
  try {
    let raw = fs.readFileSync(LINKS_FILE, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    parsed = JSON.parse(raw);
  } catch {
    parsed = { counts: {}, entities: {} };
  }
  if (!parsed.entities) parsed.entities = {};
  cache = parsed;
  return cache;
}

export function resetLookupCache() {
  cache = null;
}

/**
 * The settings files spell umlauts with an underscore
 * (Abrechnungsempf_nger_settings.php), while slugs and registry names may use
 * the real letter. Try the obvious spellings before giving up.
 */
export function resolveLinkEntity(name) {
  if (!name) return null;
  const entities = loadLinks().entities;
  if (entities[name]) return name;

  const candidates = [
    name.replace(/[^A-Za-z0-9]/g, '_'),
    name.replace(/\u00e4/g, 'a').replace(/\u00f6/g, 'o').replace(/\u00fc/g, 'u'),
  ];
  for (const candidate of candidates) {
    if (entities[candidate]) return candidate;
  }

  const lower = String(name).toLowerCase();
  for (const key of Object.keys(entities)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

/** Every wired field of an entity, keyed by field name. */
export function linksFor(entity) {
  const key = resolveLinkEntity(entity);
  if (!key) return {};
  return loadLinks().entities[key] || {};
}

/** The raw record for one field, or null. */
export function fieldLink(entity, field) {
  const links = linksFor(entity);
  return (field && links[field]) || null;
}

/**
 * The edit fields that must be reloaded when `field` changes. Both the
 * DependentLookups list and the dependentFilters list are honoured, because a
 * field can narrow a dropdown, a filter, or both.
 */
export function dependentsOf(entity, field) {
  const record = fieldLink(entity, field);
  if (!record) return [];
  const out = [];
  for (const list of [record.DependentLookups, record.dependentFilters]) {
    if (!Array.isArray(list)) continue;
    for (const name of list) {
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** The field this one is filtered by, or null when it stands alone. */
export function parentOf(entity, field) {
  const record = fieldLink(entity, field);
  if (!record) return null;
  if (record.parentFilterField) return record.parentFilterField;
  const list = record.parentFilters;
  return Array.isArray(list) && list.length ? list[0] : null;
}

/**
 * The full cascade a field sits in, from the outermost parent down to the
 * field itself, e.g. ['Objekt', 'Einheit', 'Raum'].
 * Self-referencing metadata cannot spin this into an endless loop.
 */
export function lookupChain(entity, field) {
  const chain = [field];
  const seen = new Set([field]);
  let current = field;
  for (let guard = 0; guard < 20; guard += 1) {
    const parent = parentOf(entity, current);
    if (!parent || seen.has(parent)) break;
    chain.unshift(parent);
    seen.add(parent);
    current = parent;
  }
  return chain;
}

/** True when the source marked the lookup value as unique. */
export function isLookupUnique(entity, field) {
  const record = fieldLink(entity, field);
  return Boolean(record && record.LookupUnique === true);
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SUGGEST_LIMIT;
  return Math.min(Math.floor(n), MAX_SUGGEST_LIMIT);
}

/**
 * Describes the query behind a lookup dropdown or an autocomplete box.
 *
 * The static half comes from the field metadata (src/field-format.js reads the
 * same keys), the dynamic half from the parent value the form already holds.
 *
 * @param {object} args
 * @param {object} args.meta        entity manifest, for LookupTable and friends
 * @param {string} args.entity      entity name used to look up the wiring
 * @param {string} args.field       the field being filled
 * @param {*} [args.parentValue]    the value chosen in the parent dropdown
 * @param {string} [args.term]      what the user typed, for autocomplete
 * @param {number} [args.limit]
 * @returns {object|null} null when the field is not a lookup at all
 */
export function buildLookupQuery({ meta, entity, field, parentValue, term, limit } = {}) {
  const spec = lookupSpecFrom(meta, field);
  if (!spec) return null;

  const parentField = parentOf(entity, field);
  const filters = [];

  // The source keeps LookupWhere as raw SQL. It is carried through untouched
  // so the caller can decide whether it is able to honour it, rather than
  // silently dropping a business rule.
  const rawWhere = spec.where || null;

  if (parentField && parentValue !== undefined && parentValue !== null && parentValue !== '') {
    filters.push({ field: parentField, equals: parentValue, source: 'parentFilter' });
  }

  const query = {
    table: spec.table,
    linkField: spec.linkField,
    displayField: spec.displayField,
    control: spec.control,
    orderBy: spec.orderBy || spec.displayField,
    rawWhere,
    filters,
    take: clampLimit(limit),
    parentField: parentField || null,
    unique: isLookupUnique(entity, field),
  };

  if (term != null && String(term).trim() !== '') {
    query.search = { field: spec.displayField, contains: String(term).trim() };
  }

  return query;
}

/**
 * Reads the static lookup keys straight off the manifest. Kept local so this
 * module does not depend on src/field-format.js, which keeps both testable in
 * isolation.
 */
function lookupSpecFrom(meta, name) {
  const fields = meta && Array.isArray(meta.fields) ? meta.fields : [];
  const field = fields.find((f) => f && f.name === name);
  const edit = (field && field.edit) || {};
  if (!edit.LookupTable) return null;
  const type = edit.LookupType || edit.LCType || null;
  const controls = { 1: 'text', 2: 'dropdown', 3: 'ajax', 4: 'radio', 5: 'checkbox' };
  return {
    table: edit.LookupTable,
    linkField: edit.LinkField || 'ID',
    displayField: edit.DisplayField || edit.LinkField || 'ID',
    where: edit.LookupWhere || null,
    orderBy: edit.LookupOrderBy || null,
    control: controls[type] || 'dropdown',
  };
}

/**
 * Turns a query description into the `where` object a Prisma findMany takes.
 * rawWhere is intentionally NOT translated; the caller is told about it via
 * `unsupportedWhere` so it can log or fall back instead of pretending the
 * filter was applied.
 */
export function toPrismaArgs(query) {
  if (!query) return null;
  const where = {};
  for (const filter of query.filters || []) {
    where[filter.field] = filter.equals;
  }
  if (query.search) {
    where[query.search.field] = { contains: query.search.contains };
  }
  const args = {
    where,
    take: query.take,
    orderBy: query.orderBy ? { [query.orderBy]: 'asc' } : undefined,
  };
  if (query.rawWhere) args.unsupportedWhere = query.rawWhere;
  return args;
}

/** Shapes rows into the {value, label} pairs the front end consumes. */
export function toOptions(rows, query) {
  if (!Array.isArray(rows) || !query) return [];
  return rows.map((row) => {
    const value = row[query.linkField];
    const raw = row[query.displayField];
    const label = raw == null || raw === '' ? String(value == null ? '' : value) : String(raw);
    return { value, label };
  });
}

/** Coverage numbers, handy in tests and on an admin page. */
export function summary() {
  const data = loadLinks();
  const entities = data.entities || {};
  let dependents = 0;
  let parents = 0;
  let unique = 0;
  for (const fields of Object.values(entities)) {
    for (const record of Object.values(fields)) {
      if (Array.isArray(record.DependentLookups)) dependents += record.DependentLookups.length;
      if (record.parentFilterField) parents += 1;
      if (record.LookupUnique === true) unique += 1;
    }
  }
  return {
    entities: Object.keys(entities).length,
    fields: Object.values(entities).reduce((sum, f) => sum + Object.keys(f).length, 0),
    dependents,
    parents,
    unique,
    counts: data.counts || {},
  };
}

export default {
  loadLinks,
  resetLookupCache,
  resolveLinkEntity,
  linksFor,
  fieldLink,
  dependentsOf,
  parentOf,
  lookupChain,
  isLookupUnique,
  buildLookupQuery,
  toPrismaArgs,
  toOptions,
  summary,
};
