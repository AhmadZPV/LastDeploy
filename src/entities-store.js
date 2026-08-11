import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENT_DIR = path.join(__dirname, 'entities');

// Loads JSON entity manifests written by scripts/build-entities.js.
// Each file is `src/entities/<entity>.json` and contains shape:
//   { name, model, title, titleSingle, searchFields, listColumns,
//     fields: { fieldName: { type, format, ... } },
//     lookupFields: { FKField: targetEntity },
//     tabs: [ { title, fields: [...] } ],
//     childRelations: [ { entity, localField } ]
//   }
export function loadEntities() {
  const out = {};
  if (!fs.existsSync(ENT_DIR)) return out;
  for (const fn of fs.readdirSync(ENT_DIR)) {
    if (!fn.endsWith('.json')) continue;
    // index.json is a manifest listing the entity names, not an entity itself.
    if (fn === 'index.json') continue;
    try {
      // The generator writes UTF-8 with a BOM; JSON.parse rejects it outright.
      const raw = fs.readFileSync(path.join(ENT_DIR, fn), 'utf8').replace(/^\uFEFF/, '');
      const meta = JSON.parse(raw);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
      const base = fn.replace(/\.json$/, '');
      out[base] = meta;
    } catch (e) {
      console.warn('entity manifest parse error:', fn, e.message);
    }
  }
  return out;
}
