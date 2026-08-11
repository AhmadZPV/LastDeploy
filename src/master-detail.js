/**
 * Phase 5 - master/detail relations.
 *
 * The PHP app declares its parent/child links in every include/*_settings.php
 * as `$detailsTablesData["<Master>"][$dIndex]`, with explicit `masterKeys` and
 * `detailKeys`. scripts/extract-relations.py lifts all 102 of them into
 * src/meta/relations.json so we no longer guess a foreign key from the table
 * name (the old guessLocalFieldName covered ~10 of 102 relations, and got
 * cases like Angebote -> Positionen.Verkaufsvorgang plain wrong).
 */
import { createRequire } from 'node:module';
import { registry, moduleNames } from './registry.js';
import { resolveEntityName, loadMeta, baseModelKey, metaIndex } from './meta-store.js';

const require = createRequire(import.meta.url);

let _catalogue = null;
function catalogue() {
  if (_catalogue) return _catalogue;
  try {
    _catalogue = require('./meta/relations.json');
  } catch {
    _catalogue = {};
  }
  return _catalogue;
}

/** Normalise a table name for comparison, mapping German umlauts. */
function normalise(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\u00e4/g, 'ae').replace(/\u00f6/g, 'oe').replace(/\u00fc/g, 'ue')
    .replace(/\u00df/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

/** Normalise with non-ASCII dropped entirely, matching the "_" substitution. */
function loose(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

let _slugIndex = null;
function slugIndex() {
  if (_slugIndex) return _slugIndex;
  _slugIndex = new Map();
  for (const slug of moduleNames()) {
    _slugIndex.set(normalise(slug), slug);
    const meta = registry[slug];
    if (meta?.table) _slugIndex.set(normalise(meta.table), slug);
    if (meta?.model) _slugIndex.set(normalise(meta.model), slug);
  }
  return _slugIndex;
}

/** Resolve a PHP table name to a registry slug, or null when we have no entity. */
export function resolveSlug(tableName) {
  return slugIndex().get(normalise(tableName)) || null;
}

let _metaLoose = null;
function metaLooseIndex() {
  if (_metaLoose) return _metaLoose;
  _metaLoose = new Map();
  let rows = [];
  try { rows = metaIndex() || []; } catch { rows = []; }
  for (const row of rows) {
    const entity = typeof row === 'string' ? row : row?.entity;
    if (entity) _metaLoose.set(loose(entity), entity);
  }
  return _metaLoose;
}

/**
 * Resolve a detail table that has no registry entity.
 *
 * 18 of the 102 detail tables are PHPRunner *views* over a real base table
 * (Journal -> Buchungen, P35aEStG -> Kosten, Terminliste -> Termine, ...).
 * They are absent from the 59-entity registry but present in the 172-entity
 * metadata, so we can still render them through their base table.
 */
export function resolveMetaEntity(tableName) {
  if (!tableName) return null;
  const direct = resolveEntityName(tableName);
  if (direct) return direct;
  // "Objekte Historie" is stored as "Objekte_Historie"
  const viaUnderscore = resolveEntityName(String(tableName).replace(/\s+/g, '_'));
  if (viaUnderscore) return viaUnderscore;
  // The metadata generator replaced non-ASCII with "_", so "Abrechnungsdaten
  // Uebersicht" became "Abrechnungsdaten__bersicht" and "Kontenblaetter"
  // became "Kontenbl_tter". Compare with those characters dropped on both sides.
  return metaLooseIndex().get(loose(tableName)) || null;
}

/** True when we can render this detail table one way or the other. */
export function isRenderable(tableName) {
  return Boolean(resolveSlug(tableName) || resolveMetaEntity(tableName));
}

/**
 * All detail relations declared for a master entity.
 * Accepts a slug or the original PHP table name.
 */
export function relationsFor(master) {
  const cat = catalogue();
  const wanted = normalise(master);
  let list = cat[master];
  if (!list) {
    const hit = Object.keys(cat).find((k) => normalise(k) === wanted);
    list = hit ? cat[hit] : null;
  }
  if (!list) return [];
  return list
    .map((r) => {
      const detailSlug = resolveSlug(r.detail);
      const metaEntity = detailSlug ? null : resolveMetaEntity(r.detail);
      return {
        ...r,
        detailSlug: detailSlug || metaEntity,
        // a view-backed detail is read-only: it has metadata but no CRUD route
        viaMeta: !detailSlug && Boolean(metaEntity),
      };
    })
    .filter((r) => r.detailSlug);
}

/** Relations that the PHP showed as a preview on a given page kind. */
export function relationsForPage(master, kind) {
  const flag = { list: 'previewOnList', view: 'previewOnView',
                 add: 'previewOnAdd', edit: 'previewOnEdit' }[kind];
  if (!flag) return [];
  return relationsFor(master).filter((r) => r[flag]);
}

/** Find one relation between a master and a named child. */
export function findRelation(master, childName) {
  const want = normalise(childName);
  return relationsFor(master).find(
    (r) => normalise(r.detail) === want || normalise(r.detailSlug) === want) || null;
}

/**
 * Build the Prisma `where` fragment linking a child to one parent row.
 * Returns null when a key is missing on the parent row, which is what the PHP
 * treated as "no children" rather than "all children".
 */
export function childWhere(relation, parentRow) {
  if (!relation?.masterKeys?.length || !relation?.detailKeys?.length) return null;
  if (relation.masterKeys.length !== relation.detailKeys.length) return null;
  const where = {};
  for (let i = 0; i < relation.masterKeys.length; i++) {
    const value = parentRow?.[relation.masterKeys[i]];
    if (value === undefined || value === null || value === '') return null;
    where[relation.detailKeys[i]] = value;
  }
  return where;
}

/** Prisma model names, read from the client's DMMF when it exposes one. */
function prismaModelNames(prisma) {
  const dmmf = prisma?._runtimeDataModel?.models;
  if (dmmf) return Object.keys(dmmf);
  const fromCtor = prisma?.constructor?.dmmf?.datamodel?.models;
  if (Array.isArray(fromCtor)) return fromCtor.map((m) => m.name);
  return Object.keys(prisma || {})
    .filter((k) => !k.startsWith('$') && !k.startsWith('_'))
    .map((k) => k[0].toUpperCase() + k.slice(1));
}

/** Prisma delegate for a relation's detail entity. */
export function detailDelegate(prisma, relation) {
  if (!relation?.detailSlug) return null;
  if (!relation.viaMeta) {
    const meta = registry[relation.detailSlug];
    if (meta?.model && prisma[meta.model]) return prisma[meta.model];
  }
  // view-backed detail: route through the base table declared in the metadata
  const meta = loadMeta(relation.detailSlug);
  const key = meta ? baseModelKey(meta, prismaModelNames(prisma)) : null;
  return (key && prisma[key]) || null;
}

/**
 * Child counters for the parent rows of a list page.
 * The PHP `dispChildCount` flag decides whether a count is shown at all, so we
 * only query for relations that asked for it. One grouped query per relation
 * keeps this at O(relations), not O(rows x relations).
 */
export async function childCounts({ prisma, master, rows, kind = 'list', scope }) {
  const rels = relationsForPage(master, kind).filter((r) => r.dispChildCount);
  const out = {};
  if (!rels.length || !rows?.length) return out;

  for (const rel of rels) {
    const delegate = detailDelegate(prisma, rel);
    // grouping only works for a single-column link
    if (!delegate || rel.masterKeys.length !== 1) continue;
    const masterKey = rel.masterKeys[0];
    const detailKey = rel.detailKeys[0];
    const values = [...new Set(rows.map((r) => r[masterKey])
      .filter((v) => v !== undefined && v !== null && v !== ''))];
    if (!values.length) continue;
    try {
      const where = { [detailKey]: { in: values } };
      const grouped = await delegate.groupBy({
        by: [detailKey],
        where: scope ? scope(where, rel.detailSlug) : where,
        _count: { _all: true },
      });
      const byValue = new Map(grouped.map((g) => [g[detailKey], g._count?._all ?? 0]));
      for (const row of rows) {
        const v = row[masterKey];
        if (v === undefined || v === null) continue;
        (out[v] = out[v] || {})[rel.detailSlug] = byValue.get(v) || 0;
      }
    } catch {
      // a missing column or unsupported groupBy must not break the list page
    }
  }
  return out;
}

/** Summary used by the catalogue endpoint and the tests. */
export function summary() {
  const cat = catalogue();
  const all = Object.entries(cat).flatMap(([m, v]) => v.map((r) => ({ master: m, ...r })));
  return {
    masters: Object.keys(cat).length,
    relations: all.length,
    resolvable: all.filter((r) => isRenderable(r.detail)).length,
    viaRegistry: all.filter((r) => resolveSlug(r.detail)).length,
    viaMeta: all.filter((r) => !resolveSlug(r.detail) && resolveMetaEntity(r.detail)).length,
    unresolvable: [...new Set(all.filter((r) => !isRenderable(r.detail)).map((r) => r.detail))],
    previewOnList: all.filter((r) => r.previewOnList).length,
    previewOnView: all.filter((r) => r.previewOnView).length,
    withCounter: all.filter((r) => r.dispChildCount).length,
    multiKey: all.filter((r) => r.masterKeys.length > 1).length,
  };
}

export default {
  relationsFor, relationsForPage, findRelation, childWhere,
  detailDelegate, childCounts, resolveSlug, resolveMetaEntity, isRenderable, summary,
};
