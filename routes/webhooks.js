import { Router } from 'express';
import { dispatchWebhook } from '../src/webhooks.js';

export default function createWebhookRouter({ prisma, canAccess, teamWhere }) {
  const router = Router();
  router.post('/:entity/:id', async (req, res) => {
    const entity = req.params.entity;
    if (!canAccess(req, entity, 'S')) return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    const meta = req.app.locals.registry?.[entity] || null;
    const model = meta?.model ? prisma[meta.model] : prisma[String(entity).toLowerCase()];
    if (!model) return res.status(404).json({ success: false, error: 'Unbekannte Entität' });
    const row = await model.findFirst({ where: teamWhere(req, { ID: Number(req.params.id) }, entity) });
    if (!row) return res.status(404).json({ success: false, error: 'Datensatz nicht gefunden' });
    try { return res.json({ success: true, ...(await dispatchWebhook({ prisma, entity, record: row, req })) }); }
    catch (error) { return res.status(502).json({ success: false, error: error.message }); }
  });
  return router;
}
