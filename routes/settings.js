/**
 * Phase 10 - /settings (port of Einstellungen_edit.php).
 *
 * Workspace preferences live in row ID=1 of the `Einstellungen` table. This
 * route renders them as one grouped form; saving audits the change and is
 * gated on the 'E' right for `einstellungen`, exactly like the PHP edit page.
 *
 * FIELD_GROUPS only names columns that really exist in prisma/schema.prisma —
 * the coverage test enforces it.
 */
import { Router } from 'express';
import { auditLog } from '../src/audit.js';

/** The Einstellungen fields, grouped like the source's edit page. */
export const FIELD_GROUPS = [
  {
    title: 'Allgemein',
    fields: ['Waehrung', 'Revision', 'Ort', 'Absenderzeile', 'Grussformel', 'Fussbereich'],
  },
  {
    title: 'E-Mail (SMTP)',
    fields: ['Email', 'SMTPServer', 'SMTPPort', 'SMTPUser', 'SMTPPasswort', 'SMTPSicherheit'],
  },
  {
    title: 'Webhooks',
    fields: ['WebhookAdressen', 'WebhookTermine', 'WebhookNotizen', 'WebhookAufgaben'],
  },
  {
    title: 'Layouts',
    fields: ['Brieflayout', 'Rechnungslayout', 'Angebotslayout', 'Abrechnungslayout',
      'CSS', 'Serienbrief', 'LogoLink'],
  },
  {
    title: 'Eigene Felder',
    fields: Array.from({ length: 10 }, (_, i) => `Feldname${i + 1}`),
  },
];

/** Einstellungen columns that are integers in the schema (form posts are strings). */
const INT_FIELDS = new Set(['SMTPPort']);

export default function createSettingsRouter({ prisma, canAccess, teamWhere } = {}) {
  const router = Router();

  const allowed = (req) => !canAccess || canAccess(req, 'einstellungen', 'E');

  const loadRow = async (req) => {
    const delegate = prisma?.einstellungen;
    if (!delegate) return null;
    const where = teamWhere ? teamWhere(req, {}, 'einstellungen') : {};
    return delegate.findFirst({ where });
  };

  router.get('/', async (req, res) => {
    if (!allowed(req)) {
      return res.status(403).render('error', { message: (res.locals?.t ? res.locals.t('no_settings_permission') : 'Keine Berechtigung für die Einstellungen') });
    }
    const row = await loadRow(req);
    res.render('settings', {
      title: 'Einstellungen',
      row: row || {},
      groups: FIELD_GROUPS,
      saved: req.query?.saved === '1',
    });
  });

  router.post('/', async (req, res) => {
    if (!allowed(req)) {
      return res.status(403).render('error', { message: (res.locals?.t ? res.locals.t('no_settings_permission') : 'Keine Berechtigung für die Einstellungen') });
    }
    const delegate = prisma?.einstellungen;
    const before = await loadRow(req);
    const body = req.body || {};
    const changes = {};
    for (const group of FIELD_GROUPS) {
      for (const field of group.fields) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        let value = body[field];
        if (INT_FIELDS.has(field)) {
          value = value === '' || value == null ? null : Number(value);
        } else if (value === '') {
          value = null;
        }
        if (String(before?.[field] ?? '') !== String(value ?? '')) changes[field] = value;
      }
    }
    try {
      if (delegate && before && Object.keys(changes).length) {
        await delegate.update({ where: { ID: before.ID }, data: changes });
        await auditLog({
          prisma, req, table: 'einstellungen', action: 'edit',
          recordId: before.ID, oldData: before, newData: changes,
        });
      }
      res.redirect('/settings?saved=1');
    } catch (e) {
      res.status(500).render('error', {
        message: 'Einstellungen konnten nicht gespeichert werden: ' + e.message,
      });
    }
  });

  return router;
}
