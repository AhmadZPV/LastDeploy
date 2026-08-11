import { Router } from 'express';
import { exportCsv } from '../src/exporters/index.js';
import { datevRows, addressMailMergeRows, salesMailMergeRows } from '../src/exporters/special.js';

function sendCsv(res, title, rows, delimiter = ',') {
  const keys = Object.keys(rows[0] || {});
  return exportCsv(res, { title, headers: keys.map((key) => ({ key, label: key })), rows }, { delimiter });
}

export default function createSpecialExportRouter({ prisma, canAccess, teamWhere }) {
  const router = Router();
  async function datev(req, res) {
    if (!canAccess(req, 'datev_export', 'P')) return res.status(403).render('error', { message: 'Keine Export-Berechtigung' });
    return sendCsv(res, 'DATEV_Export', await datevRows(prisma, teamWhere(req, {}, 'buchungen')), ',');
  }
  async function serienbriefSteuerdatei(req, res) {
    if (!canAccess(req, 'adressen', 'P')) return res.status(403).render('error', { message: 'Keine Export-Berechtigung' });
    return sendCsv(res, 'Serienbrief_Steuerdatei', await addressMailMergeRows(prisma, teamWhere(req, {}, 'adressen')), ',');
  }
  async function verkaufSteuerdatei(req, res) {
    if (!canAccess(req, 'verkauf', 'P')) return res.status(403).render('error', { message: 'Keine Export-Berechtigung' });
    return sendCsv(res, 'Verkauf_Serienbrief_Steuerdatei', await salesMailMergeRows(prisma, teamWhere(req, {}, 'verkauf')), ',');
  }
  router.get(['/datev', '/DATEV_Export'], datev);
  router.get(['/serienbrief/steuerdatei', '/Serienbrief_Steuerdatei'], serienbriefSteuerdatei);
  router.get(['/verkauf/steuerdatei', '/Verkauf_Serienbrief_Steuerdatei'], verkaufSteuerdatei);
  router.get('/Serienbrief', async (req, res) => {
    if (!canAccess(req, 'serienbrief', 'P')) return res.status(403).render('error', { message: 'Keine Export-Berechtigung' });
    return sendCsv(res, 'Serienbrief', await addressMailMergeRows(prisma, teamWhere(req, {}, 'adressen')), ',');
  });
  return router;
}
