// AJAX endpoints ported from PHP: autocomplete.php, lookupsuggest.php,
// searchsuggest.php, autofillfields.php, checkduplicates.php and the
// existing lookup endpoint. All endpoints enforce auth + AccessMask (A/E/D/S)
// and Team scoping mirroring the PHP security preamble.
//
// Reference: PLANNING.md phase 1 "endpointهای lookup و suggestion".
import { Router } from 'express';
import { prisma, requireAccess, teamWhere, canAccess } from '../server.js';
import { registry } from '../src/registry.js';
import { fieldCategory, display } from '../src/formatters.js';
import { loadMeta } from '../src/meta-store.js';
import {
  parentOf, dependentsOf, lookupChain, buildLookupQuery, toOptions,
} from '../src/lookups.js';

// Display fields used to build option labels for lookup targets.
const DISPLAY_CANDIDATES = [
  'Bezeichnung', 'Kurzname', 'Vorname', 'Nachname', 'Name', 'Nummer', 'Titel'
];

function prismaModel(name) {
  const meta = registry[name];
  if (!meta?.model) return null;
  return prisma[meta.model] || prisma[meta.model.toLowerCase()] || null;
}

function idDisplaySelect(tm, displayField) {
  const s = { ID: true };
  if (displayField && tm?.fields?.[displayField]) s[displayField] = true;
  for (const f of DISPLAY_CANDIDATES) if (tm?.fields?.[f]) s[f] = true;
  return s;
}

// Loads an entity manifest without throwing when it does not exist.
function metaFor(entity) {
  try {
    return loadMeta(entity);
  } catch {
    return null;
  }
}

// The column the source shows for a lookup field, e.g. Objekte.Besitzer is
// displayed as Kerndaten.Kurzname. Falls back to the name heuristic when the
// entity has no manifest.
function displayFieldFor(entity, field) {
  const meta = metaFor(entity);
  const spec = meta && buildLookupQuery({ meta, entity, field });
  return spec ? spec.displayField : null;
}

// The parent whose value narrows this dropdown, taken from the 58
// parentFilterField declarations in include/*_settings.php.
function parentFieldFor(entity, field, meta) {
  return parentOf(entity, field) || meta?.dependentParents?.[field] || null;
}

function displayLabel(r, displayField) {
  if (displayField && r?.[displayField] != null && r[displayField] !== '') {
    return String(r[displayField]);
  }
  return r.Kurzname || r.Bezeichnung || r.Name
    || (r.Vorname ? `${r.Vorname} ${r.Nachname || ''}`.trim() : '')
    || r.Nummer || `#${r.ID}`;
}

// Highlight the matched substring (searchsuggest contract).
function highlight(value, searchFor) {
  if (!value) return value;
  const s = String(value);
  const pos = s.toLowerCase().indexOf(String(searchFor).toLowerCase());
  if (pos < 0) return esc(s);
  return esc(s.slice(0, pos)) + '<b>' + esc(s.slice(pos, pos + searchFor.length)) + '</b>' + esc(s.slice(pos + searchFor.length));
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Returns the access letters required by PHP for the AJAX endpoints. PHP allows
// the call when the caller has Add, Edit OR Search on the target entity.
const anyAccess = () => (req, res, next) => {
  const u = req.session?.user;
  if (!u) return res.status(401).json({ success: false, error: 'Nicht angemeldet' });
  next();
};


export default function createAjaxRouter() {
  const router = Router();

  // GET /ajax/lookup/:entity/:field?q=
  // Existing endpoint, kept for back-compat; rewritten with Team scope.
  router.get('/lookup/:entity/:field', async (req, res) => {
    const { entity, field } = req.params;
    const q = (req.query.q || '').trim();
    const meta = registry[entity];
    const targetName = meta?.lookupFields?.[field];
    const tm = registry[targetName];
    const TModel = prismaModel(targetName);
    if (!tm || !TModel) return res.json([]);
    const dispField = displayFieldFor(entity, field);
    if (!canAccess(req, entity)) return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    try {
      const where = { ...teamWhere(req, {}, targetName) };
      if (q) {
        const ors = [];
        for (const f of DISPLAY_CANDIDATES) if (tm.fields?.[f]) {
          const ft = tm.fields[f].type;
          if (ft === 'Int' || ft === 'Decimal' || ft === 'Bytes') continue;
          ors.push({ [f]: { contains: q } });
        }
        if (ors.length) where.OR = ors;
      }
      const rows = await TModel.findMany({ where, select: idDisplaySelect(tm, dispField), orderBy: { ID: 'asc' }, take: 50 });
      res.json(rows.map(r => ({ id: r.ID, label: displayLabel(r, dispField) })));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /ajax/dependents/:entity/:field
  // The front end has to know WHICH controls to reload after a dropdown
  // changes. PHP hard-codes that in the generated page; here it is served from
  // the same extracted metadata so the two can never drift apart.
  router.get('/dependents/:entity/:field', (req, res) => {
    const { entity, field } = req.params;
    if (!canAccess(req, entity, 'S')) {
      return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    }
    res.json({
      success: true,
      field,
      parent: parentOf(entity, field),
      chain: lookupChain(entity, field),
      dependents: dependentsOf(entity, field),
    });
  });

  // POST /ajax/autocomplete/:entity
  // Ported from autocomplete.php. Reloads a lookup control option list given
  // the parent control values (dependent lookups). PHP returns
  // { success, data } where data is the option set produced by the control.
  //
  // Input:  field, parentCtrlsData (object), mode (1|2|3), isExistParent (0|1)
  // Output: { success: true, data: [ { value, label }, ... ] }
  router.post('/autocomplete/:entity', async (req, res) => {
    const entity = req.params.entity;
    const meta = registry[entity];
    if (!meta) return res.json({ success: true, data: [] });
    const field = req.body.field;
    const parentCtrlsData = req.body.parentCtrlsData || {};
    const targetName = meta.lookupFields?.[field];
    const tm = registry[targetName];
    const TModel = prismaModel(targetName);
    if (!tm || !TModel) return res.json({ success: true, data: [] });
    const dispField = displayFieldFor(entity, field);
    if (!canAccess(req, entity)) return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    try {
      const where = { ...teamWhere(req, {}, targetName) };
      // dependent lookup: parent value narrows the list by a parent field.
      const parentField = parentFieldFor(entity, field, meta);
      if (parentField && parentCtrlsData[parentField]) {
        where[parentField] = Number(parentCtrlsData[parentField]);
      }
      const rows = await TModel.findMany({ where, select: idDisplaySelect(tm, dispField), orderBy: { ID: 'asc' }, take: 200 });
      res.json({ success: true, data: rows.map(r => ({ value: r.ID, label: displayLabel(r, dispField) })) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /ajax/lookupsuggest/:entity
  // Ported from lookupsuggest.php. Provides suggestions for a lookup field by
  // searching link/display field for the typed value; returns up to 20 pairs
  // [linkValue, displayValue, ...] (PHP returns up to 40 array entries from 20 rows).
  //
  // Input:  field, searchFor, multiselection (0|1), isExistParent, parentCtrlsData,
  //         searchByLinkField (0|1)
  // Output: { success: true, data: [link, display, link, display, ...] }
  router.post('/lookupsuggest/:entity', async (req, res) => {
    const entity = req.params.entity;
    const meta = registry[entity];
    if (!meta) return res.json({ success: false, data: [] });
    const field = req.body.field;
    const searchFor = String(req.body.searchFor || '').trim();
    const targetName = meta.lookupFields?.[field];
    const tm = registry[targetName];
    const TModel = prismaModel(targetName);
    if (!tm || !TModel) return res.json({ success: false, data: [] });
    const dispField = displayFieldFor(entity, field);
    if (!canAccess(req, entity)) return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    if (!searchFor) return res.json({ success: true, data: [] });
    try {
      const where = { ...teamWhere(req, {}, targetName) };
      const ors = [];
      for (const f of DISPLAY_CANDIDATES) if (tm.fields?.[f]) {
        const ft = tm.fields[f].type;
        if (ft === 'Int' || ft === 'Decimal' || ft === 'Bytes') continue;
        ors.push({ [f]: { contains: searchFor } });
      }
      if (ors.length) where.OR = ors;
      else return res.json({ success: true, data: [] });
      const parentField = parentFieldFor(entity, field, meta);
      if (parentField && req.body.parentCtrlsData?.[parentField]) {
        where[parentField] = Number(req.body.parentCtrlsData[parentField]);
      }
      const rows = await TModel.findMany({ where, select: idDisplaySelect(tm), orderBy: { ID: 'asc' }, take: 20 });
      const out = [];
      for (const r of rows) { out.push(r.ID); out.push(displayLabel(r, dispField)); }
      res.json({ success: true, data: out });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /ajax/searchsuggest/:entity
  // Ported from searchsuggest.php. Suggests completion values for the list-page
  // search input by scanning configured searchFields. Returns highlighted results.
  //
  // Input:  searchFor, searchField (optional, restricts to one field), start (0|1)
  // Output: { success: true, result: [ { value, realValue }, ... ] } (max 10)
  router.post('/searchsuggest/:entity', async (req, res) => {
    const entity = req.params.entity;
    const meta = registry[entity];
    if (!meta) return res.json({ success: true, result: [] });
    if (!canAccess(req, entity, 'S')) return res.status(403).json({ success: false, error: 'Keine S-Berechtigung' });
    const searchFor = String(req.body.searchFor || '').trim();
    if (!searchFor) return res.json({ success: true, result: '' });
    let fields = meta.searchFields || [];
    if (req.body.searchField) fields = fields.filter(f => f === req.body.searchField);
    if (!fields.length) return res.json({ success: true, result: [] });
    const startsWith = req.body.start ? true : false;
    const limit = 10;
    const seen = new Set();
    const result = [];
    try {
      for (const f of fields) {
        if (result.length >= limit) break;
        const fi = meta.fields?.[f] || {};
        if (fi.type === 'Bytes') continue;
        const cond = startsWith
          ? { startsWith: searchFor }
          : { contains: searchFor };
        const rows = await prismaModel(entity).findMany({
          where: { ...teamWhere(req, {}, entity), [f]: cond },
          select: { ID: true, [f]: true },
          distinct: [f],
          take: limit - result.length
        });
        for (const r of rows) {
          const v = r[f];
          if (v == null || seen.has(String(v))) continue;
          seen.add(String(v));
          result.push({ value: highlight(v, searchFor), realValue: String(v) });
          if (result.length >= limit) break;
        }
      }
      // PHP ksort's the response by string; preserve stable ordering otherwise.
      res.json({ success: true, result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /ajax/autofillfields/:entity
  // Ported from autofillfields.php. When a lookup field gets a value, this fills
  // related fields on the source record from the chosen lookup target row.
  // Maps are declared per-entity in manifests via `autoFillFields`.
  //
  // Input:  mainField, linkFieldVal
  // Output: { success: true, data: [ { field, value }, ... ] }
  router.post('/autofillfields/:entity', async (req, res) => {
    const entity = req.params.entity;
    const meta = registry[entity];
    if (!meta) return res.json({ success: true, data: [] });
    if (!canAccess(req, entity)) return res.status(403).json({ success: false, error: 'Keine Berechtigung' });
    const mainField = req.body.mainField;
    const linkFieldVal = req.body.linkFieldVal;
    const fillMap = meta.autoFillFields?.[mainField];
    if (!fillMap || linkFieldVal == null || linkFieldVal === '') {
      return res.json({ success: true, data: [] });
    }
    const targetName = meta.lookupFields?.[mainField];
    const TModel = prismaModel(targetName);
    if (!TModel) return res.json({ success: true, data: [] });
    try {
      const row = await TModel.findFirst({
        where: { ...teamWhere(req, {}, targetName), ID: Number(linkFieldVal) },
        select: Object.keys(fillMap).reduce((a, k) => (a[k] = true, a), {})
      });
      if (!row) return res.json({ success: true, data: [] });
      const data = [];
      for (const [srcField, dstField] of Object.entries(fillMap)) {
        if (row[srcField] != null) data.push({ field: dstField, value: row[srcField] });
      }
      res.json({ success: true, data });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /ajax/checkduplicates/:entity
  // Ported from checkduplicates.php. Reports whether a value already exists for
  // a field, unless the field allows duplicates (declared in `uniqueFields`).
  //
  // Input:  fieldName, value, pageType
  // Output: { success: true, hasDuplicates: bool, error: '' } | error object
  router.post('/checkduplicates/:entity', async (req, res) => {
    const entity = req.params.entity;
    const meta = registry[entity];
    if (!meta) return res.json({ success: false, error: 'Unbekannte Entität' });
    const fieldName = req.body.fieldName;
    const value = req.body.value;
    const pageType = req.body.pageType;
    // PHP rule: Benutzer username/Name/Email duplicate check on the public
    // register page does NOT require a logged-in S right (it's part of
    // self-service registration). For any other pageType we still need S.
    const registerUser = (entity === 'benutzer'
      && ['Benutzername', 'Name', 'Email'].includes(fieldName)
      && pageType === 'register');
    // uniqueFields: optional whitelist; if present and fieldName not in it, skip (duplicates allowed).
    if (Array.isArray(meta.uniqueFields) && !meta.uniqueFields.includes(fieldName)) {
      return res.json({ success: false, error: 'Duplicated values are allowed' });
    }
    if (!registerUser && !canAccess(req, entity, 'S')) {
      return res.status(403).json({ success: false, error: 'Keine Leseberechtigung für ' + entity });
    }
    const fi = meta.fields?.[fieldName] || {};
    let typed;
    if (fi.type === 'Int' || fi.type === 'Decimal') {
      const n = Number(value);
      if (isNaN(n)) return res.json({ success: true, hasDuplicates: false, error: '' });
      typed = n;
    } else {
      typed = String(value);
    }
    try {
      const Model = prismaModel(entity);
      const where = { ...teamWhere(req, {}, entity), [fieldName]: typed };
      const count = await Model.count({ where });
      res.json({ success: true, hasDuplicates: count > 0, error: '' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
