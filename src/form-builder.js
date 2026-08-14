/**
 * Form and view specs, built from the extracted page metadata.
 *
 * The PHP pages render every add/edit/view form in the field order the
 * project file defines, with per-page visibility (`pages.add/edit/view`),
 * required marks (`edit.IsRequired`), input types (`edit.HTML5InuptType`),
 * widths (`edit.controlWidth`) and lookup wiring. The generic crud router
 * used to iterate the database row and guess types from field names.
 *
 * This module replaces the guessing with the manifest: fields in source
 * order, only where the source shows them, validated the way the source
 * marks them. Dependency-light (meta-store + field-format + lookups) so the
 * tests never touch Prisma or express.
 */

import { fieldLabel, loadMeta, resolveEntityName } from './meta-store.js';
import { editSettings, inputAttributes } from './field-format.js';
import { dependentsOf } from './lookups.js';

/** Loads a manifest without throwing; accepts slug or entity spelling. */
export function manifestFor(entity) {
  try {
    return loadMeta(resolveEntityName(entity) || entity);
  } catch {
    return null;
  }
}

/**
 * The fields the source shows on a page, in source order. `index` is the
 * position the settings file assigns; the database column order is ignored.
 */
export function orderedFields(meta, page) {
  const fields = meta && Array.isArray(meta.fields) ? meta.fields : [];
  return fields
    .filter((f) => f && f.name && f.pages && f.pages[page] === true)
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((f) => f.name);
}

/**
 * The label the source assigns, falling back to the field name.
 * `lang === 'en'` prefers the generated labels.English bag.
 */
export function labelFor(meta, name, lang) {
  return fieldLabel(meta, name, lang);
}

/** One form field, fully described for rendering. */
export function fieldSpec(meta, entity, name, lang) {
  const edit = editSettings(meta, name);
  const attrs = inputAttributes(meta, name);
  return {
    name,
    label: labelFor(meta, name, lang),
    required: edit.required,
    inputType: edit.inputType,
    width: edit.width,
    step: attrs.step || null,
    selectSize: edit.selectSize,
    allowToAdd: edit.allowToAdd,
    lookup: edit.lookup || null,
    dependents: dependentsOf(entity, name),
  };
}

/**
 * The add/edit form of an entity: ordered fields with everything the
 * renderer needs.
 */
export function formSpec(meta, entity, page, lang) {
  const names = orderedFields(meta, page);
  return {
    entity: entity || (meta && meta.entity) || '',
    page,
    fields: names.map((n) => fieldSpec(meta, entity || (meta && meta.entity), n, lang)),
  };
}

/** The view page: ordered fields with their German labels. */
export function viewSpec(meta, entity, lang) {
  return {
    entity: entity || (meta && meta.entity) || '',
    fields: orderedFields(meta, 'view').map((n) => ({ name: n, label: labelFor(meta, n, lang) })),
  };
}

/**
 * Server-side required validation, mirroring the IsRequired marks.
 * Only fields the source actually shows on the page are validated — an
 * invisible field (e.g. the auto-assigned ID on add) can never block a
 * submission. Uploaded files count as provided values.
 *
 * @returns {{ok: boolean, missing: Array<{name: string, label: string}>}}
 */
export function validateSubmission(meta, entity, page, body) {
  const missing = [];
  if (!meta) return { ok: true, missing };
  for (const name of orderedFields(meta, page)) {
    const edit = editSettings(meta, name);
    if (!edit.required) continue;
    const value = body ? body[name] : undefined;
    if (value === undefined || value === null || value === '') {
      missing.push({ name, label: labelFor(meta, name) });
    }
  }
  return { ok: missing.length === 0, missing };
}

/** Convenience: resolve + load + build in one call. Null when unknown. */
export function loadFormSpec(entity, page, lang) {
  const meta = manifestFor(entity);
  if (!meta) return null;
  return formSpec(meta, meta.entity || entity, page, lang);
}

export function loadViewSpec(entity, lang) {
  const meta = manifestFor(entity);
  if (!meta) return null;
  return viewSpec(meta, meta.entity || entity, lang);
}

export default {
  manifestFor,
  orderedFields,
  labelFor,
  fieldSpec,
  formSpec,
  viewSpec,
  validateSubmission,
  loadFormSpec,
  loadViewSpec,
};
