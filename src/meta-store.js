/**
 * Entity metadata store.
 *
 * scripts/extract-metadata.py writes one manifest per include/*_settings.php
 * file into src/meta/entities/<Entity>.json (172 manifests). This module is
 * the single read path for that set: every page kind (list/view/add/edit/
 * search/export/print) resolves its fields, labels, keys and SQL fragments
 * through here.
 *
 * The store degrades quietly: with no manifests on disk every lookup returns
 * null/empty so generic fallbacks (registry-derived) can take over, and the
 * coverage test reports the gap instead of crashing on it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENT_DIR = path.join(root, 'src', 'meta', 'entities');

let _manifests = null; // Map<lowerEntity, { entity, manifest }>

function normalizedEntityName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_]/g, '');
}

function manifestHit(name) {
  const manifests = loadAll();
  const exact = manifests.get(String(name).toLowerCase());
  if (exact) return exact;
  const wanted = normalizedEntityName(name).replace(/_/g, '');
  return [...manifests.values()].find(({ entity }) => {
    const pattern = normalizedEntityName(entity).replace(/_/g, '(?:ae|oe|ue|ss|e)?');
    return pattern && new RegExp(`^${pattern}$`).test(wanted);
  }) || null;
}

function loadAll() {
  if (_manifests) return _manifests;
  _manifests = new Map();
  let files = [];
  try { files = fs.readdirSync(ENT_DIR); } catch { files = []; }
  for (const fn of files) {
    if (!fn.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(ENT_DIR, fn), 'utf8').replace(/^\uFEFF/, '');
      const manifest = JSON.parse(raw);
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) continue;
      const entity = manifest.entity || fn.replace(/\.json$/, '');
      _manifests.set(String(entity).toLowerCase(), { entity, manifest });
    } catch (e) {
      console.warn('meta-store: cannot parse', fn, e.message);
    }
  }
  return _manifests;
}

/** Lightweight index of every extracted entity (172 in the full checkout). */
export function metaIndex() {
  return [...loadAll().values()].map(({ manifest }) => ({
    entity: manifest.entity,
    baseTable: manifest.baseTable,
    isVirtual: manifest.isVirtual === true,
    keys: manifest.keys || [],
  }));
}

/** Resolve any spelling of an entity name to the canonical one, or null. */
export function resolveEntityName(name) {
  if (name == null) return null;
  const hit = manifestHit(name);
  return hit ? hit.entity : null;
}

/** Full manifest for an entity (any casing), or null when unknown. */
export function loadMeta(name) {
  if (!name) return null;
  const hit = manifestHit(name);
  return hit ? hit.manifest : null;
}

/** The field definition of one column, or null. */
export function fieldOf(meta, name) {
  const fields = meta && Array.isArray(meta.fields) ? meta.fields : [];
  return fields.find((f) => f && f.name === name) || null;
}

/**
 * The fields of one page kind, in the order the source declares them.
 * Field sets come from the extractor's `fieldSets` (list/export/view/edit/
 * add/search/print); the fallback is the per-field `pages` flags.
 *
 * @returns array of field definition objects (never names).
 */
export function pageFields(meta, kind) {
  if (!meta) return [];
  const fields = Array.isArray(meta.fields) ? meta.fields : [];
  const sets = meta.fieldSets || {};
  let names = sets[kind];
  if (Array.isArray(names) && names.length) {
    return names
      .map((entry) => {
        const fname = typeof entry === 'string' ? entry : entry && entry.name;
        return fieldOf(meta, fname) || (fname ? { name: fname } : null);
      })
      .filter(Boolean);
  }
  return fields
    .filter((f) => f && f.name && f.pages && f.pages[kind] === true)
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0));
}

/** The German label of a field; accepts a field object or a name. */
export function fieldLabel(meta, field) {
  const name = typeof field === 'string' ? field : field && field.name;
  const german = meta && meta.labels && (meta.labels.German || meta.labels.german);
  return (german && german[name]) || name || '';
}

/**
 * The lookup catalogue. The extracted lookup-links file is the catalogue the
 * port works from; manifests are the per-field detail.
 */
export function lookups() {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'src', 'meta', 'lookup-links.json'), 'utf8'));
    return data.entities || {};
  } catch {
    // derive from manifests when the catalogue file is absent
    const out = {};
    for (const { entity, manifest } of loadAll().values()) {
      for (const f of manifest.fields || []) {
        if (f && f.edit && f.edit.LookupTable) {
          (out[entity] = out[entity] || {})[f.name] = f.edit;
        }
      }
    }
    return out;
  }
}

/**
 * The 111 virtual entities (views over base tables). The extractor writes
 * src/meta/virtual-entities.json; without it we derive from `isVirtual`.
 */
export function virtualEntities() {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'src', 'meta', 'virtual-entities.json'), 'utf8'));
    return Array.isArray(data) ? data : (data.entities || data.names || []);
  } catch {
    return metaIndex().filter((e) => e.isVirtual).map((e) => e.entity);
  }
}

/**
 * The Prisma delegate key for a manifest's base table. Candidates are the
 * model names the client exposes; the match is case-insensitive on both the
 * model name and its physical table name.
 */
export function baseModelKey(meta, modelNames = []) {
  if (!meta) return null;
  const want = String(meta.baseTable || meta.entity || '').toLowerCase();
  for (const name of modelNames) {
    if (String(name).toLowerCase() === want) {
      const s = String(name);
      return s[0].toLowerCase() + s.slice(1);
    }
  }
  return null;
}

/** Drop the cache (tests / regeneration). */
export function resetMetaStore() {
  _manifests = null;
}

export default {
  metaIndex, loadMeta, pageFields, fieldLabel, lookups, virtualEntities,
  resolveEntityName, fieldOf, baseModelKey, resetMetaStore,
};
