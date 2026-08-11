import fs from 'node:fs';

export function paritySummary({ sourceCatalog = 'src/meta/source-catalog.json', handlerCatalog = 'src/meta/handler-ops.json', eventCatalog = 'src/meta/event-ops.json' } = {}) {
  const source = JSON.parse(fs.readFileSync(sourceCatalog, 'utf8'));
  const handlers = JSON.parse(fs.readFileSync(handlerCatalog, 'utf8'));
  const events = JSON.parse(fs.readFileSync(eventCatalog, 'utf8'));
  return {
    sourceEntries: source.entries.length,
    sourceUnmapped: source.entries.filter((entry) => !entry.status).length,
    handlers: handlers.summary.total,
    handlerCatalogued: Object.keys(handlers.specs).length,
    hooks: events.summary.hooks,
    hooksCatalogued: events.summary.hooks,
  };
}
