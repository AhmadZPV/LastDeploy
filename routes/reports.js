/**
 * Phase 5 - /report routes.
 *
 * One metadata-driven engine standing in for the 36 generated *_report.php
 * pages (classes/reportpage.php):
 *   GET /report/:entity                       grouped report (?group=&measure=&agg=)
 *   GET /report/:entity/crosstab              pivot (?row=&col=&measure=&agg=)
 *
 * Aggregations run on raw values; formatting happens at render time so the
 * German thousands separator never poisons a sum. Gated on the 'P' right,
 * like the printable pages of the source.
 */
import { Router } from 'express';
import { loadMeta, pageFields, fieldLabel } from '../src/meta-store.js';
import { fetchPageRows } from '../src/page-query.js';
import {
  aggregate, buildGrouped, buildCrosstab, numericColumns,
} from '../src/reports/engine.js';
import { formatCell } from '../src/exporters/index.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title, bodyHtml) {
  return '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
    + `<title>${esc(title)}</title>`
    + '<style>body{font-family:Arial,sans-serif}table{border-collapse:collapse}'
    + 'th,td{border:1px solid #666;padding:2px 6px}th{background:#ddd}'
    + 'tr.total{font-weight:bold;background:#f2f2f2}</style></head><body>'
    + `<h1>${esc(title)}</h1>` + bodyHtml + '</body></html>';
}

export default function createReportRouter({ prisma, canAccess, teamWhere } = {}) {
  const router = Router();

  async function loadRows(req, entity) {
    const meta = loadMeta(entity);
    if (!meta) return { error: { code: 404, message: 'Unbekannter Bericht: ' + entity } };
    const slug = String(entity).toLowerCase();
    if (canAccess && !canAccess(req, slug, 'P')) {
      return { error: { code: 403, message: 'Keine Bericht-Berechtigung für ' + entity } };
    }
    const where = teamWhere ? teamWhere(req, {}, slug) : {};
    let fields = pageFields(meta, 'report');
    if (!fields.length) fields = pageFields(meta, 'list');
    const { columns, rows } = await fetchPageRows({
      entity, kind: fields.length ? 'report' : 'list', prisma, where,
    });
    const usable = columns.length ? columns : fields.map((f) => ({ meta: f, prismaField: f.name }));
    return { meta, columns: usable, rows };
  }

  router.get('/:entity/crosstab', async (req, res) => {
    try {
      const { meta, rows, error } = await loadRows(req, req.params.entity);
      if (error) return res.status(error.code).render('error', { message: error.message });

      const rowField = req.query.row;
      const colField = req.query.col;
      const measure = req.query.measure;
      const agg = String(req.query.agg || 'sum');
      if (!rowField || !colField || !measure) {
        return res.status(400).render('error', {
          message: 'row, col und measure sind Pflichtparameter',
        });
      }

      const cross = buildCrosstab(rows, rowField, colField, measure, agg);
      const head = ['<th>' + esc(fieldLabel(meta, rowField)) + '</th>',
        ...cross.colKeys.map((c) => '<th>' + esc(c) + '</th>'),
        '<th>Summe</th>'].join('');
      const body = cross.matrix.map((m) =>
        '<tr><td>' + esc(m.key) + '</td>'
        + m.cells.map((c) => '<td>' + (c == null ? '' : esc(formatCell(c))) + '</td>').join('')
        + '<td>' + esc(formatCell(m.total)) + '</td></tr>').join('\n');
      const foot = '<tr class="total"><td>Summe</td>'
        + cross.colTotals.map((c) => '<td>' + esc(formatCell(c)) + '</td>').join('')
        + '<td>' + esc(formatCell(cross.grand)) + '</td></tr>';

      res.send(page(
        (meta.entity || req.params.entity) + ' (Kreuztabelle)',
        `<table><thead><tr>${head}</tr></thead><tbody>${body}\n${foot}</tbody></table>`,
      ));
    } catch (e) {
      res.status(500).render('error', { message: 'Bericht fehlgeschlagen: ' + e.message });
    }
  });

  router.get('/:entity', async (req, res) => {
    try {
      const { meta, columns, rows, error } = await loadRows(req, req.params.entity);
      if (error) return res.status(error.code).render('error', { message: error.message });

      const group = req.query.group;
      const agg = String(req.query.agg || 'sum');
      const measures = req.query.measure
        ? [String(req.query.measure)]
        : numericColumns(columns, rows).map((c) => c.prismaField);

      if (!group) {
        // flat report: the plain table, no grouping requested
        const head = columns.map((c) => '<th>' + esc(fieldLabel(meta, c.meta)) + '</th>').join('');
        const body = rows.map((r) =>
          '<tr>' + columns.map((c) => '<td>' + esc(formatCell(r[c.prismaField], c.meta)) + '</td>').join('')
          + '</tr>').join('\n');
        return res.send(page(meta.entity || req.params.entity,
          `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`));
      }

      const grouped = buildGrouped(rows, [group], measures, agg);
      const head = ['<th>' + esc(fieldLabel(meta, group)) + '</th>',
        ...measures.map((m) => '<th>' + esc(fieldLabel(meta, m)) + '</th>')].join('');
      const body = grouped.groups.map((g) =>
        '<tr><td>' + esc(g.key) + '</td>'
        + measures.map((m) => '<td>' + (g.totals[m] == null ? '' : esc(formatCell(g.totals[m]))) + '</td>').join('')
        + '</tr>').join('\n');
      const foot = '<tr class="total"><td>Summe</td>'
        + measures.map((m) => '<td>' + esc(formatCell(grouped.totals[m])) + '</td>').join('')
        + '</tr>';

      res.send(page(meta.entity || req.params.entity,
        `<table><thead><tr>${head}</tr></thead><tbody>${body}\n${foot}</tbody></table>`));
    } catch (e) {
      res.status(500).render('error', { message: 'Bericht fehlgeschlagen: ' + e.message });
    }
  });

  return router;
}

export { aggregate, buildGrouped, buildCrosstab, numericColumns };
