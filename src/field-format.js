/**
 * Metadata-driven field formatting.
 *
 * `src/formatters.js` guesses a field's nature from its name. That was a
 * reasonable bootstrap, but the source actually ships the answer: every one of
 * the 2,896 extracted fields carries a `view` and an `edit` block taken from
 * `include/<Entity>_settings.php`. This module reads those blocks instead of
 * guessing, and mirrors what ViewControlsContainer / EditControlsContainer do
 * with them.
 *
 * Keys that really exist in the extracted metadata (verified by counting):
 *   view.NeedEncode      2631   htmlspecialchars() the value before printing
 *   view.DecimalDigits    560   fixed decimal places (2, 0, 1 or 6)
 *   view.ShowThumbnail     23   render an image control, not a download link
 *   edit.HTML5InuptType  1695   text | number | email | tel | url
 *   edit.IsRequired      1111
 *   edit.controlWidth    2896
 *   edit.LookupTable      486   plus LinkField / DisplayField / LookupWhere /
 *                              LookupOrderBy / LookupType / AllowToAdd
 *   edit.acceptFileTypes 2896   (see src/uploads.js)
 *
 * The module is deliberately dependency-free so it can be unit tested without
 * touching Prisma or server.js.
 */

export const DEFAULT_DECIMALS = 2;

/** Credential columns are masked on every read-only surface. */
const SECRET_NAME = /(passwort|password|passwd|kennwort|secret|token|apikey|api_key)/i;
export const SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
export function isSecretField(name) {
  return SECRET_NAME.test(String(name || ''));
}

/** Lookup control types used by PHPRunner (LookupType / LCType). */
export const LOOKUP_TYPES = {
  1: 'text',
  2: 'dropdown',
  3: 'ajax',
  4: 'radio',
  5: 'checkbox',
};

const NUMBER_FORMATTERS = new Map();

function numberFormatter(digits) {
  const key = String(digits);
  let fmt = NUMBER_FORMATTERS.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    NUMBER_FORMATTERS.set(key, fmt);
  }
  return fmt;
}

/** htmlspecialchars() equivalent, applied when view.NeedEncode is set. */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Finds a field in a loaded entity manifest. `meta.fields` is an array, not an
 * object, so a plain property lookup silently returns undefined.
 */
export function fieldMeta(meta, name) {
  const fields = meta && Array.isArray(meta.fields) ? meta.fields : [];
  return fields.find((f) => f && f.name === name) || null;
}

/** The `view` half of a field's settings, with the source defaults applied. */
export function viewSettings(meta, name) {
  const field = fieldMeta(meta, name);
  const view = (field && field.view) || {};
  const digits = view.DecimalDigits;
  return {
    exists: Boolean(field),
    needEncode: view.NeedEncode === true || view.NeedEncode === 1,
    decimalDigits: typeof digits === 'number' ? digits : null,
    showThumbnail: view.ShowThumbnail === true || view.ShowThumbnail === 1,
  };
}

/** The `edit` half: input type, requiredness, width and the lookup wiring. */
export function editSettings(meta, name) {
  const field = fieldMeta(meta, name);
  const edit = (field && field.edit) || {};
  return {
    exists: Boolean(field),
    inputType: edit.HTML5InuptType || 'text',
    required: edit.IsRequired === true || edit.IsRequired === 1,
    width: typeof edit.controlWidth === 'number' ? edit.controlWidth : null,
    selectSize: typeof edit.SelectSize === 'number' ? edit.SelectSize : null,
    allowToAdd: edit.AllowToAdd === true || edit.AllowToAdd === 1,
    lookup: lookupSpec(meta, name),
  };
}

/**
 * The lookup definition behind a field, or null when it is a plain input.
 * `LookupWhere` is carried through verbatim: it is raw SQL from the source and
 * the caller decides whether it can honour it.
 */
export function lookupSpec(meta, name) {
  const field = fieldMeta(meta, name);
  const edit = (field && field.edit) || {};
  if (!edit.LookupTable) return null;
  const type = edit.LookupType || edit.LCType || null;
  return {
    table: edit.LookupTable,
    linkField: edit.LinkField || 'ID',
    displayField: edit.DisplayField || edit.LinkField || 'ID',
    where: edit.LookupWhere || null,
    orderBy: edit.LookupOrderBy || null,
    type,
    control: LOOKUP_TYPES[type] || 'dropdown',
    allowToAdd: edit.AllowToAdd === true || edit.AllowToAdd === 1,
  };
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/**
 * Formats a number with the field's own precision. A field that declares
 * DecimalDigits: 6 must not be rounded to the generic two places.
 */
export function formatNumber(value, digits = DEFAULT_DECIMALS) {
  const n = toNumber(value);
  if (n == null) return '';
  const d = typeof digits === 'number' ? digits : DEFAULT_DECIMALS;
  return numberFormatter(d).format(n);
}

/**
 * Chooses the display control for a field, in the same order the source does:
 * an explicit thumbnail flag wins, then a binary column, then a declared
 * precision, then the lookup wiring, and only then the name heuristic.
 *
 * @param {object} meta   entity manifest
 * @param {string} name   field name
 * @param {*} value       the raw column value
 * @param {string} [fallback] category from src/formatters.js fieldCategory()
 */
export function displayCategory(meta, name, value, fallback = 'text') {
  const view = viewSettings(meta, name);
  if (view.showThumbnail) return 'image';
  if (Buffer.isBuffer(value)) return 'file';
  if (view.decimalDigits != null) return 'number';
  if (lookupSpec(meta, name)) return 'lookup';
  return fallback;
}

/**
 * Renders one cell for a read-only page.
 *
 * @param {object} opts
 * @param {string} opts.entitySlug  used to build media/download URLs
 * @param {string|number} opts.id   the row key
 * @param {string} [opts.fallback]  heuristic category from formatters.js
 * @param {string} [opts.lookupText] resolved display value for a lookup field
 * @param {number} [opts.thumbSize]
 * @returns {string} HTML
 */
export function renderView(meta, name, value, opts = {}) {
  const { entitySlug = '', id = '', thumbSize = 80 } = opts;
  if (isSecretField(name)) return value == null || value === '' ? '' : SECRET_MASK;
  const view = viewSettings(meta, name);
  const category = displayCategory(meta, name, value, opts.fallback || 'text');
  const encode = (v) => (view.needEncode ? escapeHtml(v) : String(v == null ? '' : v));

  if (value == null || value === '') return '';

  if (category === 'image') {
    const src = mediaUrl(entitySlug, id, name);
    const alt = escapeHtml(name);
    return `<img class="field-thumb" src="${src}" alt="${alt}" width="${thumbSize}" loading="lazy" />`;
  }

  if (category === 'file') {
    const href = downloadUrl(entitySlug, id, name);
    const size = Buffer.isBuffer(value) ? value.length : null;
    const label = size == null ? 'Download' : `Download (${formatBytes(size)})`;
    return `<a class="field-file" href="${href}">${label}</a>`;
  }

  if (category === 'number') {
    return formatNumber(value, view.decimalDigits);
  }

  if (category === 'lookup') {
    // The stored value is a foreign key; show the resolved text when the
    // caller could look it up, otherwise fall back to the key itself.
    const text = opts.lookupText != null ? opts.lookupText : value;
    return encode(text);
  }

  return encode(value);
}

/** Human readable byte count, used in file links. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${formatNumber(n / 1024, 1)} KB`;
  return `${formatNumber(n / (1024 * 1024), 1)} MB`;
}

/** The route that streams an image field (routes/media.js). */
export function mediaUrl(entitySlug, id, field) {
  return `/media/${encodeURIComponent(entitySlug)}/${encodeURIComponent(id)}/${encodeURIComponent(field)}`;
}

/** The route that downloads a binary field (routes/files.js). */
export function downloadUrl(entitySlug, id, field) {
  return `/file/get/${encodeURIComponent(entitySlug)}/${encodeURIComponent(id)}/${encodeURIComponent(field)}`;
}

/**
 * Attributes for an <input> in add/edit forms, derived from the edit block.
 * Returned as a plain object so the EJS partial can spread it without having
 * to know the metadata layout.
 */
export function inputAttributes(meta, name) {
  const edit = editSettings(meta, name);
  const attrs = {
    name,
    type: edit.inputType,
  };
  if (edit.required) attrs.required = true;
  if (edit.width) attrs.style = `width:${edit.width}px`;
  if (edit.inputType === 'number') {
    const view = viewSettings(meta, name);
    if (view.decimalDigits != null) {
      attrs.step = view.decimalDigits === 0
        ? '1'
        : `0.${'0'.repeat(view.decimalDigits - 1)}1`;
    }
  }
  return attrs;
}

/** Renders an attribute object as an HTML fragment, escaping every value. */
export function attributesToHtml(attrs) {
  return Object.entries(attrs || {})
    .filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? k : `${k}="${escapeHtml(v)}"`))
    .join(' ');
}

export default {
  escapeHtml,
  fieldMeta,
  viewSettings,
  editSettings,
  lookupSpec,
  formatNumber,
  displayCategory,
  renderView,
  formatBytes,
  mediaUrl,
  downloadUrl,
  inputAttributes,
  attributesToHtml,
  DEFAULT_DECIMALS,
  LOOKUP_TYPES,
};
