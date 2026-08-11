/**
 * Map virtual dashboard/list table names to Prisma base models.
 * Built from src/meta/entities/* where isVirtual + baseTable are set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTITIES_DIR = path.join(HERE, 'meta', 'entities');

let _map = null;

export function loadVirtualBaseTables() {
  if (_map) return _map;
  _map = Object.create(null);
  try {
    for (const file of fs.readdirSync(ENTITIES_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(ENTITIES_DIR, file), 'utf8'));
        if (j && j.isVirtual && j.baseTable && j.entity) {
          _map[String(j.entity).toLowerCase()] = j.baseTable;
          _map[String(j.shortName || j.entity).toLowerCase()] = j.baseTable;
        }
      } catch { /* skip bad file */ }
    }
  } catch {
    // defaults for the four dashboard virtuals if meta missing
  }
  // Ensure the four dashboard virtuals always resolve
  const defaults = {
    journal: 'Buchungen',
    direktekosten: 'Kosten',
    vorauszahlungen: 'Kosten',
    kerndaten: 'Adressen',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!_map[k]) _map[k] = v;
  }
  return _map;
}

/** Resolve a dashboard element table name to a Prisma model name (may be base table). */
export function resolveDataTable(table) {
  if (!table) return null;
  const key = String(table).toLowerCase();
  const map = loadVirtualBaseTables();
  return map[key] || table;
}

export function resetVirtualCache() {
  _map = null;
}
