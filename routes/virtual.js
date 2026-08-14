import { Router } from 'express';
import { registry } from '../src/registry.js';
import { loadMeta } from '../src/meta-store.js';
import { pageFields } from '../src/meta-store.js';
import { display, fieldCategory } from '../src/formatters.js';

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function normalizeName(value) {
  return String(value || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

function findRegistryEntry(name) {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const key = Object.keys(registry).find((candidate) => {
    const meta = registry[candidate];
    return normalizeName(candidate) === wanted
      || normalizeName(meta?.entity) === wanted
      || normalizeName(meta?.model) === wanted
      || normalizeName(meta?.table) === wanted;
  });
  return key ? registry[key] : null;
}

function virtualPage(entity) {
  const slug = String(entity || '').toLowerCase();
  const meta = registry[slug] || (() => { try { return loadMeta(slug); } catch { return null; } })();
  if (!meta?.baseTable) return null;
  const baseMeta = findRegistryEntry(meta.baseTable);
  if (!baseMeta?.model) return null;
  return { slug, meta, baseMeta, baseSlug: String(baseMeta.entity || baseMeta.model).toLowerCase() };
}

async function findRows({ prisma, Model, baseMeta, fields, req, teamWhere, baseSlug }) {
  const selected = ['ID', ...fields.map((field) => field.name)]
    .filter((field, index, all) => (baseMeta.fields?.[field] || field === 'ID') && all.indexOf(field) === index);
  const select = Object.fromEntries(selected.map((field) => [field, true]));
  try {
    return await Model.findMany({ where: teamWhere(req, {}, baseSlug), select, take: 500 });
  } catch {
    const columns = selected.map(quoteIdentifier).join(', ');
    const table = quoteIdentifier(baseMeta.table || baseMeta.entity);
    const admin = req.session?.user?.isAdmin;
    const sql = admin
      ? `SELECT ${columns} FROM ${table} LIMIT 500`
      : `SELECT ${columns} FROM ${table} WHERE "Team" = ? LIMIT 500`;
    return prisma.$queryRawUnsafe(sql, ...(admin ? [] : [req.session.user.Team]));
  }
}

export default function createVirtualRouter({ prisma, canAccess, teamWhere }) {
  const router = Router();

  // PHPRunner menu links use /entity/add and /entity/edit. The Node CRUD
  // routes use /base/new and /base/:id/edit, so bridge metadata-backed pages
  // to their real model while retaining the original public URLs.
  router.get('/:entity/add', (req, res) => {
    const page = virtualPage(req.params.entity);
    if (!page) return res.status(404).render('error', { message: 'Seite nicht gefunden' });
    if (!page.meta.capabilities?.add) return res.status(404).render('error', { message: 'Hinzufügen nicht verfügbar' });
    if (!canAccess(req, page.baseSlug, 'A')) return res.status(403).render('error', { message: 'Keine Berechtigung' });
    return res.redirect(`/${page.baseSlug}/new`);
  });

  router.get('/:entity/edit', async (req, res) => {
    const page = virtualPage(req.params.entity);
    if (!page) return res.status(404).render('error', { message: 'Seite nicht gefunden' });
    if (!page.meta.capabilities?.edit) return res.status(404).render('error', { message: 'Bearbeiten nicht verfügbar' });
    if (!canAccess(req, page.baseSlug, 'E')) return res.status(403).render('error', { message: 'Keine Berechtigung' });
    const Model = prisma[page.baseMeta.model];
    const key = page.meta.keys?.[0] || 'ID';
    const row = await Model.findFirst({
      where: teamWhere(req, {}, page.baseSlug),
      select: { [key]: true },
      orderBy: { [key]: 'asc' },
    });
    if (!row) return res.status(404).render('error', { message: 'Datensatz nicht gefunden' });
    return res.redirect(`/${page.baseSlug}/${encodeURIComponent(String(row[key]))}/edit`);
  });

  router.get('/:entity/search', (req, res) => {
    const page = virtualPage(req.params.entity);
    if (!page) return res.status(404).render('error', { message: 'Seite nicht gefunden' });
    if (!page.meta.capabilities?.search) return res.status(404).render('error', { message: 'Erweiterte Suche nicht verfügbar' });
    if (!canAccess(req, page.baseSlug, 'S')) return res.status(403).render('error', { message: 'Keine Berechtigung' });
    return res.redirect(`/${page.baseSlug}/search`);
  });

  router.get('/:entity/:id/edit', (req, res) => {
    const page = virtualPage(req.params.entity);
    if (!page) return res.status(404).render('error', { message: 'Seite nicht gefunden' });
    if (!page.meta.capabilities?.edit) return res.status(404).render('error', { message: 'Bearbeiten nicht verfügbar' });
    if (!canAccess(req, page.baseSlug, 'E')) return res.status(403).render('error', { message: 'Keine Berechtigung' });
    return res.redirect(`/${page.baseSlug}/${encodeURIComponent(req.params.id)}/edit`);
  });

  router.get('/:entity/:id', (req, res) => {
    const page = virtualPage(req.params.entity);
    if (!page) return res.status(404).render('error', { message: 'Seite nicht gefunden' });
    if (!page.meta.capabilities?.view) return res.redirect(`/${page.slug}`);
    if (!canAccess(req, page.baseSlug, 'S')) return res.status(403).render('error', { message: 'Keine Berechtigung' });
    return res.redirect(`/${page.baseSlug}/${encodeURIComponent(req.params.id)}`);
  });

  router.get('/:entity', async (req, res) => {
    const slug = String(req.params.entity || '').toLowerCase();
    const page = virtualPage(slug);
    if (!page) return res.status(404).render('error', { message: 'Seite nicht gefunden' });
    const { meta, baseMeta, baseSlug } = page;
    if (!canAccess(req, baseSlug, 'S')) return res.status(403).render('error', { message: 'Keine Berechtigung' });
    const Model = baseMeta?.model ? prisma[baseMeta.model] : null;
    if (!Model) return res.status(404).render('error', { message: 'Virtuelle Quelle nicht verfügbar' });
    const physical = new Set(Object.keys(baseMeta.fields || {}));
    const fields = pageFields(meta, 'list').filter((field) => physical.has(field.name));
    const rows = await findRows({ prisma, Model, baseMeta, fields, req, teamWhere, baseSlug });
    return res.render('crud/list', { module: slug, meta: { ...meta, listColumns: fields.map((field) => field.name) }, items: rows, totalCount: rows.length, page: 1, pageSize: 500, sc: { q: '' }, error: null, helpers: { display, fieldCategory } });
  });
  return router;
}
