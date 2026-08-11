/**
 * Phase 2 - media serving (port of imager.php + the inline half of getfile.php).
 *
 *   GET /media/:entity/:id/:field           original bytes, inline
 *   GET /media/:entity/:id/:field?download=1  same bytes as an attachment
 *   GET /media/:entity/:id/:field/thumb?w=&h=  thumbnail via sharp
 *
 * The database has no mime column, so the type is sniffed from the magic
 * bytes. Both paths are team-scoped and gated on the 'S' right, exactly like
 * the PHP originals.
 */
import { Router } from 'express';
import sharp from 'sharp';
import { registry } from '../src/registry.js';
import { resolveEntityName } from '../src/meta-store.js';
import { parseStoredFiles, sanitizeFileName } from '../src/uploads.js';

/** Mime from magic bytes; octet-stream when we recognise nothing. */
export function sniffMime(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 4) return 'application/octet-stream';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF'
      && buf.length >= 12 && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'application/zip';
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    return 'application/vnd.ms-office';
  }
  return 'application/octet-stream';
}

/**
 * A column holds either raw bytes or the PHPRunner JSON envelope pointing at
 * the uploads folder. Returns { kind: 'buffer', buffer, mime } or
 * { kind: 'file', name, path, mime } — or null for an empty column.
 */
export function decodeStored(value) {
  if (value == null || value === '') return null;
  const envelope = parseStoredFiles(value);
  if (envelope.length) {
    const first = envelope[0];
    return {
      kind: 'file',
      name: first.usrName || first.name,
      path: first.name,
      mime: first.type || null,
      size: Number(first.size) || 0,
    };
  }
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'binary');
  if (!buffer.length) return null;
  return { kind: 'buffer', buffer, mime: sniffMime(buffer) };
}

/** Resolve a route entity to { slug, model } via the registry. */
function resolveTarget(entity) {
  const want = String(entity || '').toLowerCase();
  const slug = Object.keys(registry).find((k) => k.toLowerCase() === want);
  if (slug) return { slug, model: registry[slug]?.model };
  const canonical = resolveEntityName(entity);
  if (!canonical) return null;
  const hit = Object.keys(registry).find((k) => k.toLowerCase() === canonical.toLowerCase());
  return hit ? { slug: hit, model: registry[hit]?.model } : null;
}

const SAFE_FIELD = /^[A-Za-z0-9_ ]+$/;

async function loadField({ prisma, teamWhere, req }, target, id, field) {
  const delegate = prisma[target.model] || prisma[String(target.model || '').toLowerCase()];
  if (!delegate) return null;
  const where = { ID: Number(id), ...teamWhere(req, {}, target.slug) };
  return delegate.findFirst({ where, select: { [field]: true } });
}

export default function createMediaRouter({ prisma, canAccess, teamWhere }) {
  const router = Router();
  const scope = { prisma, teamWhere: teamWhere || ((req, extra) => extra) };

  const guard = (req, res, target, field) => {
    if (!target) { res.status(404).send('not found'); return false; }
    if (!field || !SAFE_FIELD.test(field)) { res.status(400).send('bad field'); return false; }
    if (canAccess && !canAccess(req, target.slug, 'S')) {
      res.status(403).send('Keine Berechtigung fuer ' + target.slug);
      return false;
    }
    return true;
  };

  // The original bytes (imager.php's non-resized path).
  router.get('/:entity/:id/:field', async (req, res) => {
    const target = resolveTarget(req.params.entity);
    const field = req.params.field;
    if (!guard(req, res, target, field)) return;
    try {
      const row = await loadField(scope, target, req.params.id, field);
      const decoded = row && decodeStored(row[field]);
      if (!decoded) return res.status(404).send('not found');
      if (decoded.kind === 'file') {
        return res.status(404).send('file not stored in the database: ' + decoded.name);
      }
      const download = String(req.query.download || '') === '1';
      res.setHeader('Content-Type', decoded.mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Length', String(decoded.buffer.length));
      const name = sanitizeFileName(field) || 'download';
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      );
      res.send(decoded.buffer);
    } catch (e) {
      res.status(500).send(e.message);
    }
  });

  // The thumbnail (imager.php with w/h). Images are normalised to jpeg;
  // anything else — a PDF stored in a Bild column, say — passes through
  // untouched, because resizing it would produce garbage.
  router.get('/:entity/:id/:field/thumb', async (req, res) => {
    const target = resolveTarget(req.params.entity);
    const field = req.params.field;
    if (!guard(req, res, target, field)) return;
    try {
      const row = await loadField(scope, target, req.params.id, field);
      const decoded = row && decodeStored(row[field]);
      if (!decoded) return res.status(404).send('not found');
      if (decoded.kind === 'file') {
        return res.status(404).send('file not stored in the database: ' + decoded.name);
      }

      if (!decoded.mime.startsWith('image/')) {
        res.setHeader('Content-Type', decoded.mime);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.send(decoded.buffer);
      }

      const w = Math.max(0, Number(req.query.w) || 0) || undefined;
      const h = Math.max(0, Number(req.query.h) || 0) || undefined;
      const thumb = await sharp(decoded.buffer)
        .rotate()
        .resize({ width: w, height: h, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Length', String(thumb.length));
      res.send(thumb);
    } catch (e) {
      res.status(500).send(e.message);
    }
  });

  return router;
}
