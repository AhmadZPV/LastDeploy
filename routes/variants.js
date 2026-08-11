import { Router } from 'express';
import { registry } from '../src/registry.js';
import { loadMeta } from '../src/meta-store.js';
import { fieldCategory, display, coerce } from '../src/formatters.js';

function modelFor(prisma, meta) { return meta?.model ? (prisma[meta.model] || prisma[String(meta.model).toLowerCase()]) : null; }

function variantEntity(name, suffix) {
  const wanted = `${name}_${suffix}`.toLowerCase();
  return Object.keys(registry).find((key) => key.toLowerCase() === wanted) || `${name}_${suffix}`;
}

function dateRange(kind, now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (kind === 'week') {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    const end = new Date(start); end.setDate(end.getDate() + 7); return { gte: start, lt: end };
  }
  if (kind === 'month') {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1); return { gte: new Date(start.getFullYear(), start.getMonth(), 1), lt: end };
  }
  const end = new Date(start); end.setDate(end.getDate() + 1); return { gte: start, lt: end };
}

export function createVariantRouter({ prisma, canAccess, teamWhere }) {
  const router = Router();

  for (const base of ['adressen', 'einheiten', 'objekte', 'vertraege']) {
    const slug = variantEntity(base, 'Historie');
    router.get('/history/' + base, async (req, res) => {
      if (!canAccess(req, base, 'S')) return res.status(403).render('error', { message: 'Keine Berechtigung' });
      const meta = registry[slug] || registry[base]; const Model = modelFor(prisma, meta);
      if (!Model) return res.status(404).render('error', { message: 'Historie nicht verfügbar' });
      const rows = await Model.findMany({ where: teamWhere(req, {}, slug), orderBy: { ID: 'desc' }, take: 500 });
      return res.render('variants/list', { title: `${base} Historie`, module: slug, meta, rows, helpers: { display, fieldCategory } });
    });
  }

  for (const [path, kind] of [['today', 'today'], ['week', 'week'], ['month', 'month']]) {
    router.get('/calendar/' + path, async (req, res) => {
      if (!canAccess(req, 'termine', 'S')) return res.status(403).render('error', { message: 'Keine Berechtigung' });
      const meta = registry.termine; const Model = modelFor(prisma, meta);
      const rows = await Model.findMany({ where: { ...teamWhere(req, {}, 'termine'), Datum: dateRange(kind) }, orderBy: { Datum: 'asc' }, take: 1000 });
      res.render('variants/list', { title: `Termine: ${path}`, module: 'termine', meta, rows, helpers: { display, fieldCategory } });
    });
  }

  for (const base of ['adressen', 'inventar']) {
    router.post('/batch/' + base, async (req, res) => {
      if (!canAccess(req, base, 'E')) return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
      const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids]).map(Number).filter(Number.isFinite);
      const meta = registry[base]; const Model = modelFor(prisma, meta); const data = {};
      for (const [field, value] of Object.entries(req.body.fields || {})) if (meta.fields?.[field]) data[field] = coerce(base, field, value);
      if (!Object.keys(data).length) return res.status(400).json({ success: false, error: 'Keine Felder' });
      let updated = 0;
      for (const id of ids) {
        const row = await Model.findFirst({ where: teamWhere(req, { ID: id }, base), select: { ID: true } });
        if (row) { await Model.update({ where: { ID: row.ID }, data }); updated += 1; }
      }
      res.json({ success: true, updated });
    });
  }
  return router;
}

export { dateRange };
