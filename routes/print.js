/**
 * Phase 5 - /print routes.
 *
 * One metadata-driven route standing in for the 80 generated *_print.php
 * pages and buildpdf.php:
 *   GET /print/:entity        printable HTML (honours the entity's page setup)
 *   GET /print/:entity/pdf    server-side PDF
 *
 * ?keys=1,2,3 prints only the selected records, like the PHP print page.
 * Print is gated on the 'P' right, mirroring CheckSecurity(..., "Print").
 */
import { Router } from 'express';
import { loadMeta, pageFields } from '../src/meta-store.js';
import { fetchPageRows } from '../src/page-query.js';
import {
  printOptions, buildPrintTable, renderPrintHtml, paginate,
} from '../src/print/renderer.js';
import { FORMATS, formatCell } from '../src/exporters/index.js';

export default function createPrintRouter({ prisma, canAccess, teamWhere } = {}) {
  const router = Router();

  async function buildTable(req, entity) {
    const meta = loadMeta(entity);
    if (!meta) return { error: { code: 404, message: 'Unbekannte Tabelle: ' + entity } };

    const slug = String(entity).toLowerCase();
    if (canAccess && !canAccess(req, slug, 'P')) {
      return { error: { code: 403, message: 'Keine Druck-Berechtigung für ' + entity } };
    }

    const keys = req.query.keys
      ? String(req.query.keys).split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    const where = teamWhere ? teamWhere(req, {}, slug) : {};

    // the print field set first, the list set as the generic fallback
    let fields = pageFields(meta, 'print');
    if (!fields.length) fields = pageFields(meta, 'list');

    const { columns, rows } = await fetchPageRows({
      entity, kind: fields.length ? 'print' : 'list', prisma, where, keys,
    });
    const usable = columns.length
      ? columns
      : fields.map((f) => ({ meta: f, prismaField: f.name }));

    return { meta, table: buildPrintTable(meta, usable, rows, meta.entity || entity) };
  }

  router.get('/:entity', async (req, res) => {
    try {
      const { meta, table, error } = await buildTable(req, req.params.entity);
      if (error) return res.status(error.code).render('error', { message: error.message });
      const opts = printOptions(meta);
      res.send(renderPrintHtml(table, opts));
    } catch (e) {
      res.status(500).render('error', { message: 'Druck fehlgeschlagen: ' + e.message });
    }
  });

  // buildpdf.php equivalent: same table, emitted as a real PDF.
  router.get('/:entity/pdf', async (req, res) => {
    try {
      const { meta, table, error } = await buildTable(req, req.params.entity);
      if (error) return res.status(error.code).render('error', { message: error.message });
      const opts = printOptions(meta);
      const grid = {
        title: table.title,
        headers: table.headers,
        rows: table.rows.map((cells) => {
          const out = {};
          table.headers.forEach((h, i) => { out[h.key] = formatCell(cells[i]); });
          return out;
        }),
      };
      await FORMATS.pdf(res, grid, { orientation: opts.orientation });
    } catch (e) {
      if (!res.headersSent) {
        res.status(500).render('error', { message: 'PDF fehlgeschlagen: ' + e.message });
      } else {
        res.end();
      }
    }
  });

  return router;
}

export { paginate };
