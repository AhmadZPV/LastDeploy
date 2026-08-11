/**
 * Phase 3 - /buttonhandler route.
 *
 * Keeps the original contract of buttonhandler.php:
 *   POST /buttonhandler          { buttId, table, keys, params } -> JSON result
 *   GET  /buttonhandler/catalog  coverage report of the port
 *   GET  /buttonhandler/:buttId/file  file output (vCard/iCal) as a download
 *
 * Access mirrors the PHP preamble: the caller needs the 'S' right on the
 * table the button belongs to. JSON 403 instead of the HTML error page,
 * because the original answered my_json_encode() too.
 */
import { Router } from 'express';
import { runHandler, listHandlers, ops } from '../src/button-handlers/runtime.js';

export default function createButtonHandlerRouter({ prisma, canAccess, teamWhere } = {}) {
  const router = Router();

  // Coverage catalogue: every buttId, its op, and what is still missing.
  router.get('/catalog', (req, res) => {
    const o = ops();
    res.json({
      total: o.total,
      automated: o.automated,
      manual: o.manual,
      unrecognised: o.unrecognised,
      handlers: listHandlers(),
      unrecognisedSamples: o.unrecognisedSamples,
    });
  });

  // The dispatch endpoint, same shape as the PHP original.
  router.post('/', async (req, res) => {
    const body = req.body || {};
    const buttId = body.buttId;
    const table = body.table;
    const keys = Array.isArray(body.keys) ? body.keys : (body.keys ? [body.keys] : []);
    const params = body.params || {};

    if (!buttId) return res.status(400).json({ success: false, error: 'buttId fehlt' });

    if (table && canAccess && !canAccess(req, table, 'S')) {
      return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    }

    const out = await runHandler({
      buttId, entity: table, keys, params, prisma, req, teamWhere,
    });

    if (out.body !== undefined && out.contentType) {
      res.setHeader('Content-Type', out.contentType);
      if (out.filename) {
        res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
      }
      return res.status(out.status || 200).send(out.body);
    }
    return res.status(out.status || 200).json(out.result);
  });

  // Direct file download for the vCard/iCal handlers.
  router.get('/:buttId/file', async (req, res) => {
    const keys = req.query.keys
      ? String(req.query.keys).split(',').filter(Boolean)
      : (req.query.key1 ? [req.query.key1] : []);
    const table = req.query.table;

    if (table && canAccess && !canAccess(req, table, 'S')) {
      return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    }

    const out = await runHandler({
      buttId: req.params.buttId, entity: table, keys, prisma, req, teamWhere,
    });
    if (out.body !== undefined && out.contentType) {
      res.setHeader('Content-Type', out.contentType);
      if (out.filename) {
        res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
      }
      return res.status(out.status || 200).send(out.body);
    }
    return res.status(out.status || 404).json(out.result);
  });

  return router;
}
