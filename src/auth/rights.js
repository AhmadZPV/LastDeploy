/**
 * Access-mask helpers shared by the admin UI and the permission checks.
 *
 * The PHP stores one AccessMask string per (TableName, GroupID) in
 * `intex hausverwaltung_ugrights`. Each letter grants one capability.
 * See include/commonfunctions.php CheckSecurity() / the AccessMask notes.
 */

/** Canonical order used everywhere we render or normalise a mask. */
export const MASK_LETTERS = ['S', 'A', 'E', 'D', 'P', 'M', 'I'];

export const MASK_LABELS = {
  S: 'Suchen/Ansehen',   // list, search, export, view, detailspreview
  A: 'Hinzuf\u00fcgen',       // add
  E: 'Bearbeiten',       // edit
  D: 'L\u00f6schen',          // delete
  P: 'Drucken',          // print / pdf / report
  M: 'Alle Datens\u00e4tze',  // owner-only override: M present => no owner filter
  I: 'Importieren',      // import
};

/** Everything except the owner-override, i.e. a normal full-access group. */
export const FULL_MASK = 'SAEDPMI';

/**
 * Normalise arbitrary input (string, array of letters, or a checkbox map)
 * into a canonical, de-duplicated, correctly ordered mask string.
 */
export function normalizeMask(input) {
  let letters = [];
  if (Array.isArray(input)) letters = input;
  else if (input && typeof input === 'object') {
    letters = Object.entries(input).filter(([, v]) => v && v !== '0' && v !== 'off').map(([k]) => k);
  } else if (typeof input === 'string') letters = input.split('');
  const set = new Set(letters.map((c) => String(c).trim().toUpperCase()).filter(Boolean));
  return MASK_LETTERS.filter((c) => set.has(c)).join('');
}

/** True when `mask` contains every letter in `needed`. */
export function maskHas(mask, needed) {
  const m = String(mask || '').toUpperCase();
  return String(needed || '').toUpperCase().split('').every((c) => m.includes(c));
}

/** Turn a mask into a {S:true, A:false, ...} map for rendering checkboxes. */
export function maskToMap(mask) {
  const m = String(mask || '').toUpperCase();
  return Object.fromEntries(MASK_LETTERS.map((c) => [c, m.includes(c)]));
}

export default { MASK_LETTERS, MASK_LABELS, FULL_MASK, normalizeMask, maskHas, maskToMap };
