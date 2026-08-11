import { Router } from 'express';
import { createFulltextHandler, fieldReadable } from '../src/fulltext.js';
import { createDownloadHandler } from '../src/downloads.js';

export default function createFileRouter({ prisma, teamWhere, canAccess }) {
  const router = Router();
  const downloadHandler = createDownloadHandler({ prisma, canAccess, teamWhere, fieldReadable });
  const fulltextHandler = createFulltextHandler({ prisma, canAccess, teamWhere });

  router.get('/get/:entity/:id/:field', downloadHandler);
  router.post('/get', downloadHandler);
  router.post('/getfile', downloadHandler);
  router.post('/fulltext', fulltextHandler);
  router.all('/fulltext/:entity/:id/:field', fulltextHandler);
  return router;
}
