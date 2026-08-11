import { Router } from 'express';
import { addressText, geocode } from '../src/geocoding.js';

export default function createGeocodingRouter({ prisma, canAccess, teamWhere }) {
  const router = Router();
  router.get('/adressen/:id', async (req, res) => {
    if (!canAccess(req, 'adressen', 'S')) return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    const row = await prisma.adressen.findFirst({ where: teamWhere(req, { ID: Number(req.params.id) }, 'adressen') });
    if (!row) return res.status(404).json({ success: false, error: 'Adresse nicht gefunden' });
    try { return res.json({ success: true, location: await geocode(addressText(row)) }); }
    catch (error) { return res.status(502).json({ success: false, error: error.message }); }
  });
  return router;
}
