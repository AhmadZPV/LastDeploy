/**
 * Phase 4 - export routes.
 *
 * Replaces all 85 generated *_export.php pages with one metadata-driven route.
 *
 *   GET /export/:entity            -> uses the entity's own `.exportTo` default
 *   GET /export/:entity/:format    -> csv | excel | word | xml | pdf
 *
 * Query params mirror the PHP export page:
 *   ?keys=1,2,3      export only the selected records
 *   ?all=1           ignore the page-size limit
 *   ?delimiter=;     override the entity's `.exportDelimiter`
 *   ?raw=1           bypass German formatting, emit raw values
 *   ?fields=a,b      restrict to a subset of the export fields
 */
import express from 'express';
import { loadMeta, fieldLabel, pageFields } from '../src/meta-store.js';
import { fetchPageRows } from '../src/page-query.js';
import { FORMATS, formatCell } from '../src/exporters/index.js';

/** Accepts 1/true/yes/on, the shapes a PHP query string may arrive in. */
export function isTruthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'no' && s !== 'off';
}

/** Unlocalised value used when `?raw=1` or `.exportFormatting` is off. */
export function rawCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object' && typeof value.toNumber === 'function') return String(value.toNumber());
  return String(value);
}

/**
 * Decide the row cap for an export request.
 * `?all=1` or an explicit key selection lifts the cap; otherwise the entity's
 * own page size applies. Returns null for "no limit".
 */
export function exportTake(meta, query = {}, keys = null) {
  const pageSize = Number(meta?.pageSize) || Number(meta?.list?.pageSize) || 0;
  const uncapped = isTruthy(query.all) || (keys && keys.length > 0);
  return uncapped || pageSize <= 0 ? null : pageSize;
}

const DEFAULT_FORMAT = {
  excel: 'excel', word: 'word', xml: 'xml', pdf: 'pdf', csv: 'csv',
};

export default function createExportRouter({ prisma, canAccess, teamWhere }) {
  const router = express.Router();

  router.get('/:entity/:format?', async (req, res) => {
    const slug = req.params.entity;
    const meta = loadMeta(slug);
    if (!meta) return res.status(404).render('error', { message: 'Unbekannte Tabelle: ' + slug });

    // PHPRunner guards exports with the same rights mask as the list page,
    // plus 'P' for the printable/PDF variants.
    const needed = req.params.format === 'pdf' ? 'SP' : 'S';
    if (canAccess && !canAccess(req, slug, needed)) {
      return res.status(403).render('error', { message: (res.locals?.t ? res.locals.t('no_export_permission') : 'Keine Export-Berechtigung') + ': ' + slug });
    }

    const declared = String(meta.export?.exportTo || '').toLowerCase();
    const format = (req.params.format || DEFAULT_FORMAT[declared] || 'excel').toLowerCase();
    const writer = FORMATS[format];
    if (!writer) {
      return res.status(400).render('error', { message: 'Unbekanntes Exportformat: ' + format });
    }

    try {
      const keys = req.query.keys
        ? String(req.query.keys).split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      const where = teamWhere ? teamWhere(req, {}, slug.toLowerCase()) : {};
      // `?all=1` lifts the page-size cap, exactly like the PHP export page.
      // Selecting explicit keys also implies "export just those", uncapped.
      const take = exportTake(meta, req.query, keys);

      const { columns, rows } = await fetchPageRows({
        entity: slug, kind: 'export', prisma, where, keys, take,
      });

      const exportFields = pageFields(meta, 'export');
      let usable = columns.length ? columns : exportFields.map((f) => ({ meta: f, prismaField: f.name }));

      // `?fields=` narrows the column set; unknown names are ignored rather
      // than erroring, matching the tolerant behaviour of the PHP page.
      if (req.query.fields) {
        const wanted = String(req.query.fields).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
        const picked = usable.filter((c) => wanted.includes(String(c.prismaField).toLowerCase()));
        if (picked.length) usable = picked;
      }

      // `.exportFormatting` decides whether values are localised; `?raw=1`
      // forces the unformatted value, which is what round-tripping needs.
      const raw = isTruthy(req.query.raw) || meta.export?.exportFormatting === 0;
      const cell = (value, field) => (raw ? rawCell(value) : formatCell(value, field));

      const headers = usable.map((c) => ({
        key: c.prismaField, label: fieldLabel(meta, c.meta, res.locals?.lang),
      }));
      const table = {
        title: slug,
        headers,
        rows: rows.map((r) => {
          const out = {};
          for (const c of usable) out[c.prismaField] = cell(r[c.prismaField], c.meta);
          return out;
        }),
      };

      const options = {
        delimiter: req.query.delimiter || meta.export?.exportDelimiter || ';',
        orientation: (meta.print?.printerPageOrientation === 1 ||
          meta.print?.printerPageOrientation === 'portrait') ? 'portrait' : 'landscape',
      };
      await writer(res, table, options);
    } catch (e) {
      if (!res.headersSent) {
        res.status(500).render('error', { message: 'Export fehlgeschlagen: ' + e.message });
      } else {
        res.end();
      }
    }
  });

  return router;
}
