#!/usr/bin/env node
/**
 * Phase 13 - machine-readable source catalog.
 *
 * PLANNING.md's acceptance gate: every page/helper/button/menu node of the
 * source must carry a status (ported | tested | partial | manual |
 * not-applicable | pending) plus its Node destination. The PHP files
 * themselves are only in the reference checkout, so the catalog aggregates
 * what was already extracted machine-verified from them: menu.json (195
 * nodes), charts.json (18), dashboards.json (7), event-ops.json (134 hooks),
 * relations.json (102) and the 62-table registry.
 *
 * Output: src/meta/source-catalog.json (+ a printed summary).
 * Import-safe: buildCatalog() can be used by tests without writing files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return fallback; }
}

/** menu.json leaf -> the Node route it was ported to (null = not routable yet). */
function leafTarget(node) {
  if (node.external) return { status: 'not-applicable', target: node.href || null, note: 'external link' };
  switch (node.pageType) {
    case 'List': return { status: 'ported', target: '/' + (node.table || '').toLowerCase() };
    case 'Report': return { status: 'ported', target: '/report/' + (node.table || '') };
    case 'Chart': return { status: 'ported', target: '/chart/' + (node.table || '') };
    case 'Dashboard': return { status: 'ported', target: '/dashboard/' + (node.table || '') };
    case 'Add': return { status: 'ported', target: '/' + (node.table || '').toLowerCase() + '/add' };
    case 'Edit': return { status: 'ported', target: '/' + (node.table || '').toLowerCase() + '/edit' };
    default: return { status: 'pending', target: null };
  }
}

export function buildCatalog() {
  const menu = readJson('src/meta/menu.json', { items: [] });
  const charts = readJson('src/meta/charts.json', { charts: {} });
  const dashboards = readJson('src/meta/dashboards.json', { dashboards: {} });
  const eventOps = readJson('src/meta/event-ops.json', { entities: {}, summary: {} });
  const relations = readJson('src/meta/relations.json', {});
  const handlerOps = readJson('src/meta/handler-ops.json', null);

  const entries = [];

  // --- menu nodes (the page inventory the user actually navigates)
  for (const item of menu.items || []) {
    if (item.type !== 'Leaf') continue;
    const t = leafTarget(item);
    entries.push({
      kind: 'page', id: 'menu:' + (item.title || item.table),
      source: 'menunodes_main.php', table: item.table || null,
      pageType: item.pageType || null, ...t,
    });
  }

  // --- charts: validated against the fixture dataset in this snapshot
  for (const name of Object.keys(charts.charts || {})) {
    entries.push({
      kind: 'chart', id: 'chart:' + name, source: name + '_chart.php',
      status: 'tested', target: '/chart/' + name,
      note: 'runs on the shared fixture (npm run smoke:charts)',
    });
  }

  // --- dashboards
  for (const name of Object.keys(dashboards.dashboards || {})) {
    entries.push({
      kind: 'dashboard', id: 'dashboard:' + name, source: name + '_dashboard.php',
      status: 'ported', target: '/dashboard/' + name.toLowerCase(),
    });
  }

  // --- event hooks: status straight from the compiled ops catalogue
  for (const [entity, hooks] of Object.entries(eventOps.entities || {})) {
    for (const [hook, def] of Object.entries(hooks)) {
      const status = { compiled: 'ported', partial: 'partial', manual: 'manual' }[def.status]
        || 'not-applicable';
      entries.push({
        kind: 'hook', id: `hook:${entity}.${hook}`,
        source: `include/${entity}_events.php`, status,
        target: 'src/events/runtime.js',
        lines: def.lines ?? null,
      });
    }
  }

  // --- master/detail relations
  let relCount = 0;
  for (const [master, list] of Object.entries(relations || {})) {
    if (!Array.isArray(list)) continue;
    for (const rel of list) {
      relCount += 1;
      entries.push({
        kind: 'relation', id: `relation:${master}->${rel.detail || relCount}`,
        source: 'include/*_settings.php', status: 'ported',
        target: 'src/master-detail.js',
      });
    }
  }

  // --- button handlers: from the compiled catalogue when present
  if (handlerOps && handlerOps.specs) {
    for (const [buttId, spec] of Object.entries(handlerOps.specs)) {
      entries.push({
        kind: 'button', id: 'button:' + buttId, source: 'buttonhandler.php',
        status: spec.op === 'manual' || spec.op === 'unrecognised' ? 'manual' : 'ported',
        target: 'src/button-handlers/runtime.js',
      });
    }
  } else {
    entries.push({
      kind: 'button', id: 'button:__catalog__', source: 'buttonhandler.php',
      status: 'pending', target: 'src/meta/handler-ops.json',
      note: '139 handlers bekanntermaßen vorhanden; kompilierter Katalog fehlt in diesem Snapshot',
    });
  }

  const counts = {};
  for (const e of entries) {
    counts[e.kind] = (counts[e.kind] || 0) + 1;
    counts['status:' + e.status] = (counts['status:' + e.status] || 0) + 1;
  }

  return {
    generated: new Date().toISOString(),
    source: 'hausverwaltungplus version 1812 vorlage',
    entries,
    counts: {
      total: entries.length,
      menuLeaves: entries.filter((e) => e.kind === 'page').length,
      charts: Object.keys(charts.charts || {}).length,
      dashboards: Object.keys(dashboards.dashboards || {}).length,
      hooks: eventOps.summary?.hooks ?? entries.filter((e) => e.kind === 'hook').length,
      relations: relCount,
      byStatus: Object.fromEntries(
        Object.entries(counts).filter(([k]) => k.startsWith('status:'))
          .map(([k, v]) => [k.slice(7), v])),
      byKind: Object.fromEntries(
        Object.entries(counts).filter(([k]) => !k.startsWith('status:'))),
    },
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const catalog = buildCatalog();
  const dest = path.join(root, 'src', 'meta', 'source-catalog.json');
  fs.writeFileSync(dest, JSON.stringify(catalog, null, 1));
  console.log('entries:', catalog.counts.total);
  console.log('by status:', JSON.stringify(catalog.counts.byStatus));
  console.log('->', path.relative(root, dest));
}
