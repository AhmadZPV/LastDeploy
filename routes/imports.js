import { Router } from 'express';
import { registry } from '../src/registry.js';
import { loadMeta } from '../src/meta-store.js';
import { coerce } from '../src/formatters.js';
import { parseCsv, parseXlsx, detectDelimiter } from '../src/importers/csv.js';
import { parseVcards } from '../src/importers/vcard.js';
import { parseIcal } from '../src/importers/ical.js';
import { auditLog } from '../src/audit.js';
import { applyBankImport } from '../src/importers/bank.js';

function importFields(slug) {
  try {
    const manifest = loadMeta(slug);
    const declared = manifest.fieldSets?.import || [];
    return (declared.length ? declared : (manifest.fields || []).map((f) => f.name))
      .filter((f) => /^[A-Za-z0-9_ ]+$/.test(f));
  } catch { return []; }
}

function duplicateWhere(row, policy) {
  if (policy === 'id' && row.ID != null) return { ID: row.ID };
  return null;
}

export default function createImportRouter({ prisma, canAccess, teamWhere }) {
  const router = Router();

  router.get('/:entity', (req, res) => {
    const slug = String(req.params.entity || '').toLowerCase();
    const meta = registry[slug];
    if (!meta || !prisma[meta.model]) return res.status(404).render('error', { message: 'Importziel nicht gefunden' });
    if (!canAccess(req, slug, 'I')) return res.status(403).render('error', { message: (res.locals?.t ? res.locals.t('no_import_permission') : 'Keine Import-Berechtigung') });
    const fields = importFields(slug);
    res.render('import/index', { entity: slug, meta, fields, preview: null, error: null });
  });

  router.post('/:entity/preview', async (req, res) => {
    const slug = String(req.params.entity || '').toLowerCase();
    const meta = registry[slug];
    if (!meta || !prisma[meta.model]) return res.status(404).render('error', { message: 'Importziel nicht gefunden' });
    if (!canAccess(req, slug, 'I')) return res.status(403).render('error', { message: (res.locals?.t ? res.locals.t('no_import_permission') : 'Keine Import-Berechtigung') });
    const file = (req.files || []).find((entry) => entry.fieldname === 'file');
    if (!file) return res.status(400).render('import/index', { entity: slug, meta, fields: importFields(slug), preview: null, error: 'Keine Datei empfangen' });

    const ext = file.originalname.toLowerCase().split('.').pop();
    let parsed;
    if (ext === 'xlsx' || ext === 'xlsm') parsed = { ...(await parseXlsx(file.buffer)), kind: 'xlsx' };
    else if (ext === 'vcf') parsed = { headers: [], rows: parseVcards(file.buffer.toString('utf8')), kind: 'vcard' };
    else if (ext === 'ics') parsed = { headers: [], rows: parseIcal(file.buffer.toString('utf8')), kind: 'ical' };
    else {
      const text = file.buffer.toString('utf8');
      parsed = { ...parseCsv(text, detectDelimiter(text)), kind: 'csv' };
    }
    const fields = importFields(slug);
    const rows = parsed.rows.slice(0, 5000);
    const token = Buffer.from(JSON.stringify({ kind: parsed.kind, rows }), 'utf8').toString('base64url');
    res.render('import/index', { entity: slug, meta, fields, error: null,
      preview: { headers: parsed.headers, rows: rows.slice(0, 20), total: rows.length, token } });
  });

  router.post('/:entity/commit', async (req, res) => {
    const slug = String(req.params.entity || '').toLowerCase();
    const meta = registry[slug];
    const Model = meta && prisma[meta.model];
    if (!Model) return res.status(404).render('error', { message: 'Importziel nicht gefunden' });
    if (!canAccess(req, slug, 'I')) return res.status(403).render('error', { message: (res.locals?.t ? res.locals.t('no_import_permission') : 'Keine Import-Berechtigung') });
    let rows;
    try { rows = JSON.parse(Buffer.from(String(req.body.token || ''), 'base64url').toString('utf8')).rows; }
    catch { return res.status(400).render('error', { message: (res.locals?.t ? res.locals.t('import_preview_invalid') : 'Importvorschau ist ungültig') }); }
    if (!Array.isArray(rows) || rows.length > 5000) return res.status(400).render('error', { message: (res.locals?.t ? res.locals.t('import_size_invalid') : 'Importgröße ist ungültig') });

    const allowed = new Set(importFields(slug));
    const policy = req.body.duplicates || 'skip';
    const report = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i += 1) {
      const data = {};
      for (const [field, raw] of Object.entries(rows[i] || {})) {
        if (!allowed.has(field) || raw === '') continue;
        data[field] = coerce(slug, field, raw);
      }
      if (meta.multiTenant) data.Team = req.session.user.Team;
      try {
        const dupWhere = duplicateWhere(data, policy);
        const existing = dupWhere ? await Model.findFirst({ where: teamWhere(req, dupWhere, slug) }) : null;
        if (existing && policy === 'id') {
          const { ID, Team, ...changes } = data;
          await Model.update({ where: { ID: existing.ID }, data: changes });
          report.updated += 1;
        } else if (existing || (data.ID != null && policy === 'skip')) report.skipped += 1;
        else {
          if (policy !== 'id') delete data.ID;
          const created = await Model.create({ data });
          if (['buchungsimport', 'kontoauszuege', 'kontoauszuege2'].includes(slug)) {
            await applyBankImport({ prisma, entity: slug, row: { ...rows[i], ...data }, session: req.session.user });
          }
          report.created += 1;
          await auditLog({ prisma, req, table: slug, action: 'import', recordId: created.ID, newData: data });
        }
      } catch (error) { report.errors.push({ row: i + 2, error: error.message }); }
    }
    res.render('import/result', { entity: slug, meta, report });
  });

  return router;
}
