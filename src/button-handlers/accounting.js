import { registry } from '../registry.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let templates;
function accountTemplates() {
  if (!templates) {
    templates = JSON.parse(fs.readFileSync(path.join(root, 'src', 'meta', 'account-templates.json'), 'utf8')).profiles;
  }
  return templates;
}

const DUPLICATE_COST = {
  Markierte_duplizieren4: { source: 'kosten', art: 'Umlegbare Kosten', account: 'Umlageart' },
  Markierte_dupliziere: { source: 'vorauszahlungen', art: 'Vorauszahlungen', account: 'Abrechnungskonto' },
  Markierte_duplizieren5: { source: 'direktekosten', art: 'Direkte Kosten', account: 'Abrechnungskonto' },
  Markierte_duplizieren6: { source: 'ruecklagebuchungen', art: null, account: 'Abrechnungskonto' },
};

function delegateFor(prisma, entity) {
  const slug = String(entity || '').toLowerCase();
  const meta = registry[slug];
  return (meta?.model && prisma[meta.model]) || prisma[slug] || null;
}

async function selected(prisma, entity, keys, req, teamWhere) {
  const delegate = delegateFor(prisma, entity);
  if (!delegate) throw new Error(`Unbekannte Quelle: ${entity}`);
  const ids = keys.map(Number).filter(Number.isFinite);
  if (!ids.length) return [];
  return delegate.findMany({ where: teamWhere ? teamWhere(req, { ID: { in: ids } }, String(entity).toLowerCase()) : { ID: { in: ids } } });
}

async function nextNumber(delegate, team) {
  const max = await delegate.aggregate({ _max: { Belegnummer: true }, where: { Team: team } });
  return (max?._max?.Belegnummer || 0) + 1;
}

function booking(row, overrides, session, now, number) {
  return {
    Buchfuehrung: row.Buchfuehrung || null, Konto: row.Konto || null, Gegenkonto: row.Gegenkonto || null,
    Betrag: row.Betrag || null, Datum: now, Betreff: row.Betreff || '', Belegnummer: number,
    Erfasser: session.Benutzername || '', Erfassungsdatum: now,
    DATEV_Betragskennzeichen: row.DATEV_Betragskennzeichen || null,
    DATEV_Steuerschluessel: row.DATEV_Steuerschluessel || null, Team: session.Team,
    ...overrides,
  };
}

export async function runAccountingHandler({ buttId, entity, keys, prisma, req, teamWhere, now = new Date() }) {
  const session = req?.session?.user || {};
  const team = session.Team || 'Team';
  const execute = async (db) => {
    if (['Immobilien', 'Wohnungswirtschaft', 'SKR03', 'SKR04'].includes(buttId)) {
      const [source] = await selected(db, 'buchfuehrungen', keys, req, teamWhere);
      if (!source) throw new Error('Buchführung nicht gefunden');
      const rows = accountTemplates()[buttId] || [];
      let created = 0;
      for (const row of rows) {
        const data = Object.fromEntries(Object.entries(row).map(([field, value]) => [
          field, value === '$BUCHFUEHRUNG' ? source.ID : value === '$TEAM' ? team : value,
        ]));
        const exists = await db.kontenrahmen.findFirst({ where: { Buchfuehrung: source.ID, Nummer: data.Nummer, Team: team } });
        if (!exists) { await db.kontenrahmen.create({ data }); created += 1; }
      }
      return { created, profile: buttId };
    }

    if (buttId === 'BKVo2') {
      const labels = ['Öffentliche Lasten', 'Wasserkosten', 'Wassergrundkosten', 'Entwässerung', 'Regenwasser', 'Müll', 'Straßenreinigung', 'Hausreinigung', 'Gartenpflege', 'Beleuchtung', 'Gebäudeversicherung', 'Haftpflichtversicherung', 'Hausmeister', 'Empfang TV Radio', 'Waschküche', 'Sonstiges'];
      let created = 0;
      for (const Bezeichnung of labels) {
        const exists = await db.kostenarten.findFirst({ where: { Bezeichnung, Team: team, Abrechnungsart: 'Betriebskostenabrechnung' } });
        if (!exists) { await db.kostenarten.create({ data: { Abrechnungsart: 'Betriebskostenabrechnung', Bezeichnung, Team: team } }); created += 1; }
      }
      return { created, profile: 'BKVo2' };
    }

    if (buttId === 'BKVo1') {
      const [row] = await selected(db, 'abrechnungen', keys, req, teamWhere);
      if (!row) throw new Error('Abrechnung nicht gefunden');
      const labels = ['Öffentliche Lasten', 'Wasserkosten', 'Wassergrundkosten', 'Entwässerung', 'Regenwasser', 'Müll', 'Straßenreinigung', 'Hausreinigung', 'Gartenpflege', 'Beleuchtung', 'Gebäudeversicherung', 'Haftpflichtversicherung', 'Hausmeister', 'Empfang TV Radio', 'Waschküche', 'Sonstiges'];
      let created = 0;
      for (const Bezeichnung of labels) {
        const Umlageart = ['Straßenreinigung', 'Gartenpflege', 'Beleuchtung', 'Waschküche', 'Sonstiges'].includes(Bezeichnung) ? 'Einheiten' : 'Quadratmeter';
        await db.kosten.create({ data: { Abrechnung: row.ID, Art: 'Umlegbare Kosten', Bezeichnung, Umlageart, Team: team } }); created += 1;
      }
      return { created, profile: 'BKVo1' };
    }

    if (buttId === 'Kontrollsummen') {
      const [row] = await selected(db, 'abrechnungen', keys, req, teamWhere);
      if (!row) throw new Error('Abrechnung nicht gefunden');
      const accounts = await db.abrechnungskonten.findMany({ where: { Abrechnung: row.ID, Team: team } });
      const units = await db.einheiten.count({ where: { Objekt: row.Objekt, Team: team } });
      const days = Math.max(1, (new Date(row.Bis || now) - new Date(row.Von || now)) / 86400000 + 1);
      const weighted = (field) => Math.round(accounts.reduce((sum, item) => sum + Number(item[field] || 0) * (Math.max(1, (new Date(item.Bis || now) - new Date(item.Von || now)) / 86400000 + 1)), 0) / days * 100) / 100;
      return { kontrollsummen: { Quadratmeter: weighted('Quadratmeter'), Quadratmeter2: weighted('Quadratmeter2'), Quadratmeter3: weighted('Quadratmeter3'), Einheiten: units, Muellverbrauch: accounts.reduce((sum, item) => sum + Number(item.Muellverbrauch || 0), 0), Wasserverbrauch: accounts.reduce((sum, item) => sum + Number(item.Wasserverbrauch || 0), 0), Stromverbrauch: accounts.reduce((sum, item) => sum + Number(item.Stromverbrauch || 0), 0) } };
    }

    if (buttId === 'Splitt') {
      const [row] = await selected(db, entity || 'journal', keys.slice(0, 1), req, teamWhere);
      if (!row) return { created: 0 };
      const created = await db.buchungen.create({ data: booking(row, { Belegnummer: row.Belegnummer }, session, now, row.Belegnummer) });
      return { created: 1, url: `/journal/${created.ID}/edit` };
    }

    if (buttId === 'Markierte_duplizieren1') {
      const rows = await selected(db, entity || 'journal', keys, req, teamWhere);
      let created = 0;
      for (const row of rows) {
        await db.buchungen.create({ data: booking(row, {}, session, now, await nextNumber(db.buchungen, team)) });
        created += 1;
      }
      return { created };
    }

    if (buttId === 'Markierte_duplizieren') {
      const rows = await selected(db, entity || 'kontobuch', keys, req, teamWhere);
      let created = 0;
      for (const row of rows) {
        await db.kontobuch.create({ data: {
          Datum: now, Betrag: row.Betrag, Betreff: row.Betreff, Kategorie: row.Kategorie, Art: row.Art,
          Miete: row.Miete, Nebenkosten: row.Nebenkosten, Heizkosten: row.Heizkosten,
          Garagenmiete: row.Garagenmiete, Abrechnung: row.Abrechnung,
          Abrechnungskonto: row.Abrechnungskonto, Belegnummer: await nextNumber(db.kontobuch, team),
          Verbucht: 0, Team: team,
        } });
        created += 1;
      }
      return { created };
    }

    if (DUPLICATE_COST[buttId]) {
      const spec = DUPLICATE_COST[buttId];
      const rows = await selected(db, entity || spec.source, keys, req, teamWhere);
      for (const row of rows) {
        const tax = Number(row.Mwstsatz || 0);
        const amount = Number(row.Betrag || 0);
        await db.kosten.create({ data: {
          Art: spec.art || row.Art || null, Abrechnung: row.Abrechnung || null,
          Bezeichnung: row.Bezeichnung || '', Betrag: row.Betrag || null,
          ...(spec.account === 'Umlageart' ? { Umlageart: row.Umlageart || null } : { Abrechnungskonto: row.Abrechnungskonto || null }),
          Mwstsatz: row.Mwstsatz || null, Nettobetrag: Math.round((amount / (1 + tax / 100)) * 100) / 100,
          Team: team,
        } });
      }
      return { created: rows.length };
    }

    if (buttId === 'Markierte_buchen') {
      const rows = await selected(db, entity || 'buchungsassistent', keys, req, teamWhere);
      let created = 0;
      for (const row of rows) {
        const number = await nextNumber(db.buchungen, team);
        await db.buchungen.create({ data: booking(row, {}, session, now, number) }); created += 1;
        for (let i = 1; i <= 4; i += 1) {
          if (row[`Sollsplitt${i}_Konto`]) {
            await db.buchungen.create({ data: booking(row, { Konto: row[`Sollsplitt${i}_Konto`], Gegenkonto: row.Gegenkonto, Betrag: row[`Sollsplitt${i}_Betrag`], Betreff: row[`Sollsplitt${i}_Betreff`], Belegnummer: number }, session, now, number) }); created += 1;
          }
          if (row[`Habensplitt${i}_Konto`]) {
            await db.buchungen.create({ data: booking(row, { Konto: row.Konto, Gegenkonto: row[`Habensplitt${i}_Konto`], Betrag: row[`Habensplitt${i}_Betrag`], Betreff: row[`Habensplitt${i}_Betreff`], Belegnummer: number }, session, now, number) }); created += 1;
          }
        }
      }
      return { created };
    }
    return null;
  };
  return typeof prisma.$transaction === 'function' ? prisma.$transaction(execute) : execute(prisma);
}

export const ACCOUNTING_HANDLERS = new Set(['Splitt', 'Markierte_duplizieren1', 'Markierte_duplizieren', 'Markierte_duplizieren4', 'Markierte_dupliziere', 'Markierte_duplizieren5', 'Markierte_duplizieren6', 'Markierte_buchen']);
