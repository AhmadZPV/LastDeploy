import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE_FILE = path.join(__dirname, 'meta', 'menu.json');

// Assigned by BeforeShowMenu() in include/events.php.
export const MENU_TITLE = 'Erwin Property Mgmt - Men\u00fc';

// ModifyMenuItem() in include/events.php hides these by title, not by table.
export const ADMIN_ONLY_TITLES = ['Backup', 'Vertragsdaten'];
export const GUEST_HIDDEN_TITLES = [
  'OneNote', 'Onedrive', 'Outlook Kalender', 'Outlook Mail',
  'Word online', 'Gesetze/Verordnungen', 'Urteile',
];

let _catalogue = null;

/**
 * Reads src/meta/menu.json, produced by scripts/extract-menu.py straight from
 * include/menunodes_main.php and include/menunodes_adminarea.php.
 */
export function loadCatalogue() {
  if (_catalogue) return _catalogue;
  if (!fs.existsSync(CATALOGUE_FILE)) {
    _catalogue = { items: [], counts: {} };
    return _catalogue;
  }
  let text = fs.readFileSync(CATALOGUE_FILE, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    _catalogue = JSON.parse(text);
  } catch {
    _catalogue = { items: [], counts: {} };
  }
  if (!Array.isArray(_catalogue.items)) _catalogue.items = [];
  return _catalogue;
}

/** Test seam: drop the cache so a rebuilt catalogue is picked up. */
export function resetMenuCache() {
  _catalogue = null;
}

/**
 * Port of ModifyMenuItem(&$menuItem). Returns false when the item must not be
 * shown. The PHP compares the *title*, so we do too.
 */
export function modifyMenuItem(item, ctx = {}) {
  const title = (item && (item.title || item.label)) || '';
  const isAdmin = ctx.isAdmin === true;
  const isGuest = ctx.isGuest === true;
  if (!isAdmin && ADMIN_ONLY_TITLES.includes(title)) return false;
  if (isGuest && GUEST_HIDDEN_TITLES.includes(title)) return false;
  return true;
}

/**
 * True when the signed-in user may open this leaf.
 *
 * Groups and separators carry no table, so they are never filtered here; they
 * disappear later if every child of theirs was filtered out.
 */
export function itemVisible(item, ctx = {}) {
  if (!modifyMenuItem(item, ctx)) return false;
  if (item.menu === 'adminarea' && ctx.isAdmin !== true) return false;
  if (item.type !== 'Leaf') return true;
  if (item.external) return true;
  if (!item.slug) return false;
  if (typeof ctx.canAccess !== 'function') return true;
  // Rights are keyed by TableName (spaces/umlauts) and by slug — try both.
  if (ctx.canAccess(item.slug, 'S') !== false) return true;
  if (item.table && ctx.canAccess(item.table, 'S') !== false) return true;
  return false;
}

function toRenderItem(item) {
  return {
    id: item.id,
    label: item.title || item.name || '',
    title: item.title || item.name || '',
    href: item.href || '',
    module: item.slug || (item.external ? `ext-${item.id}` : ''),
    slug: item.slug || '',
    table: item.table || '',
    pageType: item.pageType || '',
    icon: item.icon || '',
    external: item.external === true,
    special: item.type === 'Separator',
  };
}

/**
 * Builds the sidebar tree for one request.
 *
 * @param {object} ctx
 * @param {boolean} ctx.isAdmin
 * @param {boolean} ctx.isGuest
 * @param {(slug: string, letters: string) => boolean} [ctx.canAccess]
 * @returns {{groups: Array<{id, label, items: Array}>}}
 */
export function menuFor(ctx = {}) {
  const { items } = loadCatalogue();
  const main = items.filter((i) => i.menu !== 'adminarea');

  const groups = [];
  const byId = new Map();
  for (const item of main) {
    if (item.type !== 'Group') continue;
    if (!modifyMenuItem(item, ctx)) continue;
    const parent = items.find((candidate) => candidate.id === item.parent && candidate.type === 'Group');
    const group = {
      id: item.id,
      label: item.title || item.name || '',
      parentLabel: parent?.title || parent?.name || '',
      items: [],
    };
    byId.set(item.id, group);
    groups.push(group);
  }

  // Leaves hanging off the root have no group of their own; PHPRunner renders
  // them at the top of the sidebar, so we keep them in one implicit group.
  let rootGroup = null;
  const rootGroupFor = () => {
    if (!rootGroup) {
      rootGroup = { id: 'root', label: '', items: [] };
      groups.unshift(rootGroup);
    }
    return rootGroup;
  };

  for (const item of main) {
    if (item.type === 'Group') continue;
    if (!itemVisible(item, ctx)) continue;
    const target = byId.get(item.parent) || rootGroupFor();
    target.items.push(toRenderItem(item));
  }

  const admin = items.filter((i) => i.menu === 'adminarea' && itemVisible(i, ctx));
  if (admin.length) {
    groups.push({
      id: 'adminarea',
      label: 'Administration',
      items: admin.map(toRenderItem),
    });
  }

  // A group whose children were all filtered away must not leave an empty
  // heading behind, and a group holding only separators is empty too.
  const visibleGroups = groups.filter((g) => g.items.some((i) => !i.special));
  const sections = [];
  const bySection = new Map();
  for (const group of visibleGroups) {
    const label = group.parentLabel || group.label || '';
    let section = bySection.get(label);
    if (!section) {
      section = { id: `section-${group.parentLabel || group.id}`.replace(/[^a-zA-Z0-9_-]/g, '-'), label, groups: [] };
      bySection.set(label, section);
      sections.push(section);
    }
    section.groups.push(group);
  }
  return {
    title: MENU_TITLE,
    groups: visibleGroups,
    sections,
  };
}

/**
 * Backwards-compatible entry point used by server.js and layout_top.ejs.
 * Without a context it behaves like an admin session.
 */
export function loadMenu(ctx) {
  return menuFor(ctx || { isAdmin: true, isGuest: false });
}

/** Small report used by the tests and by the extraction script. */
export function menuSummary() {
  const { items } = loadCatalogue();
  const summary = {
    nodes: items.length,
    groups: 0,
    leaves: 0,
    separators: 0,
    external: 0,
    byPageType: {},
    withoutHref: 0,
  };
  for (const item of items) {
    if (item.type === 'Group') summary.groups += 1;
    else if (item.type === 'Separator') summary.separators += 1;
    else {
      summary.leaves += 1;
      const key = item.pageType || '(none)';
      summary.byPageType[key] = (summary.byPageType[key] || 0) + 1;
      if (!item.href) summary.withoutHref += 1;
    }
    if (item.external) summary.external += 1;
  }
  return summary;
}

export default { loadMenu, menuFor, loadCatalogue, modifyMenuItem, itemVisible, menuSummary, resetMenuCache, MENU_TITLE };
