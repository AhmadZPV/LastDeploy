/**
 * Phase 10 - saved searches (port of PHPRunner's saved-search feature).
 *
 * Stored as TYPE=2 rows of the settings table `INtex Hausverwaltung_settings`
 * (schema model `INtex_Hausverwaltung_settings`; the Prisma delegate lowercases
 * the first letter: `iNtex_Hausverwaltung_settings`):
 *   ID | TYPE | NAME | USERNAME | COOKIE | SEARCH | TABLENAME
 *
 * SEARCH carries the JSON-serialised search clause. Names are unique per
 * (user, table): saving under an existing name overwrites it, exactly like
 * the source's "Suche speichern" dialog.
 */

const DELEGATES = ['iNtex_Hausverwaltung_settings', 'INtex_Hausverwaltung_settings'];

/** TYPE value the source uses for saved searches (1 = UI preferences). */
export const SAVED_SEARCH_TYPE = 2;

function delegateOf(prisma) {
  for (const name of DELEGATES) {
    if (prisma && prisma[name]) return prisma[name];
  }
  return null;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** The current user's saved searches for one table, newest first. */
export async function listSearches({ prisma, user, table } = {}) {
  const delegate = delegateOf(prisma);
  if (!delegate) return [];
  try {
    const rows = await delegate.findMany({
      where: { TYPE: SAVED_SEARCH_TYPE, USERNAME: String(user || ''), TABLENAME: String(table || '') },
      orderBy: { ID: 'desc' },
    });
    return (rows || []).map((r) => ({
      id: r.ID,
      name: r.NAME,
      table: r.TABLENAME,
      clause: safeParse(r.SEARCH),
    }));
  } catch (e) {
    console.warn('saved-searches: list failed -', e.message);
    return [];
  }
}

/** Save (or overwrite by name) a search for the current user. */
export async function saveSearch({ prisma, user, table, name, clause } = {}) {
  const delegate = delegateOf(prisma);
  if (!delegate) return null;
  const who = String(user || '');
  const tab = String(table || '');
  const label = String(name || '').trim();
  if (!label) throw new Error('Name fehlt');
  const payload = JSON.stringify(clause ?? {});
  try {
    const existing = await delegate.findFirst({
      where: { TYPE: SAVED_SEARCH_TYPE, USERNAME: who, TABLENAME: tab, NAME: label },
    });
    if (existing) {
      await delegate.update({ where: { ID: existing.ID }, data: { SEARCH: payload } });
      return { id: existing.ID, name: label, table: tab, clause, updated: true };
    }
    const row = await delegate.create({
      data: {
        TYPE: SAVED_SEARCH_TYPE,
        NAME: label,
        USERNAME: who,
        COOKIE: '',
        SEARCH: payload,
        TABLENAME: tab,
      },
    });
    return { id: row.ID, name: label, table: tab, clause, updated: false };
  } catch (e) {
    console.warn('saved-searches: save failed -', e.message);
    return null;
  }
}

/** Delete one of the user's own searches by name. */
export async function deleteSearch({ prisma, user, table, name } = {}) {
  const delegate = delegateOf(prisma);
  if (!delegate) return { deleted: false };
  try {
    const existing = await delegate.findFirst({
      where: {
        TYPE: SAVED_SEARCH_TYPE,
        USERNAME: String(user || ''),
        TABLENAME: String(table || ''),
        NAME: String(name || ''),
      },
    });
    if (!existing) return { deleted: false };
    await delegate.delete({ where: { ID: existing.ID } });
    return { deleted: true };
  } catch (e) {
    console.warn('saved-searches: delete failed -', e.message);
    return { deleted: false };
  }
}

export default { listSearches, saveSearch, deleteSearch, SAVED_SEARCH_TYPE };
