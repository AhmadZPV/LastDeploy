/**
 * Multipart upload (port of mfhandler.php).
 *
 * The original answered three verbs on one URL:
 *   POST   -> store the uploaded files against a field, needing Add or Edit
 *   DELETE -> drop one file from that field, by its user-visible name
 *   GET    -> report what is currently attached, needing Search
 *
 * The policy (accepted names, file count, sizes, thumbnails) came from
 * getOptionsForMultiUpload(); that logic lives in src/uploads.js so it can be
 * tested without a server. This module only wires it to Express.
 */
import { Router } from 'express';
import { prisma, teamWhere, canAccess } from '../server.js';
import { loadMeta } from '../src/meta-store.js';
import {
  uploadPolicy, validateUpload, fileObject, parseStoredFiles,
  serializeStoredFiles, removeStoredFile, sanitizeFileName,
} from '../src/uploads.js';
import { resolveTarget, downloadKeys } from '../src/downloads.js';

export function createUploadRouter(deps = {}) {
  const db = deps.prisma || prisma;
  const access = deps.canAccess || canAccess;
  const scope = deps.teamWhere || teamWhere;
  const router = Router();

  /** Everything the three verbs need, or an error to answer with. */
  function context(req, letters) {
    const source = { ...(req.query || {}), ...(req.body || {}) };
    const params = req.params || {};
    const table = source.table || params.entity;
    const field = source.field || params.field;

    if (!table) {
      return { error: { status: 400, body: { success: false, error: 'No table name received' } } };
    }
    if (!field) {
      return { error: { status: 400, body: { success: false, error: 'No field name received' } } };
    }

    const target = resolveTarget(table);
    if (!target) {
      return { error: { status: 404, body: { success: false, error: 'unknown table' } } };
    }

    // mfhandler.php: Add OR Edit for POST/DELETE, Search for GET
    const allowed = letters.split('').some((l) => access(req, target.slug, l));
    if (!allowed) {
      return {
        error: {
          status: 403,
          body: { success: false, error: 'You have no permissions for this action' },
        },
      };
    }

    const meta = loadMeta(target.entityName);
    const policy = uploadPolicy(meta, field);
    if (!policy.exists) {
      return { error: { status: 400, body: { success: false, error: 'unknown field' } } };
    }

    const keys = downloadKeys(source, target, params.id);
    const Model = target.model ? (db[target.model] || db[target.model.toLowerCase()]) : null;
    if (!Model) {
      return { error: { status: 404, body: { success: false, error: 'unknown table' } } };
    }

    return { source, target, field, policy, keys, Model };
  }

  // POST /upload -> store files against a field
  router.post('/', async (req, res) => {
    const ctx = context(req, 'AE');
    if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body);

    const incoming = (req.files || []).filter((f) => f && f.buffer);
    if (!incoming.length) {
      return res.json({ files: [], success: false, error: 'no file received' });
    }

    const result = validateUpload(incoming, ctx.policy);
    const stored = result.accepted.map(fileObject);

    // No record yet (add page): hand the envelope back so the form can post it
    // with the rest of the record, which is what formStamp did in the original.
    if (!ctx.keys) {
      return res.json({
        files: stored,
        rejected: result.rejected,
        success: result.ok,
        pending: true,
      });
    }

    try {
      const where = { ...ctx.keys, ...scope(req, {}, ctx.target.slug) };
      const row = await ctx.Model.findFirst({ where, select: { [ctx.field]: true } });
      if (!row) return res.status(404).json({ success: false, error: 'Error: Wrong SQL query' });

      const single = ctx.policy.maxNumberOfFiles === 1;
      let value;
      if (single && result.accepted.length === 1) {
        // one-file fields kept the raw bytes in the BLOB column
        value = result.accepted[0].buffer;
      } else {
        const kept = parseStoredFiles(row[ctx.field]);
        value = serializeStoredFiles(
          [...kept, ...stored].slice(0, ctx.policy.maxNumberOfFiles));
      }

      await ctx.Model.update({ where: ctx.keys, data: { [ctx.field]: value } });
      return res.json({ files: stored, rejected: result.rejected, success: result.ok });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /upload -> remove one file from the field
  router.delete('/', async (req, res) => {
    const ctx = context(req, 'AE');
    if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body);
    if (!ctx.keys) return res.status(400).json({ success: false, error: 'missing key' });

    const name = sanitizeFileName(ctx.source.file || ctx.source.filename);
    try {
      const where = { ...ctx.keys, ...scope(req, {}, ctx.target.slug) };
      const row = await ctx.Model.findFirst({ where, select: { [ctx.field]: true } });
      if (!row) return res.status(404).json({ success: false, error: 'Error: Wrong SQL query' });

      // no name given, or the column holds raw bytes: clear the whole field
      const envelope = parseStoredFiles(row[ctx.field]);
      const value = (name && envelope.length) ? removeStoredFile(row[ctx.field], name) : null;

      await ctx.Model.update({ where: ctx.keys, data: { [ctx.field]: value } });
      return res.json({ success: true, files: parseStoredFiles(value) });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /upload -> what is currently attached to the field
  router.get('/', async (req, res) => {
    const ctx = context(req, 'S');
    if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body);
    if (!ctx.keys) return res.status(400).json({ success: false, error: 'missing key' });

    try {
      const where = { ...ctx.keys, ...scope(req, {}, ctx.target.slug) };
      const row = await ctx.Model.findFirst({ where, select: { [ctx.field]: true } });
      if (!row) return res.status(404).json({ success: false, error: 'Error: Wrong SQL query' });

      const value = row[ctx.field];
      const envelope = parseStoredFiles(value);
      if (envelope.length) return res.json({ success: true, files: envelope });
      if (value == null || value === '') return res.json({ success: true, files: [] });
      return res.json({
        success: true,
        files: [{
          name: ctx.field,
          usrName: ctx.field,
          size: Buffer.isBuffer(value) ? value.length : String(value).length,
          inDatabase: true,
        }],
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

export default createUploadRouter;
