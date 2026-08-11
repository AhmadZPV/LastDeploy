/**
 * Full text (port of fulltext.php).
 *
 * The list page truncates long text columns and fetches the rest through this
 * endpoint. The PHP contract is a POST carrying table/field/pagetype plus the
 * primary key as key1..keyN, answering { success, textCont } and never leaking
 * a value the caller may not read. fulltext.php answers an *empty* error for
 * the unauthenticated case, so we keep that shape rather than inventing one.
 *
 * This lives in src/ rather than routes/ so it can be imported (and tested)
 * without pulling in server.js, which imports the file router right back.
 */
import { registry } from './registry.js';
import { loadMeta, pageFields, resolveEntityName } from './meta-store.js';
import { display } from './formatters.js';

const FULLTEXT_FIELD = /^[A-Za-z0-9_ ]+$/;

/** Resolve a short table name to { slug, model, entityName }. */
export function resolveEntity(table) {
  if (!table) return null;
  const want = String(table).toLowerCase();
  for (const slug of Object.keys(registry)) {
    if (slug.toLowerCase() !== want) continue;
    return { slug, model: registry[slug]?.model, entityName: resolveEntityName(slug) || slug };
  }
  const entityName = resolveEntityName(table);
  if (!entityName) return null;
  const slug = Object.keys(registry).find(
    (k) => (resolveEntityName(k) || k).toLowerCase() === entityName.toLowerCase());
  return slug ? { slug, model: registry[slug]?.model, entityName } : null;
}

/**
 * checkFieldPermissions: the field has to be part of the page the request
 * claims to come from. When we have no metadata we fall back to the registry
 * so a curated entity still works.
 */
export function fieldReadable(entity, field, pageType) {
  const meta = loadMeta(entity.entityName);
  if (meta) {
    for (const kind of [pageType, 'list', 'view']) {
      let fields = [];
      try { fields = pageFields(meta, kind) || []; } catch { fields = []; }
      if (fields.some((f) => (typeof f === 'string' ? f : f?.name) === field)) return true;
    }
    if (meta.fields && Object.prototype.hasOwnProperty.call(meta.fields, field)) return true;
    return false;
  }
  const rm = registry[entity.slug];
  if (rm?.fields && Object.prototype.hasOwnProperty.call(rm.fields, field)) return true;
  return Boolean(rm?.listColumns?.includes(field));
}

/** KeyWhere(): map key1..keyN onto the entity's primary key columns. */
export function collectKeys(body, entity, routeId) {
  const meta = loadMeta(entity.entityName);
  const cols = (meta?.keys?.length ? meta.keys : ['ID']);
  const where = {};
  for (let i = 0; i < cols.length; i++) {
    const raw = body['key' + (i + 1)] ?? (i === 0 ? routeId : undefined);
    if (raw === undefined || raw === null || raw === '') return null;
    where[cols[i]] = /^-?[0-9]+$/.test(String(raw)) ? Number(raw) : String(raw);
  }
  return where;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** PHP nl2br: insert <br /> before the newline, keeping the newline itself. */
export function nl2br(s) {
  return String(s).replace(/(\r\n|\n\r|\n|\r)/g, '<br />$1');
}

/**
 * Build the request handler. Dependencies are injected so this module never
 * imports server.js (which would create a cycle through routes/files.js).
 */
export function createFulltextHandler({ prisma, canAccess, teamWhere }) {
  return function fulltextHandler(req, res) {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const params = req.params || {};
    const table = body.table || params.entity;
    const field = body.field || params.field;
    const pageType = body.pagetype || 'list';

    // fulltext.php: checkTableName() then exit(0) on anything unknown
    const entity = resolveEntity(table);
    if (!entity) return res.json({ success: false, error: '' });
    if (!field || !FULLTEXT_FIELD.test(field)) {
      return res.json({ success: false, error: '' });
    }

    // !isLogged() || !CheckSecurity(..., "Search") -> bare failure, no detail
    if (!req.session?.user) return res.json({ success: false, error: '' });
    if (!canAccess(req, entity.slug, 'S')) return res.json({ success: false, error: '' });

    // $pSet->checkFieldPermissions($field)
    if (!fieldReadable(entity, field, pageType)) {
      return res.json({
        success: false,
        error: 'Error: You have not permission for read this text',
      });
    }

    const keys = collectKeys(body, entity, params.id);
    if (!keys) return res.json({ success: false, error: 'Error: Wrong SQL query' });

    const Model = entity.model
      ? (prisma[entity.model] || prisma[entity.model.toLowerCase()])
      : null;
    if (!Model) return res.json({ success: false, error: 'Error: Wrong SQL query' });

    // RemoveAllFieldsExcept(): select only the requested column
    const where = { ...keys, ...teamWhere(req, {}, entity.slug) };
    return Model.findFirst({ where, select: { [field]: true } })
      .then((row) => {
        if (!row) return res.json({ success: false, error: 'Error: Wrong SQL query' });
        const value = row[field];
        if (value == null) return res.json({ success: true, textCont: '' });
        if (Buffer.isBuffer(value)) {
          return res.json({
            success: false,
            error: 'Error: You have not permission for read this text',
          });
        }
        let text;
        try { text = display(entity.slug, field, value); } catch { text = String(value); }
        // showDBValue() html-encodes, then nl2br() turns newlines into <br />
        return res.json({ success: true, textCont: nl2br(escapeHtml(String(text))) });
      })
      .catch(() => res.json({ success: false, error: 'Error: Wrong SQL query' }));
  };
}

export default {
  createFulltextHandler, resolveEntity, fieldReadable, collectKeys, escapeHtml, nl2br,
};
