/**
 * BLOB / file download (port of getfile.php and getpdf.php).
 *
 * Lives in src/ so it can be imported and tested without pulling in server.js,
 * which imports the file router right back.
 *
 * getfile.php answered with:
 *   Content-Type: <by filename extension>
 *   Content-Disposition: attachment; Filename="<name>"
 *   Cache-Control: private
 *   Content-Length: <bytes>
 * and refused, silently, whenever the caller was not logged in, lacked Search
 * rights, or asked for a field the page does not expose. We keep the refusals
 * but answer with real status codes instead of an empty body, because an empty
 * 200 is indistinguishable from a broken download.
 */
import { registry } from './registry.js';
import { loadMeta, resolveEntityName } from './meta-store.js';
import {
  resolveMime, contentDisposition, sanitizeFileName, parseStoredFiles,
} from './uploads.js';

/** Resolve a slug or table name to { slug, model, entityName }. */
export function resolveTarget(table) {
  if (!table) return null;
  const want = String(table).toLowerCase();
  const slug = Object.keys(registry).find((k) => k.toLowerCase() === want);
  if (slug) {
    return { slug, model: registry[slug]?.model, entityName: resolveEntityName(slug) || slug };
  }
  const entityName = resolveEntityName(table);
  if (!entityName) return null;
  const hit = Object.keys(registry).find(
    (k) => (resolveEntityName(k) || k).toLowerCase() === entityName.toLowerCase());
  return hit ? { slug: hit, model: registry[hit]?.model, entityName } : null;
}

/** KeyWhere(): key1..keyN onto the entity's real primary key columns. */
export function downloadKeys(source, target, routeId) {
  const meta = loadMeta(target.entityName);
  const cols = (meta?.keys?.length ? meta.keys : ['ID']);
  const where = {};
  for (let i = 0; i < cols.length; i++) {
    const raw = source['key' + (i + 1)] ?? (i === 0 ? routeId : undefined);
    if (raw === undefined || raw === null || raw === '') return null;
    where[cols[i]] = /^-?[0-9]+$/.test(String(raw)) ? Number(raw) : String(raw);
  }
  return where;
}

/**
 * Turn whatever sits in the column into { buffer, fileName, mime }.
 *
 * A column holds either raw bytes (the BLOB case) or the JSON envelope that
 * describes files on disk. For the envelope we can only report the metadata,
 * since the uploads folder is not part of this port yet; callers surface that
 * as a 404 rather than shipping a JSON blob to the browser as if it were a PDF.
 */
export function decodeDownload(value, { field, requestedName } = {}) {
  if (value == null || value === '') return null;

  const envelope = parseStoredFiles(value);
  if (envelope.length) {
    const wanted = sanitizeFileName(requestedName);
    const pick = wanted
      ? envelope.find((f) => (f.usrName || f.name) === wanted)
      : envelope[0];
    if (!pick) return null;
    return {
      kind: 'reference',
      buffer: null,
      fileName: sanitizeFileName(pick.usrName || pick.name),
      mime: pick.type || resolveMime(pick.usrName || pick.name, null),
      size: Number(pick.size) || 0,
      path: pick.name,
    };
  }

  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'binary');
  if (!buffer.length) return null;
  const fileName = sanitizeFileName(requestedName) || defaultFileName(field, buffer);
  return {
    kind: 'buffer',
    buffer,
    fileName,
    mime: resolveMime(fileName, buffer),
    size: buffer.length,
  };
}

/**
 * No name was supplied, so build one. The extension comes from the bytes when
 * we recognise them, otherwise from the naming convention the schema follows
 * (Bild/Miniatur are images, Beleg/Dokument/Anhang are PDFs).
 */
export function defaultFileName(field, buffer) {
  const base = sanitizeFileName(field) || 'download';
  const mime = resolveMime('', buffer);
  const byMime = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/bmp': '.bmp', 'image/webp': '.webp',
  }[mime];
  if (byMime) return base + byMime;
  if (buffer && buffer.slice(0, 4).toString('ascii') === '%PDF') return base + '.pdf';
  if (/Bild|Miniatur|Foto/i.test(base)) return base + '.jpg';
  if (/Beleg|Dokument|Anhang/i.test(base)) return base + '.pdf';
  return base + '.bin';
}

/** The exact header set getfile.php sent. */
export function downloadHeaders(decoded, { inline = false } = {}) {
  return {
    'Content-Type': decoded.mime,
    'Content-Disposition': contentDisposition(decoded.fileName, { inline }),
    'Cache-Control': 'private',
    'Content-Length': String(decoded.size),
  };
}

/**
 * Build the handler. Dependencies are injected to keep this module free of a
 * server.js import cycle.
 */
export function createDownloadHandler({ prisma, canAccess, teamWhere, fieldReadable }) {
  return async function downloadHandler(req, res) {
    const source = { ...(req.query || {}), ...(req.body || {}) };
    const params = req.params || {};
    const table = source.table || params.entity;
    const field = source.field || params.field;

    const target = resolveTarget(table);
    if (!target) return res.status(404).send('not found');
    if (!field || !/^[A-Za-z0-9_ ]+$/.test(field)) return res.status(400).send('bad field');

    if (!canAccess(req, target.slug, 'S')) {
      return res.status(403).send('Keine Berechtigung fuer ' + target.slug);
    }
    // checkFieldPermissions(): a field the page never exposes is not downloadable
    if (fieldReadable && !fieldReadable(target, field, 'view')) {
      return res.status(403).send('Keine Berechtigung fuer dieses Feld');
    }

    const keys = downloadKeys(source, target, params.id);
    if (!keys) return res.status(400).send('missing key');

    const Model = target.model
      ? (prisma[target.model] || prisma[target.model.toLowerCase()])
      : null;
    if (!Model) return res.status(404).send('not found');

    try {
      const where = { ...keys, ...teamWhere(req, {}, target.slug) };
      const row = await Model.findFirst({ where, select: { [field]: true } });
      if (!row) return res.status(404).send('not found');

      const decoded = decodeDownload(row[field], {
        field,
        requestedName: source.filename || source.file,
      });
      if (!decoded) return res.status(404).send('empty');
      if (decoded.kind === 'reference') {
        // the bytes live in the legacy uploads folder, which this port does not
        // serve yet: say so instead of shipping the envelope
        return res.status(404).send('file not stored in the database: ' + decoded.fileName);
      }

      const inline = String(source.nodisp) === '1' || String(source.inline) === '1';
      const headers = downloadHeaders(decoded, { inline });
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      return res.send(decoded.buffer);
    } catch (e) {
      return res.status(500).send(e.message);
    }
  };
}

export default {
  resolveTarget, downloadKeys, decodeDownload, defaultFileName,
  downloadHeaders, createDownloadHandler,
};
