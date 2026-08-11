/**
 * Entity registry: the map from route slug to Prisma model every generic
 * router (crud, ajax, files, downloads, fulltext, master-detail) resolves
 * through.
 *
 * The authoritative source is prisma/schema.prisma itself: one registry entry
 * per model, keyed by the lowercased model name (the route slug). When the
 * generated manifests in src/entities/*.json exist (scripts/build-entities.js)
 * they enrich the entry with curated list/search columns and lookup wiring.
 *
 * Entry shape:
 *   {
 *     entity: 'Objekte',          // model name
 *     model: 'objekte',           // Prisma delegate key (first char lowercase)
 *     table: 'Objekte',           // physical table (@@map when present)
 *     fields: { ID: { type: 'Int' }, ... },
 *     multiTenant: true,          // model carries a Team column
 *     listColumns: [...], searchFields: [...], lookupFields: { FK: 'slug' }
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEntities } from './entities-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let _registry = null;

/** Prisma delegate key for a model name: first character lowercased. */
export function delegateName(model) {
  const s = String(model || '');
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * Minimal schema.prisma reader. Extracts per model: the physical table name
 * (@@map), the scalar fields with their Prisma type and physical column
 * (@map), and the relation fields (skipped for column work).
 */
export function parseSchema(schemaPath = path.join(root, 'prisma', 'schema.prisma')) {
  let text;
  try { text = fs.readFileSync(schemaPath, 'utf8'); } catch { return {}; }
  const models = {};
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(text))) {
    const [, name, body] = m;
    const fields = {};
    const relations = [];
    let table = name;
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    if (mapMatch) table = mapMatch[1];
    for (const line of body.split('\n')) {
      const f = line.match(/^\s*(\w+)\s+(\w+)(\?)?(\[\])?/);
      if (!f || f[1].startsWith('@@')) continue;
      const [, fname, ftype, optional, isList] = f;
      if (isList) continue;
      const colMap = line.match(/@map\("([^"]+)"\)/);
      const isRelation = /@relation\(/.test(line);
      if (isRelation) { relations.push(fname); continue; }
      const SCALARS = new Set(['Int', 'BigInt', 'Float', 'Decimal', 'String', 'DateTime', 'Boolean', 'Bytes', 'Json']);
      if (!SCALARS.has(ftype)) continue; // relation object field (no @relation tag on some)
      fields[fname] = {
        type: ftype,
        column: colMap ? colMap[1] : fname,
        optional: optional === '?',
      };
    }
    models[name] = { name, table, fields, relations };
  }
  return models;
}

/** Display-ish candidates for list/search fallbacks. */
const TEXT_FIRST = [
  'Bezeichnung', 'Kurzname', 'Titel', 'Name', 'Betreff', 'Bemerkungen',
  'Vorname', 'Nachname', 'Firma', 'Ort', 'Strasse', 'Nummer',
];

function buildRegistry() {
  const models = parseSchema();
  const curated = loadEntities(); // src/entities/*.json when present
  const byModelLower = new Map(
    Object.values(models).map((mm) => [mm.name.toLowerCase(), mm]));

  const reg = {};
  for (const model of Object.values(models)) {
    const slug = model.name.toLowerCase();
    const entry = {
      entity: model.name,
      model: delegateName(model.name),
      table: model.table,
      fields: model.fields,
      multiTenant: Object.prototype.hasOwnProperty.call(model.fields, 'Team'),
      listColumns: [],
      searchFields: [],
      lookupFields: {},
    };
    // curated manifest (src/entities/<Entity>.json) wins where present
    const curatedMeta = curated[model.name] || curated[slug];
    if (curatedMeta) {
      if (Array.isArray(curatedMeta.listColumns)) entry.listColumns = curatedMeta.listColumns;
      if (Array.isArray(curatedMeta.searchFields)) entry.searchFields = curatedMeta.searchFields;
      if (curatedMeta.lookupFields && typeof curatedMeta.lookupFields === 'object') {
        entry.lookupFields = curatedMeta.lookupFields;
      }
      if (curatedMeta.title) entry.title = curatedMeta.title;
    }
    if (!entry.listColumns.length) {
      const preferred = TEXT_FIRST.filter((f) => model.fields[f]);
      const more = Object.keys(model.fields).filter(
        (f) => !preferred.includes(f) && model.fields[f].type === 'String');
      entry.listColumns = [...preferred, ...more].filter((f) => f !== 'Team').slice(0, 6);
    }
    if (!entry.searchFields.length) {
      entry.searchFields = Object.keys(model.fields)
        .filter((f) => model.fields[f].type === 'String' && f !== 'Team')
        .slice(0, 8);
    }
    reg[slug] = entry;
  }

  // Lookup wiring from the extracted catalogue (src/meta/lookup-links.json):
  // entity -> field -> LookupTable. Values are resolved to registry slugs so
  // `registry[targetName]` works directly in the ajax/crud routers.
  try {
    const links = JSON.parse(
      fs.readFileSync(path.join(root, 'src', 'meta', 'lookup-links.json'), 'utf8'));
    const resolveSlug = (table) => {
      const want = String(table || '').toLowerCase();
      if (reg[want]) return want;
      const hit = Object.values(reg).find(
        (e) => e.table.toLowerCase() === want || e.entity.toLowerCase() === want);
      return hit ? hit.entity.toLowerCase() : null;
    };
    for (const [entity, fields] of Object.entries(links.entities || {})) {
      const slug = resolveSlug(entity);
      if (!slug) continue;
      for (const [field, spec] of Object.entries(fields || {})) {
        const target = spec && spec.LookupTable ? resolveSlug(spec.LookupTable) : null;
        if (target) reg[slug].lookupFields[field] = target;
      }
    }
  } catch { /* lookup-links.json is optional for the registry */ }

  // keep the map lookup alive for type narrowing below
  void byModelLower;
  return reg;
}

/** The slug -> entry map every router resolves through. */
export const registry = new Proxy({}, {
  get(_t, prop) {
    if (!_registry) _registry = buildRegistry();
    return _registry[prop];
  },
  has(_t, prop) {
    if (!_registry) _registry = buildRegistry();
    return prop in _registry;
  },
  ownKeys() {
    if (!_registry) _registry = buildRegistry();
    return Object.keys(_registry);
  },
  getOwnPropertyDescriptor(_t, prop) {
    if (!_registry) _registry = buildRegistry();
    if (prop in _registry) return { enumerable: true, configurable: true, value: _registry[prop] };
    return undefined;
  },
});

/** All registry slugs (route names), in schema order. */
export function moduleNames() {
  if (!_registry) _registry = buildRegistry();
  return Object.keys(_registry);
}

/** Re-read the schema (tests and tooling). */
export function resetRegistry() {
  _registry = null;
}

export default { registry, moduleNames, delegateName, parseSchema, resetRegistry };
