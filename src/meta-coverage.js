/**
 * Metadata coverage audit.
 *
 * src/meta/entities/ holds one manifest per source settings file (172 of
 * them). This module is the health check for that set: it proves that every
 * manifest loads, carries the required keys, that every field has a name and
 * a numeric type, and that every lookup target declared in the edit blocks
 * resolves to a real entity (or, in exactly one case, to the rights table,
 * which exists in the database but has no page of its own).
 *
 * The two deliberate exceptions are encoded as data, not hidden:
 *   - the seven dashboard entities have no table fields (their content is
 *     dashElements, see src/dashboards.js and src/meta/dashboards.json)
 *   - the three *Diagramme dashboards declare empty label arrays in the
 *     source, so their manifests carry none
 *
 * Dependency-free apart from meta-store.js so it runs in tests.
 */

import { metaIndex, loadMeta } from './meta-store.js';
import { normalizeFileName } from './dashboards.js';

/** The keys every manifest must carry. */
export const REQUIRED_KEYS = [
  'entity', 'baseTable', 'isVirtual', 'sql', 'keys', 'pageSize',
  'capabilities', 'fieldSets', 'export', 'print', 'tabs', 'labels', 'fields',
];

/** Dashboards hold dashElements instead of table fields. */
export const DASHBOARD_ENTITIES = [
  'Heute',
  'Adressen_Diagramme',
  'Immobilien_Diagramme',
  'Inventar_Diagramme',
  'Assistent_Abrechnungen',
  'Assistent_Doppelte_Buchf_hrung',
  'Assistent_Objekte_und_Einheiten',
];

/** The rights table is a lookup target but has no page of its own. */
export const KNOWN_TABLE_ONLY_TARGETS = ['intex hausverwaltung_uggroups'];

export function isDashboardEntity(name) {
  return DASHBOARD_ENTITIES.includes(name);
}

function entityNamesLower() {
  return new Set(metaIndex().map((e) => String(e.entity).toLowerCase()));
}

/**
 * Resolves a LookupTable value to the manifest behind it. The edit blocks mix
 * entity spellings (Objekte) with display spellings ("Klassifikationen
 * Inventar"), so the file-name spelling is tried as well.
 *
 * @returns {{kind: 'entity'|'table', name: string}}
 */
export function resolveLookupTarget(name, knownLower) {
  const lower = knownLower || entityNamesLower();
  const raw = String(name == null ? '' : name);
  if (lower.has(raw.toLowerCase())) return { kind: 'entity', name: raw };
  const fileSpelling = normalizeFileName(raw);
  if (lower.has(fileSpelling.toLowerCase())) {
    return { kind: 'entity', name: fileSpelling };
  }
  return { kind: 'table', name: raw };
}

/** Walks every manifest and returns the full coverage report. */
export function computeCoverage() {
  const names = metaIndex().map((e) => e.entity);
  const knownLower = new Set(names.map((n) => String(n).toLowerCase()));

  const report = {
    manifests: names.length,
    totalFields: 0,
    virtual: 0,
    missingKeys: [],
    fieldsWithoutName: 0,
    fieldsWithBadType: 0,
    emptyNonDashboard: [],
    withoutLabels: [],
    lookupRefs: 0,
    lookupTables: 0,
    unresolvedLookupTables: [],
    dashboardEntities: DASHBOARD_ENTITIES,
  };

  const lookupTables = new Set();

  for (const name of names) {
    const meta = loadMeta(name);
    for (const key of REQUIRED_KEYS) {
      if (!(key in meta)) report.missingKeys.push({ entity: name, key });
    }
    const fields = Array.isArray(meta.fields) ? meta.fields : [];
    report.totalFields += fields.length;
    if (meta.isVirtual) report.virtual += 1;
    if (!meta.labels || !Object.keys(meta.labels).length) {
      report.withoutLabels.push(name);
    }
    if (fields.length === 0 && !isDashboardEntity(name)) {
      report.emptyNonDashboard.push(name);
    }
    for (const field of fields) {
      if (!field || !field.name) report.fieldsWithoutName += 1;
      if (!field || typeof field.type !== 'number') report.fieldsWithBadType += 1;
      const table = field && field.edit && field.edit.LookupTable;
      if (table) {
        report.lookupRefs += 1;
        lookupTables.add(table);
      }
    }
  }

  report.withoutLabels.sort();
  report.lookupTables = lookupTables.size;
  report.unresolvedLookupTables = [...lookupTables]
    .filter((t) => resolveLookupTarget(t, knownLower).kind !== 'entity')
    .sort();

  return report;
}

export default {
  REQUIRED_KEYS,
  DASHBOARD_ENTITIES,
  KNOWN_TABLE_ONLY_TARGETS,
  isDashboardEntity,
  resolveLookupTarget,
  computeCoverage,
};
