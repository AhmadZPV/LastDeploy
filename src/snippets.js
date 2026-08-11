/**
 * Dashboard snippets, ported from include/<Dashboard>_events.php.
 *
 * Six snippets exist in the source. Two compute team-scoped numbers
 * (Adressen_Diagramme), four are action links (the Assistent dashboards):
 *
 *   Anzahl_Mieter_Eigent_mer      "Ihre Partner" — Mieter/Eigentümer counts
 *   Objekte__Einheiten_und_Fl_chen "Ihre Verwaltungsgröße" — Objekte/Einheiten
 *                                  counts and round(sum(Breite)*sum(Tiefe))
 *   Assistent_Abrechnungen_snippet  link -> Abrechnungsdruck report
 *   Assistent_Doppelte_Buchf_hrung  link -> Summen und Salden report
 *   Assistent_Doppelte_Buchf_hrung1 link -> Kontenblätter list
 *   Assistent_Doppelte_Buchf_hrung2 link -> Gewinn und Verlust report
 *
 * The PHP functions echo raw HTML; here the handlers return {title, html}
 * and get their data access injected, so the tests never touch a database.
 */

/** The four link buttons, with PHP page names mapped to Node routes. */
export const LINK_SNIPPETS = {
  Assistent_Abrechnungen_snippet: {
    title: 'Abrechnungsdruck',
    href: '/report/abrechnungsdruck',
    label: 'Abrechnungen drucken ...',
    sourceHref: 'Abrechnungsdruck_report.php',
  },
  Assistent_Doppelte_Buchf_hrung: {
    title: 'Summen und Salden drucken',
    href: '/report/summen_und_salden',
    label: 'Summen und Salden ...',
    sourceHref: 'Summen_und_Salden_report.php',
  },
  Assistent_Doppelte_Buchf_hrung1: {
    title: 'Kontenblätter drucken',
    href: '/kontenblaetter',
    label: 'Kontenblätter ...',
    sourceHref: 'Kontenbl_tter_list.php',
  },
  Assistent_Doppelte_Buchf_hrung2: {
    title: 'GuV drucken',
    href: '/report/gewinn_und_verlust',
    label: 'Gewinn und Verlust ...',
    sourceHref: 'Gewinn_und_Verlust_report.php',
  },
};

/** The two computed snippets and the queries behind them. */
export const COUNT_SNIPPETS = {
  Anzahl_Mieter_Eigent_mer: {
    title: 'Ihre Partner',
    lines: [
      { label: 'Mieter', table: 'Adressen', where: { Klassifikation: 'Mieter' } },
      { label: 'Eigentümer', table: 'Adressen', where: { Klassifikation: 'Eigentümer' } },
    ],
  },
};

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Every snippet id the source defines, or null. */
export function getSnippet(id) {
  if (!id) return null;
  if (LINK_SNIPPETS[id]) return { kind: 'link', id, ...LINK_SNIPPETS[id] };
  if (COUNT_SNIPPETS[id]) return { kind: 'counts', id, ...COUNT_SNIPPETS[id] };
  if (id === 'Objekte__Einheiten_und_Fl_chen') {
    return { kind: 'verwaltung', id, title: 'Ihre Verwaltungsgröße' };
  }
  return null;
}

/**
 * Renders a snippet.
 *
 * @param {string} id  the snippetId from dashboards.json
 * @param {object} deps
 * @param {function} [deps.count]  async (table, where) -> number, team-scoped
 *   by the caller
 * @param {function} [deps.sum]    async (table, field) -> number|null
 * @returns {Promise<{title: string, html: string}|null>}
 */
export async function renderSnippet(id, deps = {}) {
  const spec = getSnippet(id);
  if (!spec) return null;

  if (spec.kind === 'link') {
    return {
      title: spec.title,
      html: `<a class="btn btn-primary" href="${esc(spec.href)}">${esc(spec.label)}</a>`,
    };
  }

  if (spec.kind === 'counts') {
    if (typeof deps.count !== 'function') {
      return { title: spec.title, html: '' };
    }
    const parts = [];
    for (const line of spec.lines) {
      const value = await deps.count(line.table, line.where);
      parts.push(`${esc(line.label)}: ${esc(value)}`);
    }
    return { title: spec.title, html: parts.join('<br>') };
  }

  if (spec.kind === 'verwaltung') {
    if (typeof deps.count !== 'function' || typeof deps.sum !== 'function') {
      return { title: spec.title, html: '' };
    }
    const objekte = await deps.count('Objekte', {});
    const einheiten = await deps.count('Einheiten', {});
    // faithful to the source: round(sum(Breite) * sum(Tiefe), 0) — the PHP
    // multiplies the two sums, it does not sum row-wise areas.
    const breite = await deps.sum('Flaechen', 'Breite');
    const tiefe = await deps.sum('Flaechen', 'Tiefe');
    const qm = breite == null || tiefe == null ? 0 : Math.round(Number(breite) * Number(tiefe));
    return {
      title: spec.title,
      html: `Objekte: ${esc(objekte)}<br>Einheiten: ${esc(einheiten)}<br>Flächen: ${esc(qm)} Qm`,
    };
  }

  return null;
}

/** Coverage helper for tests and admin pages. */
export function snippetSummary() {
  return {
    links: Object.keys(LINK_SNIPPETS).length,
    computed: Object.keys(COUNT_SNIPPETS).length + 1,
    total: Object.keys(LINK_SNIPPETS).length + Object.keys(COUNT_SNIPPETS).length + 1,
  };
}

export default { LINK_SNIPPETS, COUNT_SNIPPETS, getSnippet, renderSnippet, snippetSummary };
