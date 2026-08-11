/**
 * Dashboard catalogue, extracted from the PHP settings files.
 *
 * The source generates seven dashboards. The page file (Heute_dashboard.php)
 * is a thin wrapper around DashboardPage; the real content lives in
 * include/<Name>_settings.php as `.dashElements`, and scripts/
 * extract-dashboards.py pulls it into src/meta/dashboards.json:
 *
 *   7 dashboards, 41 elements: 22 lists, 11 charts, 1 report, 1 map,
 *   6 snippets, plus the dashboard-wide search fields (Heute: WV.Tag).
 *
 * Element types come from include/appsettings.php:
 *   0 LIST, 1 CHART, 2 REPORT, 3 RECORD, 4 SEARCH, 5 DETAILS, 6 MAP, 7 SNIPPET
 *
 * The menu (src/meta/menu.json) already carries a `/dashboard/<slug>` link per
 * dashboard. This module joins the two artefacts: slug -> menu item -> source
 * entity -> ordered elements. It is dependency-free so tests never touch
 * Prisma or express.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARDS_FILE = path.join(HERE, 'meta', 'dashboards.json');
const MENU_FILE = path.join(HERE, 'meta', 'menu.json');

/** include/appsettings.php:381-388 */
export const DASHBOARD_TYPES = {
  0: 'list',
  1: 'chart',
  2: 'report',
  3: 'record',
  4: 'search',
  5: 'details',
  6: 'map',
  7: 'snippet',
};

let dashboardsCache = null;
let menuCache = null;

function readJson(file, fallback) {
  try {
    let raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Reads src/meta/dashboards.json once. */
export function loadDashboards() {
  if (!dashboardsCache) {
    dashboardsCache = readJson(DASHBOARDS_FILE, { counts: {}, dashboards: {} });
    if (!dashboardsCache.dashboards) dashboardsCache.dashboards = {};
  }
  return dashboardsCache;
}

/** Reads src/meta/menu.json once (only the dashboard leaves are used). */
export function loadMenuItems() {
  if (!menuCache) {
    menuCache = readJson(MENU_FILE, { items: [] });
    if (!Array.isArray(menuCache.items)) menuCache.items = [];
  }
  return menuCache.items;
}

export function resetDashboardCache() {
  dashboardsCache = null;
  menuCache = null;
}

/**
 * How the source spells a display name in its file names:
 * "Assistent Doppelte Buchführung" -> Assistent_Doppelte_Buchf_hrung
 * (spaces and every non-ASCII character become an underscore).
 */
export function normalizeFileName(name) {
  return String(name == null ? '' : name)
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/ /g, '_');
}

/** Same slugging the menu extractor uses (umlauts expand before the rest). */
export function slugify(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/\u00e4/g, 'ae')
    .replace(/\u00f6/g, 'oe')
    .replace(/\u00fc/g, 'ue')
    .replace(/\u00df/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The dashboard leaves of the main menu, joined to their source entity. */
export function menuDashboards() {
  const known = loadDashboards().dashboards;
  return loadMenuItems()
    .filter((it) => it && it.pageType === 'Dashboard')
    .map((it) => {
      const entity = normalizeFileName(it.table || it.title || '');
      return {
        slug: it.slug,
        title: it.title,
        table: it.table,
        entity,
        hasSettings: Boolean(known[entity]),
        href: it.href || `/dashboard/${it.slug}`,
      };
    });
}

/**
 * Resolves a `/dashboard/<slug>` segment to a source entity.
 * Looks at the menu first (its slug was built from the display name), then
 * falls back to slugging the entity names directly.
 */
export function entityForSlug(slug) {
  if (!slug) return null;
  const wanted = slugify(slug);
  const wantedLower = String(slug).toLowerCase();

  for (const item of menuDashboards()) {
    if (!item.hasSettings) continue;
    const s = String(item.slug || '').toLowerCase();
    if (s === wantedLower || slugify(item.slug) === wanted || slugify(item.table) === wanted
      || slugify(item.title) === wanted) {
      return item.entity;
    }
  }

  for (const entity of Object.keys(loadDashboards().dashboards)) {
    if (slugify(entity) === wanted || entity.toLowerCase() === wantedLower) return entity;
  }
  // Dual umlaut forms: buchfuehrung vs buchf_hrung
  const alt = wanted.replace(/ue/g, '_').replace(/ae/g, '_').replace(/oe/g, '_').replace(/ss/g, '_');
  for (const entity of Object.keys(loadDashboards().dashboards)) {
    if (slugify(entity) === alt || entity.toLowerCase() === alt) return entity;
  }
  return null;
}

/** cell_3_0 -> { row: 3, col: 0 }; a missing cell sorts last. */
export function cellPosition(cellName) {
  const m = /^cell_(\d+)_(\d+)$/.exec(String(cellName || ''));
  if (!m) return { row: 999, col: 0 };
  return { row: Number(m[1]), col: Number(m[2]) };
}

/** Normalises one extracted element for rendering. */
export function elementView(element) {
  if (!element) return null;
  const type = typeof element.type === 'number' ? element.type : 0;
  const pos = cellPosition(element.cellName);
  return {
    name: element.elementName || '',
    table: element.table || '',
    type,
    typeName: DASHBOARD_TYPES[type] || 'list',
    cell: element.cellName || null,
    row: pos.row,
    col: pos.col,
    inlineAdd: element.inlineAdd === true,
    inlineEdit: element.inlineEdit === true,
    deleteRecord: element.deleteRecord === true,
    popupAdd: element.popupAdd === true,
    popupEdit: element.popupEdit === true,
    popupView: element.popupView === true,
    updateSelected: element.updateSelected === true,
    masterTable: element.masterTable || null,
    snippetId: element.snippetId != null ? String(element.snippetId) : null,
  };
}

function byCell(a, b) {
  return a.row - b.row || a.col - b.col;
}

/**
 * The full definition of one dashboard: entity name, elements sorted in the
 * cell order the source assigns, and the dashboard-wide search fields.
 * Accepts an entity name or a menu slug.
 */
export function dashboardFor(nameOrSlug) {
  const known = loadDashboards().dashboards;
  const entity = known[nameOrSlug] ? nameOrSlug : entityForSlug(nameOrSlug);
  if (!entity || !known[entity]) return null;
  const def = known[entity];
  const menu = menuDashboards().find((d) => d.entity === entity) || {};
  return {
    entity,
    // Prefer menu slug (e.g. heute) over title slug (wiedervorlage)
    slug: menu.slug || slugify(entity),
    elements: (def.elements || []).map(elementView).filter(Boolean).sort(byCell),
    searchFields: def.searchFields || {},
  };
}

/** The elements that show live table rows (what the base dashboard needs). */
export function listElements(dashboard) {
  const def = typeof dashboard === 'string' ? dashboardFor(dashboard) : dashboard;
  if (!def) return [];
  return def.elements.filter((e) => e.typeName === 'list' && e.table);
}

/** Coverage numbers, handy in tests and on an admin page. */
export function summary() {
  const data = loadDashboards();
  const dashboards = data.dashboards || {};
  const out = {
    dashboards: Object.keys(dashboards).length,
    elements: 0,
    byType: {},
    menuLeaves: menuDashboards().length,
    menuLeavesResolved: menuDashboards().filter((d) => d.hasSettings).length,
  };
  for (const def of Object.values(dashboards)) {
    for (const el of def.elements || []) {
      out.elements += 1;
      const t = DASHBOARD_TYPES[el.type] || String(el.type);
      out.byType[t] = (out.byType[t] || 0) + 1;
    }
  }
  return out;
}

export default {
  DASHBOARD_TYPES,
  loadDashboards,
  loadMenuItems,
  resetDashboardCache,
  normalizeFileName,
  slugify,
  menuDashboards,
  entityForSlug,
  cellPosition,
  elementView,
  dashboardFor,
  listElements,
  summary,
};
