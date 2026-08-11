/**
 * Phase 10 - /savedsearches (port of PHPRunner's saved-search endpoints).
 *
 *   GET    /savedsearches?table=X              the user's searches for table X
 *   POST   /savedsearches                      { table, name, search } -> save/overwrite
 *   DELETE /savedsearches/:name?table=X        delete one of the user's own
 *
 * Storage: `INtex Hausverwaltung_settings` rows with TYPE=2 (see
 * src/saved-searches.js). JSON in, JSON out — the entity list pages call
 * these endpoints from their search panel.
 */
import { Router } from 'express';
import { listSearches, saveSearch, deleteSearch } from '../src/saved-searches.js';

function username(req) {
  const u = req?.session?.user;
  return u?.Benutzername || u?.username || '';
}

export default function createSearchesRouter({ prisma, canAccess } = {}) {
  const router = Router();

  router.get('/', async (req, res) => {
    const table = String(req.query.table || '');
    if (table && canAccess && !canAccess(req, table, 'S')) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    res.json(await listSearches({ prisma, user: username(req), table }));
  });

  router.post('/', async (req, res) => {
    const { table, name, search, clause } = req.body || {};
    if (table && canAccess && !canAccess(req, table, 'S')) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    try {
      const saved = await saveSearch({
        prisma, user: username(req), table, name, clause: clause ?? search,
      });
      if (!saved) return res.status(500).json({ error: 'Suche konnte nicht gespeichert werden' });
      res.json(saved);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/:name', async (req, res) => {
    const table = String(req.query.table || '');
    const out = await deleteSearch({
      prisma, user: username(req), table, name: req.params.name,
    });
    res.status(out.deleted ? 200 : 404).json(out);
  });

  return router;
}
