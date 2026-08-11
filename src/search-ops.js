/**
 * Exact search operators, driven by the source settings.
 *
 * Every searchable field in include/<Entity>_settings.php declares its own
 * operator list and its default operator:
 *
 *   $fdata["defaultSearchOption"] = "Contains";   // or "Equals"
 *   $fdata["searchOptionsList"]  = array("Contains", "Equals", "Starts with",
 *       "More than", "Less than", "Between", "Empty", NOT_EMPTY);
 *
 * scripts/extract-search-options.py pulls that into src/meta/search-options.json
 * (131 entities, 2,028 fields, defaults Contains x1339 / Equals x689).
 *
 * This module turns a requested operator into a Prisma where fragment with
 * the same semantics as classes/searchclause.php. It never guesses which
 * operators a field allows — it reads the declaration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFileName } from './dashboards.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPTIONS_FILE = path.join(HERE, 'meta', 'search-options.json');

/** The eight operators the source knows, in the order the UI shows them. */
export const SEARCH_OPERATORS = [
  'Contains',
  'Equals',
  'Starts with',
  'More than',
  'Less than',
  'Between',
  'Empty',
  'NOT Empty',
];

const STRING_LIKE = new Set(['Contains', 'Starts with']);
const RANGE_LIKE = new Set(['More than', 'Less than', 'Between', 'Equals']);
const NUMERIC_TYPES = new Set(['Int', 'BigInt', 'Float', 'Decimal']);
const DATE_TYPES = new Set(['DateTime', 'Date']);

/** Fallbacks for fields the settings file does not cover. */
export const FALLBACK_STRING = { options: SEARCH_OPERATORS, default: 'Contains' };
export const FALLBACK_NUMERIC = {
  options: ['Equals', 'More than', 'Less than', 'Between', 'Empty', 'NOT Empty'],
  default: 'Equals',
};

let cache = null;

/** Reads src/meta/search-options.json once, tolerating a BOM. */
export function loadSearchOptions() {
  if (cache) return cache;
  let parsed = { counts: {}, entities: {} };
  try {
    let raw = fs.readFileSync(OPTIONS_FILE, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    parsed = JSON.parse(raw);
  } catch {
    parsed = { counts: {}, entities: {} };
  }
  if (!parsed.entities) parsed.entities = {};
  cache = parsed;
  return cache;
}

export function resetSearchOptionsCache() {
  cache = null;
}

/** Entity names appear both as file spellings and display spellings. */
export function resolveOptionsEntity(name) {
  if (!name) return null;
  const entities = loadSearchOptions().entities;
  if (entities[name]) return name;
  const fileSpelling = normalizeFileName(name);
  if (entities[fileSpelling]) return fileSpelling;
  const lower = String(name).toLowerCase();
  for (const key of Object.keys(entities)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

/**
 * The operators a field allows and its default, exactly as declared.
 * Unknown fields fall back by type: strings search with Contains,
 * numbers and dates with Equals.
 */
export function fieldSearchSpec(entity, field, typeHint) {
  const key = resolveOptionsEntity(entity);
  const record = key ? (loadSearchOptions().entities[key] || {})[field] : null;
  if (record && Array.isArray(record.options) && record.options.length) {
    return {
      options: record.options,
      default: record.default || record.options[0],
      declared: true,
    };
  }
  const numeric = NUMERIC_TYPES.has(typeHint) || DATE_TYPES.has(typeHint);
  const fallback = numeric ? FALLBACK_NUMERIC : FALLBACK_STRING;
  return { options: fallback.options, default: fallback.default, declared: false };
}

/** Coerces a raw request value to the field's type; null means unusable. */
export function coerceValue(value, type) {
  if (value == null || value === '') return null;
  if (NUMERIC_TYPES.has(type)) {
    const n = Number(String(value).replace(',', '.'));
    return Number.isNaN(n) ? null : (type === 'Int' || type === 'BigInt' ? Math.trunc(n) : n);
  }
  if (DATE_TYPES.has(type)) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (type === 'Boolean') {
    return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
  }
  return String(value);
}

/**
 * One clause -> one Prisma where fragment, or null when the clause is
 * unusable (empty value, failed coercion, unknown operator).
 *
 * @param {object} clause { field, option, value, value2, type }
 */
export function clauseToWhere({ field, option, value, value2, type } = {}) {
  if (!field || !option) return null;

  if (option === 'Empty') {
    return { OR: [{ [field]: null }, { [field]: '' }] };
  }
  if (option === 'NOT Empty') {
    return { AND: [{ [field]: { not: null } }, { [field]: { not: '' } }] };
  }

  if (STRING_LIKE.has(option)) {
    if (value == null || value === '') return null;
    const text = String(value);
    return option === 'Contains'
      ? { [field]: { contains: text } }
      : { [field]: { startsWith: text } };
  }

  if (RANGE_LIKE.has(option)) {
    if (option === 'Between') {
      const from = coerceValue(value, type);
      const to = coerceValue(value2, type);
      if (from == null && to == null) return null;
      const cond = {};
      if (from != null) cond.gte = from;
      if (to != null) cond.lte = to;
      return { [field]: cond };
    }
    const v = coerceValue(value, type);
    if (v == null) return null;
    if (option === 'Equals') return { [field]: v };
    return { [field]: { [option === 'More than' ? 'gt' : 'lt']: v } };
  }

  return null;
}

/**
 * Merges clause fragments with AND semantics. Conditions on the same field
 * must both hold, so collisions land in an explicit AND array instead of
 * silently overwriting each other.
 */
export function buildSearchWhere(clauses) {
  const flat = {};
  const ands = [];
  for (const clause of clauses || []) {
    const fragment = clauseToWhere(clause);
    if (!fragment) continue;
    const keys = Object.keys(fragment);
    if (keys.length === 1 && !['OR', 'AND', 'NOT'].includes(keys[0])) {
      const field = keys[0];
      if (flat[field] === undefined) flat[field] = fragment[field];
      else ands.push(fragment);
    } else {
      ands.push(fragment);
    }
  }
  const where = { ...flat };
  if (ands.length) where.AND = ands;
  return where;
}

/**
 * Turns the posted advanced-search state into validated clauses. A filter
 * entry may be a scalar (the field's default operator is used) or
 * { option, value, value2 }. Operators the field does not allow fall back to
 * the declared default instead of silently running.
 *
 * @param {object} filters  e.g. { Bezeichnung: { option: 'Equals', value: 'x' } }
 * @param {string} entity
 * @param {function} [typeOf]  field -> prisma type name, for coercion hints
 */
export function parseSearchRequest(filters, entity, typeOf = () => undefined) {
  const clauses = [];
  for (const [field, raw] of Object.entries(filters || {})) {
    if (raw == null || raw === '') continue;
    const spec = fieldSearchSpec(entity, field, typeOf(field));
    let option;
    let value;
    let value2;
    if (typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
      option = raw.option || raw.operator || raw.soption || spec.default;
      value = raw.value;
      value2 = raw.value2;
    } else {
      option = spec.default;
      value = raw;
    }
    if (!spec.options.includes(option)) option = spec.default;
    if ((value == null || value === '') && option !== 'Empty' && option !== 'NOT Empty') continue;
    clauses.push({ field, option, value, value2, type: typeOf(field) });
  }
  return clauses;
}

export default {
  SEARCH_OPERATORS,
  FALLBACK_STRING,
  FALLBACK_NUMERIC,
  loadSearchOptions,
  resetSearchOptionsCache,
  resolveOptionsEntity,
  fieldSearchSpec,
  coerceValue,
  clauseToWhere,
  buildSearchWhere,
  parseSearchRequest,
};
