/**
 * Phase 6 - /chart routes.
 *
 * Replaces the 18 generated *_chart.php pages plus dchartdata.php:
 *   GET /chart              list of charts (HTML)
 *   GET /chart/catalog      same list as JSON
 *   GET /chart/:name        rendered chart (inline SVG + data table)
 *   GET /chart/:name/data   the data payload (dchartdata.php?action=refresh)
 *   GET /chart/:name/sql    the translated SQLite, for verification
 *
 * Team scoping is bound (Team = ?), never concatenated into the SQL string.
 */
import { Router } from 'express';
import {
  charts, listCharts, getChart, buildChartSql, toChartData, renderChartHtml,
} from '../src/charts/engine.js';

export default function createChartRouter({ prisma, canAccess } = {}) {
  const router = Router();

  const allowed = (req, spec) => {
    if (!canAccess) return true;
    // Rights are on real base tables (Objekte), not chart ids (Objekte_nach_Art)
    if (spec.baseTable && canAccess(req, spec.baseTable, 'S')) return true;
    if (spec.entity && canAccess(req, spec.entity, 'S')) return true;
    return false;
  };

  /** Run the chart query with the team filter bound as a parameter. */
  async function runQuery(spec, req) {
    const user = req.session?.user;
    const team = user && !user.isAdmin ? user.Team : null;
    const built = team
      ? buildChartSql(spec, { extraWhere: 'Team = ?' })
      : buildChartSql(spec);
    const params = team ? [team] : [];
    const rows = await prisma.$queryRawUnsafe(built.sql, ...params);
    return { built, rows };
  }

  router.get('/', (req, res) => {
    const items = listCharts().map((c) =>
      `<li><a href="/chart/${encodeURIComponent(c.entity)}">${c.displayName || c.entity}</a></li>`).join('');
    res.send('<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Diagramme</title></head>'
      + `<body><h1>Diagramme</h1><ul>${items}</ul></body></html>`);
  });

  router.get('/catalog', (req, res) => {
    const all = charts();
    res.json({ total: all.total, byType: all.byType, charts: listCharts() });
  });

  router.get('/:name', async (req, res) => {
    const spec = getChart(req.params.name);
    if (!spec) return res.status(404).send('Unbekanntes Diagramm: ' + req.params.name);
    if (!allowed(req, spec)) return res.status(403).send('Keine Berechtigung');
    try {
      const { rows } = await runQuery(spec, req);
      const data = toChartData(spec, rows);
      res.send(renderChartHtml(data));
    } catch (e) {
      res.status(500).send('Diagramm fehlgeschlagen: ' + e.message);
    }
  });

  // dchartdata.php?action=refresh equivalent
  router.get('/:name/data', async (req, res) => {
    const spec = getChart(req.params.name);
    if (!spec) return res.status(404).json({ error: 'Unbekanntes Diagramm: ' + req.params.name });
    if (!allowed(req, spec)) return res.status(403).json({ error: 'Keine Berechtigung' });
    try {
      const { rows } = await runQuery(spec, req);
      const data = toChartData(spec, rows);
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // The translated query, so every chart can be verified against the source SQL.
  router.get('/:name/sql', (req, res) => {
    const spec = getChart(req.params.name);
    if (!spec) return res.status(404).json({ error: 'Unbekanntes Diagramm: ' + req.params.name });
    const built = buildChartSql(spec);
    res.json({ sql: built.sql, notes: built.notes || [], unsupported: built.unsupported || [] });
  });

  return router;
}
