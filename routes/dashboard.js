/**
 * Dashboard routes.
 *
 * Wired from server.js with dependency injection (same pattern as
 * routes/uploads.js) so the module never imports server.js and stays free of
 * import cycles.
 */

import { Router } from 'express';
import {
  dashboardFor,
  normalizeFileName,
  slugify as dashSlugify,
} from '../src/dashboards.js';
import { renderSnippet } from '../src/snippets.js';
import {
  getChart,
  buildChartSql,
  toChartData,
  renderChartHtml,
  renderChartFragment,
} from '../src/charts/engine.js';
import { delegateName } from '../src/registry.js';
import { resolveDataTable } from '../src/virtual-tables.js';

export const DASHBOARD_LIST_TAKE = 10;
export const PREVIEW_FIELD_COUNT = 4;

/** Prisma model keys to try for a source table name (WV -> wV, wv, WV). */
export function modelKeysForTable(table) {
  if (!table) return [];
  const raw = String(table);
  const keys = [
    delegateName(raw),
    raw.toLowerCase(),
    raw,
    delegateName(raw.toLowerCase()),
  ];
  return [...new Set(keys.filter(Boolean))];
}

/** The Prisma delegate for a source table name (WV -> prisma.wV). */
export function modelForTable(prisma, table) {
  if (!prisma || !table) return null;
  const dataTable = resolveDataTable(table) || table;
  for (const key of modelKeysForTable(dataTable)) {
    if (prisma[key] && typeof prisma[key].findMany === 'function') return prisma[key];
  }
  return null;
}

/**
 * A compact preview of one row for the dashboard: the first few scalar
 * fields, skipping the primary key and binary columns.
 */
export function previewRow(row, max = PREVIEW_FIELD_COUNT) {
  const out = [];
  if (!row || typeof row !== 'object') return out;
  for (const [key, value] of Object.entries(row)) {
    if (out.length >= max) break;
    if (key === 'ID') continue;
    if (value == null || Buffer.isBuffer(value)) continue;
    let text;
    if (value instanceof Date) text = value.toISOString().slice(0, 10);
    else if (typeof value === 'object' && typeof value.toNumber === 'function') text = String(value.toNumber());
    else text = String(value);
    if (text === '') continue;
    out.push({ key, value: text.length > 80 ? text.slice(0, 77) + '...' : text });
  }
  return out;
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/**
 * Raw SQLite fallback when Prisma DateTime coercion fails (date-only strings
 * like "2026-08-20" in the dump).
 */
async function fetchRowsRaw(prisma, table, where, take) {
  const dataTable = resolveDataTable(table) || table;
  const physical = String(dataTable);
  // Prefer schema @@map via registry if present
  let sqlTable = physical;
  try {
    const { registry } = await import('../src/registry.js');
    const meta = registry[physical.toLowerCase()] || registry[delegateName(physical)];
    if (meta?.table) sqlTable = meta.table;
  } catch { /* keep physical */ }

  const clauses = [];
  const params = [];
  if (where && typeof where === 'object') {
    for (const [k, v] of Object.entries(where)) {
      if (v == null || typeof v === 'object') continue;
      clauses.push(`${quoteIdent(k)} = ?`);
      params.push(v);
    }
  }
  const whereSql = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const limit = Number(take) > 0 ? Number(take) : DASHBOARD_LIST_TAKE;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM ${quoteIdent(sqlTable)}${whereSql} LIMIT ${limit}`,
    ...params,
  );
  let count = Array.isArray(rows) ? rows.length : 0;
  try {
    const cnt = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS c FROM ${quoteIdent(sqlTable)}${whereSql}`,
      ...params,
    );
    if (cnt && cnt[0] && cnt[0].c != null) count = Number(cnt[0].c);
  } catch { /* keep length */ }
  return { rows: rows || [], count };
}

/** Fetches the rows and the total count for one list element, team-scoped. */
export async function fetchElementRows({ prisma, req, teamWhere, element, take = DASHBOARD_LIST_TAKE }) {
  const dataTable = resolveDataTable(element.table) || element.table;
  const model = modelForTable(prisma, dataTable);
  const where = teamWhere ? teamWhere(req, {}, String(dataTable).toLowerCase()) : {};

  if (model && typeof model.findMany === 'function') {
    try {
      const rows = await model.findMany({ where, take });
      const count = typeof model.count === 'function'
        ? await model.count({ where })
        : rows.length;
      return {
        rows: rows.map((row) => ({ id: row && row.ID, preview: previewRow(row) })),
        count,
        available: true,
      };
    } catch (e) {
      // DateTime P2023 and similar: fall back to raw SQL so the panel still works
      try {
        const raw = await fetchRowsRaw(prisma, dataTable, where, take);
        return {
          rows: (raw.rows || []).map((row) => ({ id: row && row.ID, preview: previewRow(row) })),
          count: raw.count,
          available: true,
        };
      } catch (e2) {
        return {
          rows: [],
          count: 0,
          available: false,
          error: String((e2 && e2.message) || e2 || e),
        };
      }
    }
  }

  // No Prisma model — try raw table name (virtual base)
  try {
    const raw = await fetchRowsRaw(prisma, dataTable, where, take);
    return {
      rows: (raw.rows || []).map((row) => ({ id: row && row.ID, preview: previewRow(row) })),
      count: raw.count,
      available: true,
    };
  } catch (e) {
    return { rows: [], count: 0, available: false, error: String((e && e.message) || e) };
  }
}

/** The link of an element, mirroring the routes the menu already points at. */
export function elementHref(element) {
  if (!element || !element.table) return null;
  if (element.typeName === 'list') {
    const dataTable = resolveDataTable(element.table) || element.table;
    const isVirtual = String(resolveDataTable(element.table) || '').toLowerCase()
      !== String(element.table).toLowerCase()
      && resolveDataTable(element.table);
    // Virtual entities: prefer /virtual/:Entity; real models: /{slug}
    if (isVirtual && String(element.table) !== String(dataTable)) {
      return '/virtual/' + encodeURIComponent(element.table);
    }
    return '/' + String(dataTable).toLowerCase();
  }
  if (element.typeName === 'chart') {
    // Catalogue keys use file spelling (normalizeFileName), not digraph slugify
    const key = normalizeFileName(element.table);
    const spec = getChart(key);
    return '/chart/' + encodeURIComponent(spec?.entity || key);
  }
  if (element.typeName === 'report') {
    return '/report/' + dashSlugify(element.table);
  }
  return null;
}

/**
 * Builds the render model for one dashboard: every element in cell order,
 * with live data for the lists the user may see.
 */
export async function buildDashboardView({ prisma, req, teamWhere, canAccess, dashboard }) {
  const elements = [];
  for (const el of dashboard ? dashboard.elements : []) {
    const view = { ...el, href: elementHref(el) };
    if (el.typeName === 'list' && el.table) {
      if (canAccess && !canAccess(req, el.table, 'S')) {
        view.denied = true;
      } else {
        Object.assign(view, await fetchElementRows({ prisma, req, teamWhere, element: el }));
      }
    }
    if (el.typeName === 'chart' && el.table) {
      const spec = getChart(normalizeFileName(el.table));
      if (spec) {
        try {
          const user = req?.session?.user;
          const team = user && !user.isAdmin ? user.Team : null;
          const built = team
            ? buildChartSql(spec, { extraWhere: 'Team = ?' })
            : buildChartSql(spec);
          const params = team ? [team] : [];
          const rows = await prisma.$queryRawUnsafe(built.sql, ...params);
          const data = toChartData(spec, rows);
          // Fragment for embedding; full page stays on /chart/:name
          view.chartHtml = typeof renderChartFragment === 'function'
            ? renderChartFragment(data)
            : renderChartHtml(data);
        } catch (e) {
          view.chartError = String((e && e.message) || e);
        }
      }
    }
    if (el.typeName === 'snippet' && el.snippetId) {
      try {
        const sn = await renderSnippet(el.snippetId, makeSnippetDeps(prisma, teamWhere, req));
        if (sn) {
          view.snippetTitle = sn.title;
          view.snippetHtml = sn.html;
        }
      } catch (e) {
        view.snippetError = String((e && e.message) || e);
      }
    }
    elements.push(view);
  }
  return {
    entity: dashboard ? dashboard.entity : '',
    slug: dashboard ? dashboard.slug : '',
    elements,
    searchFields: dashboard ? dashboard.searchFields : {},
  };
}

/** Team-scoped data access for the computed dashboard snippets. */
function makeSnippetDeps(prisma, teamWhere, req) {
  const tw = (table) => (teamWhere ? teamWhere(req, {}, String(table).toLowerCase()) : {});
  return {
    count: async (table, where) => {
      const model = modelForTable(prisma, table);
      if (!model || typeof model.count !== 'function') return 0;
      try {
        return await model.count({ where: { ...where, ...tw(table) } });
      } catch { return 0; }
    },
    sum: async (table, field) => {
      const model = modelForTable(prisma, table);
      if (!model || typeof model.aggregate !== 'function') return null;
      try {
        const agg = await model.aggregate({ _sum: { [field]: true }, where: tw(table) });
        return agg && agg._sum ? agg._sum[field] : null;
      } catch { return null; }
    },
  };
}

export function createDashboardRouter({ prisma, canAccess, teamWhere }) {
  const router = Router();

  router.get('/', (req, res) => res.redirect(302, '/dashboard/heute'));

  // GET /dashboard/:slug — one page per source dashboard.
  router.get('/:slug', async (req, res) => {
    const dashboard = dashboardFor(req.params.slug);
    if (!dashboard) {
      const t = res.locals.t || ((k) => k);
      return res.status(404).send(t('unknown_dashboard') + ': ' + req.params.slug);
    }
    try {
      const view = await buildDashboardView({ prisma, req, teamWhere, canAccess, dashboard });
      const tx = res.locals.tx || ((s) => s);
      const title = dashboard.slug === 'heute' || req.params.slug === 'heute'
        ? (res.locals.t ? res.locals.t('follow_up') : 'Wiedervorlage')
        : tx(dashboard.entity.replace(/_/g, ' '));
      res.render('dashboard-page', {
        title,
        dashboard: view,
      });
    } catch (e) {
      const t = res.locals.t || ((k) => k);
      res.status(500).send(t('dashboard_error') + ': ' + e.message);
    }
  });

  return router;
}

export default createDashboardRouter;
