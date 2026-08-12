import { Router } from 'express';
import { prisma, teamWhere, canAccess } from '../server.js';
import { registry } from '../src/registry.js';
import {
  fieldCategory, display, coerce, toNum, inputDate, fmtNum
} from '../src/formatters.js';
import { runHook } from '../src/events/runtime.js';
import { hashPasswordFields } from '../src/auth/password-guard.js';
import { auditLog } from '../src/audit.js';
import { acquireLock, releaseLock } from '../src/locking.js';
import {
  relationsForPage, findRelation, childWhere, detailDelegate, childCounts
} from '../src/master-detail.js';

const safe = (p, fb) => (p?.catch ? p.catch(() => fb) : p);

// Skip these technical fields in generic views/exports (BLOBs handled separately).
const SKIP_DISPLAY = new Set([]); // we keep everything; blobs are rendered as [BLOB]

import { parseSearchRequest, buildSearchWhere, fieldSearchSpec } from '../src/search-ops.js';
import { manifestFor, formSpec, viewSpec, validateSubmission } from '../src/form-builder.js';
import { recordValuesFromBody } from '../src/record-payload.js';

export default function createCrudRouter(name, meta) {
  const router = Router();
  const Model = prisma[meta.model];
  if (!Model) {
    router.all('*', (req, res) => res.status(404).send('Model ' + meta.model + ' not found in Prisma'));
    return router;
  }
  const ent = String(name || '').toLowerCase();

  // Per-action AccessMask gate. Admin bypasses via canAccess. Letters follow
  // the PHPRunner mask: S=list/search/view, A=create, E=update, D=delete.
  function gate(letter) {
    return (req, res, next) => {
      const u = req.session?.user;
      if (!u) return res.redirect('/login');
      if (u.isAdmin) return next();
      const mask = (u.rights?.[ent] || '').toUpperCase();
      if (!mask) return res.status(403).render('error', { message: (res.locals?.t ? res.locals.t('no_permission_table', { name }) : 'Keine Berechtigung für ' + name) });
      if (!mask.includes(letter.toUpperCase())) {
        return res.status(403).render('error', { message: (res.locals?.t ? res.locals.t('no_letter_permission', { letter, name }) : 'Keine ' + letter + '-Berechtigung für ' + name) });
      }
      next();
    };
  }

  // Persisted SearchClause: GET list/export/print shares search state via session.
  function getSearchClause(req) {
    req.session.sc = req.session.sc || {};
    return (req.session.sc[name] = req.session.sc[name] || { q: '', filters: {} });
  }

  // Build a Prisma `where` from search string + AdvancedSearch state.
  function buildWhere(req, sc) {
    sc = sc || getSearchClause(req);
    const extra = teamWhere(req, {}, name);
    // q: contains-OR over searchFields
    const or = [];
    if (sc.q) {
      for (const f of (meta.searchFields || [])) {
        const fi = meta.fields?.[f] || {};
        if (fi.type === 'Int' || /^Int$/.test(fi.type)) {
          const n = Number(sc.q);
          if (!isNaN(n)) or.push({ [f]: n });
        } else if (fi.type === 'String' || fi.type === undefined) {
          or.push({ [f]: { contains: sc.q } });
        }
      }
    }
    // advanced field filters (k-v where v non-empty)
    const filterWhere = {};
    const opFilters = {};
    for (const [k, v] of Object.entries(sc.filters || {})) {
      if (v == null || v === '') continue;
      if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
          && (v.option !== undefined || v.value !== undefined) && !v.from && !v.to) {
        opFilters[k] = v;
        continue;
      }
      const cat = fieldCategory(name, k);
      if (cat === 'date' && v.from) filterWhere[k] = { gte: new Date(v.from) };
      else if (cat === 'date' && v.to) filterWhere[k] = { lte: new Date(v.to) };
      else if (cat === 'bool') filterWhere[k] = v === '1' ? 1 : 0;
      else if (cat === 'lookup') filterWhere[k] = Number(v);
      else if (cat === 'money') filterWhere[k] = Number(String(v).replace(',', '.'));
      else filterWhere[k] = { contains: v };
    }
    const typeOf = (f) => meta.fields?.[f]?.type;
    const opWhere = buildSearchWhere(parseSearchRequest(opFilters, name, typeOf));
    const where = { ...extra };
    if (or.length) where.OR = or;
    Object.assign(where, filterWhere);
    for (const [k, v] of Object.entries(opWhere)) {
      if (k === 'AND' || k === 'OR') where[k] = (where[k] || []).concat(v);
      else where[k] = v;
    }
    return where;
  }

  async function loadLookups(req) {
    const lookups = {};
    for (const [fk, targetName] of Object.entries(meta.lookupFields || {})) {
      const tm = registry[targetName];
      const TModel = prisma[tm?.model];
      if (!TModel) { lookups[fk] = []; continue; }
      try {
        lookups[fk] = await TModel.findMany({
          where: teamWhere(req, {}, targetName),
          select: idDisplaySelect(tm),
          orderBy: { ID: 'asc' },
          take: 500
        });
      } catch { lookups[fk] = []; }
    }
    return lookups;
  }

  function idDisplaySelect(tm) {
    // returned to lookups: include ID + display fields
    const s = { ID: true };
    for (const f of ['Bezeichnung', 'Kurzname', 'Vorname', 'Nachname', 'Name', 'Nummer', 'Titel']) {
      if (tm?.fields?.[f]) s[f] = true;
    }
    if (Object.keys(s).length === 1) s.ID = true;
    return s;
  }

  // ------------------------------------------------------------------
  // Master/detail (port of the 39 *_detailspreview.php pages)
  //
  // The parent/child link now comes from src/meta/relations.json (102 real
  // relations lifted out of include/*_settings.php) instead of guessing a
  // foreign-key name from the table name.
  // ------------------------------------------------------------------

  const PREVIEW_ROWS = 10;

  // Load one relation's child rows, honouring team scope and S-access on the
  // CHILD entity (a user who may not see Buchungen must not see them nested
  // under an Objekt either).
  async function loadDetail(req, relation, parentRow, { take = PREVIEW_ROWS } = {}) {
    const delegate = detailDelegate(prisma, relation);
    const link = childWhere(relation, parentRow);
    if (!delegate || !link) return { rows: [], total: 0, columns: [], denied: false };

    if (!canAccess(req, relation.detailSlug, 'S')) {
      return { rows: [], total: 0, columns: [], denied: true };
    }

    const where = teamWhere(req, link, relation.detailSlug);
    const [rows, total] = await Promise.all([
      safe(delegate.findMany({ where, orderBy: { ID: 'asc' }, take }), []),
      safe(delegate.count({ where }), 0),
    ]);
    return { rows: rows || [], total: total || 0, columns: detailColumns(relation, rows || []), denied: false };
  }

  // Columns to show: the child entity's own list columns when we have them,
  // otherwise whatever scalar keys the rows actually carry.
  function detailColumns(relation, rows) {
    const cm = registry[relation.detailSlug];
    const declared = (cm?.listColumns || []).filter((column) => column && column !== 'ID');
    if (declared.length) return declared.slice(0, 6);
    const first = rows[0];
    if (!first) return [];
    return Object.keys(first)
      .filter((k) => k !== 'ID' && (first[k] === null || typeof first[k] !== 'object'))
      .slice(0, 6);
  }

  // AJAX fragment for a single relation.
  router.get('/detailspreview', gate('S'), async (req, res) => {
    const relation = findRelation(name, req.query.child);
    if (!relation) return res.json({ success: false, error: 'unknown child' });

    const masterId = req.query.masterkey;
    let parentRow = null;
    try {
      parentRow = await Model.findFirst({ where: teamWhere(req, { ID: Number(masterId) }, name) });
    } catch { parentRow = null; }
    if (!parentRow) return res.json({ success: false, error: 'unknown master' });

    try {
      const take = req.query.all ? undefined : PREVIEW_ROWS;
      const detail = await loadDetail(req, relation, parentRow, { take });
      if (detail.denied) return res.status(403).json({ success: false, error: 'no access' });
      res.render('crud/detailspreview', {
        relation, rows: detail.rows, total: detail.total,
        columns: detail.columns, master: name, masterId,
        helpers: { display, fieldCategory },
      }, (err, body) => {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true, body, counter: detail.total });
      });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // Machine-readable catalogue of this entity's relations.
  router.get('/relations', gate('S'), (req, res) => {
    res.json({ master: name, relations: relationsForPage(name, req.query.kind || 'view') });
  });

  // LIST
  router.get('/', gate('S'), async (req, res) => {
    const sc = getSearchClause(req);
    if (req.query.q !== undefined) sc.q = req.query.q;
    if (req.query.page) sc.page = Math.max(1, +req.query.page); else sc.page = sc.page || 1;
    if (req.query.sortBy) sc.sortBy = req.query.sortBy;
    if (req.query.sortDir) sc.sortDir = req.query.sortDir;
    const pageSize = 50;
    const where = buildWhere(req, sc);
    try {
      const orderBy = sc.sortBy
        ? { [sc.sortBy]: (sc.sortDir === 'desc' ? 'desc' : 'asc') }
        : { ID: 'desc' };
      const [rows, total] = await Promise.all([
        Model.findMany({ where, orderBy, skip: (sc.page - 1) * pageSize, take: pageSize }),
        Model.count({ where })
      ]);
      // child counters the original showed in the list (dispChildCount)
      const counts = await safe(childCounts({
        prisma, master: name, rows, kind: 'list',
        scope: (w, detailSlug) =>
          (canAccess(req, detailSlug, 'S') ? teamWhere(req, w, detailSlug) : w),
      }), {});
      res.render('crud/list', {
        items: rows, module: name, meta, registry, totalCount: total,
        page: sc.page, pageSize, sc, q: sc.q, childCounts: counts,
        relations: relationsForPage(name, 'list').filter((r) => r.dispChildCount),
        lookups: {}, helpers: { display, fieldCategory }, error: null
      });
    } catch (e) {
      res.status(500).render('error', { message: (res.locals?.t ? res.locals.t('list_error') : 'List error') + ': ' + e.message });
    }
  });

  router.get('/search', gate('S'), async (req, res) => {
    const sc = getSearchClause(req);
    const lookups = await loadLookups(req);
    res.render('crud/search', { module: name, meta, registry, sc, lookups,
    helpers: { fieldCategory, searchSpec: (f) => fieldSearchSpec(name, f, meta.fields?.[f]?.type) } });
  });

  router.post('/search', gate('S'), async (req, res) => {
    const sc = getSearchClause(req);
    sc.q = (req.body.q || '').trim();
    sc.filters = {};
    const ops = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (k.endsWith('__op') && v) ops[k.slice(0, -4)] = v;
    }
    for (const [k, v] of Object.entries(req.body)) {
      if (k === 'q' || k === '_method' || v === '' || v === undefined) continue;
      if (k.endsWith('__op')) continue;
      if (k.endsWith('_from')) {
        const base = k.slice(0, -5);
        sc.filters[base] = sc.filters[base] || {};
        sc.filters[base].from = v;
      } else if (k.endsWith('_to')) {
        const base = k.slice(0, -3);
        sc.filters[base] = sc.filters[base] || {};
        sc.filters[base].to = v;
      } else if (ops[k]) {
        sc.filters[k] = { option: ops[k], value: v };
      } else {
        sc.filters[k] = v;
      }
    }
    sc.page = 1;
    res.redirect('/' + name);
  });

  // CSV export
  router.get('/export.csv', gate('S'), async (req, res) => {
    try {
      const sc = getSearchClause(req);
      const where = buildWhere(req, sc);
      const rows = await Model.findMany({ where, orderBy: { ID: 'asc' }, take: 5000 });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      const cols = meta.listColumns || [];
      const head = ['ID', ...cols];
      const esc = (v) => {
        if (v == null) return '';
        const n = typeof v === 'object' && 'toNumber' in v ? v.toNumber() : v;
        const str = String(n);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const lines = [head.join(',')];
      for (const r of rows) lines.push([r.ID, ...cols.map(c => esc(display(name, c, r[c])))].join(','));
      res.send('\ufeff' + lines.join('\n'));
    } catch (e) {
      res.status(500).render('error', { message: (res.locals?.t ? res.locals.t('export_error') : 'Export error') + ': ' + e.message });
    }
  });

  // NEW (must precede /:id)
  router.get('/new', gate('A'), async (req, res) => {
    const lookups = await loadLookups(req);
    const manifest = manifestFor(name);
    res.render('crud/form', {
      item: {}, module: name, meta, registry, lookups, isEdit: false,
      spec: manifest ? formSpec(manifest, manifest.entity || name, 'add', res.locals?.lang) : null,
      helpers: { fieldCategory, inputDate, fmtNum, coerce }, error: null
    });
  });

  // EDIT (must precede /:id)
  router.get('/:id/edit', gate('E'), async (req, res) => {
    try {
      const item = await Model.findFirst({ where: teamWhere(req, { ID: +req.params.id }, name) });
      if (!item) return res.status(404).render('error', { message: (res.locals?.t ? res.locals.t('not_found') : 'Nicht gefunden') });
      const lookups = await loadLookups(req);
      const manifest = manifestFor(name);
      // Phase 10: record locking — opening the edit page takes the lock, and a
      // fresh foreign lock is shown instead of silently allowing a conflict.
      const lock = await acquireLock({
        prisma, table: name, keys: { ID: +req.params.id },
        sessionId: req.sessionID || req.session?.id || '',
        userId: req.session?.user?.Benutzername || '',
      });
      res.render('crud/form', {
        item, module: name, meta, registry, lookups, isEdit: true,
        spec: manifest ? formSpec(manifest, manifest.entity || name, 'edit', res.locals?.lang) : null,
        helpers: { fieldCategory, inputDate, fmtNum, coerce },
        lock, error: lock.locked && !lock.own
          ? 'Gesperrt durch ' + (lock.by || '?') : null
      });
    } catch (e) {
      res.status(500).render('error', { message: (res.locals?.t ? res.locals.t('edit_error') : 'Edit error') + ': ' + e.message });
    }
  });

  // VIEW
  router.get('/:id', gate('S'), async (req, res) => {
    try {
      const item = await Model.findFirst({ where: teamWhere(req, { ID: +req.params.id }, name) });
      if (!item) return res.status(404).render('error', { message: (res.locals?.t ? res.locals.t('not_found') : 'Nicht gefunden') });
      // master/detail previews the original showed under the record
      const details = [];
      for (const relation of relationsForPage(name, 'view')) {
        const d = await loadDetail(req, relation, item);
        if (d.denied) continue;
        if (relation.hideChild && !d.total) continue;
        details.push({ relation, ...d });
      }
      const manifest = manifestFor(name);
      res.render('crud/view', {
        item, module: name, meta, registry, details,
        vspec: manifest ? viewSpec(manifest, manifest.entity || name, res.locals?.lang) : null,
        helpers: { display, fieldCategory },
      });
    } catch (e) {
      res.status(500).render('error', { message: (res.locals?.t ? res.locals.t('view_error') : 'View error') + ': ' + e.message });
    }
  });

  // CREATE (was the original NEW position)
  router.post('/', gate('A'), async (req, res) => {
    try {
      const data = recordValuesFromBody(req.body, {
        entity: name,
        fields: meta.fields,
        coerce: (entity, field, raw) => coerce(entity, field, raw),
        isEdit: false,
        isAdmin: req.session?.user?.isAdmin === true,
      });
      // BLOB uploads
      for (const f of req.files || []) {
        if (meta.fields?.[f.fieldname]) {
          data[f.fieldname] = Buffer.from(f.buffer);
        }
      }
      // required validation from the manifest (IsRequired, add page only)
      const manifest = manifestFor(name);
      const submitted = { ...req.body };
      for (const f of req.files || []) submitted[f.fieldname] = submitted[f.fieldname] || 'file';
      const check = validateSubmission(manifest, name, 'add', submitted);
      if (!check.ok) {
        const lookups = await loadLookups(req);
        return res.render('crud/form', {
          item: req.body, module: name, meta, registry, lookups, isEdit: false,
          spec: manifest ? formSpec(manifest, manifest.entity || name, 'add', res.locals?.lang) : null,
          helpers: { fieldCategory, inputDate, fmtNum, coerce },
          error: (res.locals?.t ? res.locals.t('please_fill') : 'Bitte ausfüllen') + ': ' + check.missing.map((m) => (res.locals.tx ? res.locals.tx(m.label) : m.label)).join(', ')
        });
      }
      // multi-tenant default
      if (meta.multiTenant) data.Team = req.session.user?.Team || 'Team';
      // Phase 1: BeforeAdd then BeforeInsert, mirroring PHPRunner's order.
      const addCtx = { values: data, rawValues: { ...req.body }, session: req.session?.user || {}, prisma };
      await runHook(name, 'BeforeAdd', addCtx);
      await runHook(name, 'BeforeInsert', addCtx);
      // never persist a credential in clear text, whichever entity this is
      await hashPasswordFields(addCtx.values);
      await Model.create({ data: addCtx.values });
      // Phase 10: audit trail
      await auditLog({ prisma, req, table: name, action: 'add', recordId: addCtx.values.ID, newData: addCtx.values });
      req.notify?.('success', 'record_created', { name: res.locals.tx?.(meta.label || name) || meta.label || name });
      res.redirect('/' + name);
    } catch (e) {
      const lookups = await loadLookups(req);
      res.render('crud/form', {
        item: req.body, module: name, meta, registry, lookups, isEdit: false,
        helpers: { fieldCategory, inputDate, fmtNum, coerce }, error: e.message
      });
    }
  });

  // UPDATE
  // Mass action: delete the rows selected on the list page.
  // Registered before /:id so the parameter route cannot swallow it.
  router.post('/massdelete', gate('D'), async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    let deleted = 0;
    for (const id of ids) {
      try {
        const row = await Model.findFirst({ where: teamWhere(req, { ID: id }, name), select: { ID: true } });
        if (!row) continue;
        await Model.delete({ where: { ID: row.ID } });
        deleted += 1;
        await auditLog({ prisma, req, table: name, action: 'delete', recordId: id });
      } catch {}
    }
    req.notify?.('success', 'records_deleted', { count: deleted });
    res.redirect('/' + name + (deleted ? '?deleted=' + deleted : ''));
  });

  router.post('/:id', gate('E'), async (req, res) => {
    try {
      const data = recordValuesFromBody(req.body, {
        entity: name,
        fields: meta.fields,
        coerce: (entity, field, raw) => coerce(entity, field, raw),
        isEdit: true,
        isAdmin: req.session?.user?.isAdmin === true,
      });
      for (const f of req.files || []) {
        if (meta.fields?.[f.fieldname]) data[f.fieldname] = Buffer.from(f.buffer);
      }
      // required validation from the manifest (IsRequired, edit page only)
      const manifest = manifestFor(name);
      const submitted = { ...req.body };
      for (const f of req.files || []) submitted[f.fieldname] = submitted[f.fieldname] || 'file';
      const check = validateSubmission(manifest, name, 'edit', submitted);
      if (!check.ok) {
        const lookups = await loadLookups(req);
        return res.render('crud/form', {
          item: { ...req.body, ID: req.params.id }, module: name, meta, registry, lookups, isEdit: true,
          spec: manifest ? formSpec(manifest, manifest.entity || name, 'edit', res.locals?.lang) : null,
          helpers: { fieldCategory, inputDate, fmtNum, coerce },
          error: (res.locals?.t ? res.locals.t('please_fill') : 'Bitte ausfüllen') + ': ' + check.missing.map((m) => (res.locals.tx ? res.locals.tx(m.label) : m.label)).join(', ')
        });
      }
      // Phase 1: BeforeEdit hook.
      const editCtx = { values: data, rawValues: { ...req.body }, session: req.session?.user || {}, prisma };
      await runHook(name, 'BeforeEdit', editCtx);
      // never persist a credential in clear text, whichever entity this is
      await hashPasswordFields(editCtx.values);
      const before = await safe(Model.findFirst({ where: teamWhere(req, { ID: +req.params.id }, name) }), null);
      if (!before) return res.status(404).render('error', { message: (res.locals?.t ? res.locals.t('not_found') : 'Nicht gefunden') });
      await Model.update({ where: { ID: before.ID }, data: editCtx.values });
      // Phase 10: audit trail + release the edit lock
      await auditLog({ prisma, req, table: name, action: 'edit', recordId: +req.params.id, oldData: before, newData: editCtx.values });
      await releaseLock({
        prisma, table: name, keys: { ID: +req.params.id },
        sessionId: req.sessionID || req.session?.id || '',
      });
      req.notify?.('success', 'record_updated', { name: res.locals.tx?.(meta.label || name) || meta.label || name });
      res.redirect('/' + name + '/' + req.params.id);
    } catch (e) {
      res.status(500).render('error', { message: (res.locals?.t ? res.locals.t('update_error') : 'Update error') + ': ' + e.message });
    }
  });

  // DELETE
  router.post('/:id/delete', gate('D'), async (req, res) => {
    try {
      const before = await safe(Model.findFirst({ where: teamWhere(req, { ID: +req.params.id }, name) }), null);
      if (before) await Model.delete({ where: { ID: before.ID } });
      await auditLog({ prisma, req, table: name, action: 'delete', recordId: +req.params.id, oldData: before });
      req.notify?.('success', 'record_deleted', { name: res.locals.tx?.(meta.label || name) || meta.label || name });
    } catch {
      req.notify?.('error', 'delete_failed');
    }
    res.redirect('/' + name);
  });

  return router;
}

// Render a small HTML table fragment for inline child rows.
function renderChildRowsTable(childName, rows) {
  const cm = registry[childName];
  if (!cm) return '';
  const cols = (cm.listColumns || []).slice(0, 6);
  let html = '<table class="child-table"><thead><tr><th>ID</th>';
  for (const c of cols) html += `<th>${c}</th>`;
  html += '</tr></thead><tbody>';
  for (const r of rows) {
    html += `<tr><td><a href="/${childName}/${r.ID}">${r.ID}</a></td>`;
    for (const c of cols) html += `<td>${display(childName, c, r[c])}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function guessLocalFieldName(parentName, childName) {
  // parent "objekte" -> field "Objekt", "einheiten" -> "Einheit", "adressen" -> "Adresse"
  const map = {
    objekte: 'Objekt', einheiten: 'Einheit', adressen: 'Adresse',
    raeume: 'Raum', abrechnungen: 'Abrechnung', abrechnungskonten: 'Abrechnungskonto',
    inventar: 'Inventar', vertraege: 'Vertrag', buchfuehrungen: 'Buchfuehrung',
    kontakte: 'Adresse', plz: 'PLZ'
  };
  return map[parentName] || (parentName.charAt(0).toUpperCase() + parentName.slice(1));
}
