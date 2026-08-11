#!/usr/bin/env node
/**
 * Phase 13 enabler - synthetic fixture dataset.
 *
 * The SQL dump of the source is a vorlage (an empty template): 23 of 62
 * tables have zero rows, so charts/reports/exports cannot be validated
 * against it. PLANNING.md therefore calls for ONE meaningful synthetic
 * dataset that both sides (PHP/MariaDB and Node/SQLite) load, so outputs
 * can be compared number by number.
 *
 * This script:
 *   1. derives SQLite DDL from prisma/schema.prisma (no prisma generate needed)
 *   2. creates prisma/dev.db if it does not exist yet (never overwrites one)
 *   3. inserts the fixture idempotently (IDs >= 900000 are the fixture range;
 *      they are deleted and re-inserted on every run)
 *   4. writes prisma/fixture-data.json — the shared dataset definition
 *
 * Usage: node scripts/build-fixture.mjs [--db <path>] [--json-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseSchema } from './import-mysql-dump.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dbArg = args.find((a) => a.startsWith('--db='));
const DBFILE = dbArg ? dbArg.slice(5) : path.join(root, 'prisma', 'dev.db');
const JSON_ONLY = args.includes('--json-only');

const FIXTURE_BASE = 900000; // every fixture row carries an ID above this
const TEAM = 'Team';
const TEAM_B = 'TeamB'; // second tenant, so team scoping is testable

// ---------------------------------------------------------------- DDL

const SQLITE_TYPE = {
  Int: 'INTEGER', BigInt: 'INTEGER', Float: 'NUMERIC', Decimal: 'NUMERIC',
  String: 'TEXT', DateTime: 'TEXT', Boolean: 'INTEGER', Bytes: 'BLOB', Json: 'TEXT',
};

function ddl(schema) {
  const statements = [];
  for (const [table, info] of Object.entries(schema)) {
    const cols = [];
    for (const f of info.fields) {
      const type = SQLITE_TYPE[f.type] || 'TEXT';
      if (f.name === 'rowid' && /Int/.test(f.type)) {
        cols.push(`"${f.column}" INTEGER PRIMARY KEY AUTOINCREMENT`);
      } else if (f.name === 'ID' && /Int/.test(f.type) && !info.fields.some((x) => x.name === 'rowid')) {
        cols.push(`"${f.column}" INTEGER PRIMARY KEY AUTOINCREMENT`);
      } else if (f.name === 'ID') {
        cols.push(`"${f.column}" INTEGER`); // business key next to the rowid shim
      } else {
        cols.push(`"${f.column}" ${type}`);
      }
    }
    statements.push(`CREATE TABLE IF NOT EXISTS "${table}" (\n  ${cols.join(',\n  ')}\n)`);
  }
  return statements;
}

// ---------------------------------------------------------------- fixture
// Values are written with PRISMA field names; insertion maps them to physical
// columns through the schema, so @map (Zubehör etc.) is honoured exactly.

const F = {};

// Owners, tenants, caretakers, suppliers — classification drives 4 charts.
F.Adressen = [
  { ID: 1, Kurzname: 'Meier', Vorname: 'Karl', Nachname: 'Meier', Firma: 'Meier GmbH',
    Strasse: 'Hauptstr. 1', PLZ: '10115', Ort: 'Berlin', Bundesland: 'Berlin', Staat: 'Deutschland',
    Klassifikation: 'Eigentümer', Email: 'meier@example.de', Telefon: '030-1001', Aktiv: 1 },
  { ID: 2, Kurzname: 'Schmidt', Vorname: 'Anna', Nachname: 'Schmidt', Strasse: 'Parkweg 5',
    PLZ: '10117', Ort: 'Berlin', Bundesland: 'Berlin', Staat: 'Deutschland', Klassifikation: 'Mieter',
    Email: 'anna.schmidt@example.de', Telefon: '030-1002', Aktiv: 1 },
  { ID: 3, Kurzname: 'Huber', Vorname: 'Josef', Nachname: 'Huber', Strasse: 'Marienplatz 8',
    PLZ: '80331', Ort: 'München', Bundesland: 'Bayern', Staat: 'Deutschland', Klassifikation: 'Mieter',
    Email: 'huber@example.de', Aktiv: 1 },
  { ID: 4, Kurzname: 'Becker', Vorname: 'Claudia', Nachname: 'Becker', Firma: 'Becker Verwaltung',
    Strasse: 'Wiesenweg 3', PLZ: '60311', Ort: 'Frankfurt am Main', Bundesland: 'Hessen',
    Staat: 'Deutschland', Klassifikation: 'Verwalter', Email: 'becker@example.de', Aktiv: 1 },
  { ID: 5, Kurzname: 'Wagner Bau', Firma: 'Wagner Bau GmbH', Strasse: 'Industriestr. 44',
    PLZ: '50667', Ort: 'Köln', Bundesland: 'Nordrhein-Westfalen', Staat: 'Deutschland',
    Klassifikation: 'Handwerker', Email: 'kontakt@wagner-bau.example.de', Aktiv: 1 },
  { ID: 6, Kurzname: 'Stadtwerke', Firma: 'Stadtwerke Berlin', PLZ: '10110', Ort: 'Berlin',
    Bundesland: 'Berlin', Staat: 'Deutschland', Klassifikation: 'Lieferant', Aktiv: 1 },
  { ID: 7, Kurzname: 'Novak', Vorname: 'Petra', Nachname: 'Novak', Strasse: 'Graben 21',
    PLZ: '1010', Ort: 'Wien', Staat: 'Österreich', Bundesland: 'Wien', Klassifikation: 'Mieter', Aktiv: 1 },
  { ID: 8, Kurzname: 'Lehmann', Vorname: 'Torsten', Nachname: 'Lehmann', PLZ: '20144',
    Ort: 'Hamburg', Bundesland: 'Hamburg', Staat: 'Deutschland', Klassifikation: 'Eigentümer', Aktiv: 1 },
  // second tenant — proves team scoping
  { ID: 9, Kurzname: 'TeamB Kontakt', Nachname: 'Fremd', Ort: 'Berlin', Bundesland: 'Berlin',
    Staat: 'Deutschland', Klassifikation: 'Mieter', Team: TEAM_B, Aktiv: 1 },
];

F.Objekte = [
  { ID: 1, Bezeichnung: 'Wohnhaus Hauptstraße', Nummer: 1, Objektart: 'Wohnhaus',
    Anschrift: 'Hauptstr. 1, 10115 Berlin', Besitzer: 1, Wohnflaeche: 320, Nutzflaeche: 40,
    Grundstuecksgroesse: 650, Kaltmiete: 3200, Aktiv: 1 },
  { ID: 2, Bezeichnung: 'Gewerbehof Berliner Allee', Nummer: 2, Objektart: 'Gewerbe',
    Anschrift: 'Berliner Allee 12, 10115 Berlin', Besitzer: 1, Wohnflaeche: 0, Nutzflaeche: 480,
    Grundstuecksgroesse: 900, Kaltmiete: 5400, Aktiv: 1 },
  { ID: 3, Bezeichnung: 'Mehrfamilienhaus Parkweg', Nummer: 3, Objektart: 'Wohnhaus',
    Anschrift: 'Parkweg 5, 10117 Berlin', Besitzer: 8, Wohnflaeche: 560, Nutzflaeche: 60,
    Grundstuecksgroesse: 1100, Kaltmiete: 6100, Aktiv: 1 },
  { ID: 4, Bezeichnung: 'Bürohaus Westend', Nummer: 4, Objektart: 'Büro',
    Anschrift: 'Westend 3, 60311 Frankfurt am Main', Besitzer: 8, Wohnflaeche: 0, Nutzflaeche: 300,
    Kaltmiete: 3900, Aktiv: 1 },
  { ID: 5, Bezeichnung: 'TeamB Objekt', Nummer: 5, Objektart: 'Wohnhaus',
    Besitzer: 9, Wohnflaeche: 200, Team: TEAM_B, Aktiv: 1 },
];

// Nutzer NULL/'' => Leerstand, exactly what the Leerstandsquote chart tests.
F.Einheiten = [
  { ID: 1, Bezeichnung: 'Whg 1 links', Objekt: 1, Einheitenart: 'Wohnung', Etage: 'EG',
    Nutzer: 2, Kaltmiete: 850, Wohnflaeche: 75, Zimmer: 3, Aktiv: 1 },
  { ID: 2, Bezeichnung: 'Whg 1 rechts', Objekt: 1, Einheitenart: 'Wohnung', Etage: 'EG',
    Nutzer: 3, Kaltmiete: 920, Wohnflaeche: 82, Zimmer: 3, Aktiv: 1 },
  { ID: 3, Bezeichnung: 'Whg 2 OG', Objekt: 1, Einheitenart: 'Wohnung', Etage: '1. OG',
    Nutzer: null, Kaltmiete: 880, Wohnflaeche: 78, Zimmer: 3, Aktiv: 1 },
  { ID: 4, Bezeichnung: 'Laden EG', Objekt: 2, Einheitenart: 'Laden', Etage: 'EG',
    Nutzer: 6, Kaltmiete: 2400, Nutzflaeche: 160, Aktiv: 1 },
  { ID: 5, Bezeichnung: 'Büro 1.OG', Objekt: 2, Einheitenart: 'Büro', Etage: '1. OG',
    Nutzer: 4, Kaltmiete: 1800, Nutzflaeche: 120, Aktiv: 1 },
  { ID: 6, Bezeichnung: 'Whg Parkweg 1', Objekt: 3, Einheitenart: 'Wohnung', Etage: 'EG',
    Nutzer: 7, Kaltmiete: 1150, Wohnflaeche: 95, Zimmer: 4, Aktiv: 1 },
  { ID: 7, Bezeichnung: 'Whg Parkweg 2', Objekt: 3, Einheitenart: 'Wohnung', Etage: '1. OG',
    Nutzer: null, Kaltmiete: 1090, Wohnflaeche: 88, Zimmer: 3, Aktiv: 1 },
  { ID: 8, Bezeichnung: 'Garage 1', Objekt: 1, Einheitenart: 'Garage', Nutzer: 2,
    Kaltmiete: 80, Aktiv: 1 },
  { ID: 9, Bezeichnung: 'TeamB Einheit', Objekt: 5, Einheitenart: 'Wohnung', Nutzer: 9,
    Kaltmiete: 700, Team: TEAM_B, Aktiv: 1 },
];

F.Vertraege = [
  { ID: 1, Bezeichnung: 'Mietvertrag Schmidt', Einheit: 1, Objekt: 1, Adresse: 2,
    Datum: '2024-02-01', Kaltmiete: 850, NK_Vorauszahlung: 150, HK_Vorauszahlung: 90, Art: 'Miete' },
  { ID: 2, Bezeichnung: 'Mietvertrag Huber', Einheit: 2, Objekt: 1, Adresse: 3,
    Datum: '2024-06-15', Kaltmiete: 920, NK_Vorauszahlung: 160, HK_Vorauszahlung: 95, Art: 'Miete' },
  { ID: 3, Bezeichnung: 'Gewerbemietvertrag Stadtwerke', Einheit: 4, Objekt: 2, Adresse: 6,
    Datum: '2023-11-01', Kaltmiete: 2400, NK_Vorauszahlung: 400, Art: 'Gewerbemiete' },
  { ID: 4, Bezeichnung: 'Mietvertrag Novak', Einheit: 6, Objekt: 3, Adresse: 7,
    Datum: '2025-01-01', Kaltmiete: 1150, NK_Vorauszahlung: 180, HK_Vorauszahlung: 110, Art: 'Miete' },
];

// Bookings across 2025-2026: income and expenses, categories drive 3 charts.
const RENT = [
  ['Miete Whg 1 links', 850, 1], ['Miete Whg 1 rechts', 920, 2], ['Miete Laden', 2400, 4],
  ['Miete Büro', 1800, 5], ['Miete Parkweg 1', 1150, 6], ['Garagenmiete', 80, 8],
];
F.Kontobuch = [];
{
  let id = 0;
  let beleg = 0;
  for (const [month, factor] of [['2025-01', 1], ['2025-02', 1], ['2025-03', 1],
                                 ['2025-04', 1], ['2025-05', 1], ['2025-06', 1],
                                 ['2026-01', 1.02], ['2026-02', 1.02]]) { // small rent raise in 2026
    for (const [betreff, betrag, konto] of RENT) {
      id += 1; beleg += 1;
      F.Kontobuch.push({
        ID: id, Datum: `${month}-05`, Betrag: Math.round(betrag * factor * 100) / 100,
        Betreff: betreff, Kategorie: 'Miete', Art: 'Einnahme', Abrechnungskonto: konto,
        Belegnummer: beleg, Verbucht: 1, Erfassungsdatum: `${month}-05`,
      });
    }
  }
  const COSTS = [
    ['Heizöl Lieferung', 'Heizkosten', 1450.5, '2025-02-11'],
    ['Strom Allgemein', 'Strom', 320.9, '2025-03-03'],
    ['Reparatur Heizung', 'Instandhaltung', 780, '2025-04-18'],
    ['Gebäudeversicherung', 'Versicherung', 612.3, '2025-05-06'],
    ['Müllabfuhr', 'Nebenkosten', 96.4, '2025-06-02'],
    ['Winterdienst', 'Nebenkosten', 140, '2026-01-13'],
    ['Dachrinnen Reinigung', 'Instandhaltung', 210, '2026-02-21'],
    ['Wasser/Abwasser', 'Nebenkosten', 388.7, '2026-02-25'],
  ];
  for (const [betreff, kategorie, betrag, datum] of COSTS) {
    id += 1; beleg += 1;
    F.Kontobuch.push({
      ID: id, Datum: datum, Betrag: betrag, Betreff: betreff, Kategorie: kategorie,
      Art: 'Ausgabe', Abrechnungskonto: 1, Belegnummer: beleg, Verbucht: 1, Erfassungsdatum: datum,
    });
  }
  id += 1;
  F.Kontobuch.push({ ID: id, Datum: '2026-03-01', Betrag: 700, Betreff: 'TeamB Miete',
    Kategorie: 'Miete', Art: 'Einnahme', Belegnummer: 1, Team: TEAM_B, Verbucht: 1 });
}

F.Abrechnungen = [
  { ID: 1, Bezeichnung: 'Nebenkostenabrechnung 2024', Von: '2024-01-01', Bis: '2024-12-31',
    Objekt: 1, Quadratmeter: 320, Einheiten: 3, Wasserverbrauch: 210, Stromverbrauch: 900,
    Waermeverbrauch: 14500, Erledigt: 1 },
  { ID: 2, Bezeichnung: 'Nebenkostenabrechnung 2025', Von: '2025-01-01', Bis: '2025-12-31',
    Objekt: 1, Quadratmeter: 320, Einheiten: 3, Wasserverbrauch: 226, Stromverbrauch: 940,
    Waermeverbrauch: 15100, Erledigt: 0 },
];

F.Abrechnungskonten = [
  { ID: 1, Bezeichnung: 'Konto Whg 1 links', Von: '2025-01-01', Bis: '2025-12-31',
    Einheit: 1, Objekt: 1, Abrechnung: 2, Quadratmeter: 75, Wasserverbrauch: 62,
    Stromverbrauch: 210, Waermeverbrauch: 4100, Personen: 2 },
  { ID: 2, Bezeichnung: 'Konto Whg 1 rechts', Von: '2025-01-01', Bis: '2025-12-31',
    Einheit: 2, Objekt: 1, Abrechnung: 2, Quadratmeter: 82, Wasserverbrauch: 74,
    Stromverbrauch: 260, Waermeverbrauch: 4600, Personen: 2 },
  { ID: 3, Bezeichnung: 'Konto Whg 2 OG', Von: '2025-01-01', Bis: '2025-12-31',
    Einheit: 3, Objekt: 1, Abrechnung: 2, Quadratmeter: 78, Wasserverbrauch: 0,
    Stromverbrauch: 40, Waermeverbrauch: 800, Personen: 0 },
  { ID: 4, Bezeichnung: 'Konto Laden', Von: '2025-01-01', Bis: '2025-12-31',
    Einheit: 4, Objekt: 2, Abrechnung: 2, Quadratmeter: 160, Wasserverbrauch: 40,
    Stromverbrauch: 300, Waermeverbrauch: 3100, Personen: 3 },
];

F.Kosten = [
  { ID: 1, Abrechnung: 2, Bezeichnung: 'Heizkosten', Betrag: 2380.4, Umlageart: 'Quadratmeter',
    Art: 'Umlegbare Kosten', Abrechnungskonto: 1 },
  { ID: 2, Abrechnung: 2, Bezeichnung: 'Wasser/Abwasser', Betrag: 388.7, Umlageart: 'Personen',
    Art: 'Umlegbare Kosten', Abrechnungskonto: 1 },
  { ID: 3, Abrechnung: 2, Bezeichnung: 'Müllabfuhr', Betrag: 96.4, Umlageart: 'Einheiten',
    Art: 'Umlegbare Kosten', Abrechnungskonto: 1 },
  { ID: 4, Abrechnung: 2, Bezeichnung: 'Gebäudeversicherung', Betrag: 612.3,
    Umlageart: 'Quadratmeter', Art: 'Umlegbare Kosten', Abrechnungskonto: 1 },
  { ID: 5, Abrechnung: 2, Bezeichnung: 'Verwaltungskosten', Betrag: 300,
    Umlageart: 'Einheiten', Art: 'Nicht umlegbar', Abrechnungskonto: 1 },
];

F.Inventar = [
  { ID: 1, Bezeichnung: 'Heizkessel Viessmann', Kategorie: 'Heizung', Anzahl: 1,
    Raum: 1, Hersteller: 5, Verkaeufer: 6, Zustand: 'gut', Einkaufspreis: 4800,
    Einkaufsdatum: '2019-05-20', Objekt: '1', Kontrolliert: 1 },
  { ID: 2, Bezeichnung: 'Wasseraufbereitung', Kategorie: 'Sanitär', Anzahl: 1,
    Raum: 1, Hersteller: 5, Verkaeufer: 6, Zustand: 'gut', Objekt: '1' },
  { ID: 3, Bezeichnung: 'Aufzug Steuerung', Kategorie: 'Aufzug', Anzahl: 1,
    Raum: 2, Hersteller: 6, Verkaeufer: 6, Zustand: 'wartung', Objekt: '3' },
  { ID: 4, Bezeichnung: 'Rauchmelder Set', Kategorie: 'Elektro', Anzahl: 24,
    Raum: 3, Hersteller: 5, Verkaeufer: 5, Zustand: 'neu', Objekt: '1' },
  { ID: 5, Bezeichnung: 'Dachfenster Velux', Kategorie: 'Dach', Anzahl: 6,
    Raum: 2, Hersteller: 5, Verkaeufer: 5, Zustand: 'gut', Objekt: '3' },
  { ID: 6, Bezeichnung: 'Gartengeräte Set', Kategorie: 'Sonstiges', Anzahl: 1,
    Raum: 3, Hersteller: 6, Verkaeufer: 6, Zustand: 'gut', Objekt: '1' },
];

F.Termine = [
  { ID: 1, Titel: 'Eigentümerversammlung', Datum: '2026-09-15', Uhrzeit: '2026-09-15T18:00:00',
    Dauer: 120, Zustaendigkeit: 4, Benutzer: 'admin', Adresse: 1, Kalender: 'Verwaltung' },
  { ID: 2, Titel: 'Heizungswartung', Datum: '2026-09-02', Uhrzeit: '2026-09-02T09:00:00',
    Dauer: 90, Zustaendigkeit: 5, Benutzer: 'admin', Kalender: 'Wartung' },
  { ID: 3, Titel: 'Übergabe Whg Parkweg 2', Datum: '2026-10-01', Uhrzeit: '2026-10-01T11:00:00',
    Dauer: 60, Benutzer: 'admin', Kalender: 'Verwaltung' },
];

F.Aufgaben = [
  { ID: 1, Titel: 'Dachrinne Parkweg prüfen', Datum: '2026-08-20', Bearbeitungstatus: 'Offen',
    Prioritaet: 2, Benutzer: 'admin', Objekt: 3 },
  { ID: 2, Titel: 'Nebenkostenabrechnung 2025 versenden', Datum: '2026-09-30',
    Bearbeitungstatus: 'In Bearbeitung', Prioritaet: 1, Benutzer: 'admin', Objekt: 1 },
  { ID: 3, Titel: 'Rauchmelder Wartung', Datum: '2026-08-10', Bearbeitungstatus: 'Erledigt',
    Prioritaet: 3, Benutzer: 'admin', Objekt: 1 },
];

F.Notizen = [
  { ID: 1, Titel: 'Wartungsvertrag Heizung', Notiztext: 'Wartung jedes Jahr im September.',
    Benutzer: 'admin', Adresse: 5, Objekt: 1 },
  { ID: 2, Titel: 'Mieterhöhung 2026', Notiztext: 'Miete ab Januar 2026 um 2% erhöht.',
    Benutzer: 'admin', Adresse: 2, Objekt: 1 },
];

F.WV = [
  { ID: 1, Tag: '2026-08-20' },
  { ID: 2, Tag: '2026-09-02' },
  { ID: 3, Tag: '2026-09-30' },
];

F.Kontenrahmen = [
  { ID: 1, Buchfuehrung: 'SKR04', Klasse: '0', Nummer: '0100', Kontobezeichnung: 'Grundstücke' },
  { ID: 2, Buchfuehrung: 'SKR04', Klasse: '1', Nummer: '1200', Kontobezeichnung: 'Bank' },
  { ID: 3, Buchfuehrung: 'SKR04', Klasse: '4', Nummer: '4400', Kontobezeichnung: 'Mieteinnahmen' },
  { ID: 4, Buchfuehrung: 'SKR04', Klasse: '4', Nummer: '4500', Kontobezeichnung: 'Nebenkosten' },
  { ID: 5, Buchfuehrung: 'SKR04', Klasse: '6', Nummer: '6300', Kontobezeichnung: 'Instandhaltung' },
];

// Dev login (planning doc: admin / Online@1234). Plaintext on purpose: the
// login route accepts it and the migration step hashes it on first login.
F.Benutzer = [
  { ID: 1, Benutzername: 'admin', Passwort: 'Online@1234', Name: 'Administrator',
    Email: 'admin@example.de', active: 1, Gruppe: 'Admins' },
  { ID: 2, Benutzername: 'mitarbeiter', Passwort: 'mitarbeiter123', Name: 'Max Mitarbeiter',
    Email: 'mitarbeiter@example.de', active: 1, Gruppe: 'Mitarbeiter', Team: TEAM_B },
];

F['intex hausverwaltung_uggroups'] = [
  { GroupID: 1, Label: 'Admins' },
  { GroupID: 2, Label: 'Mitarbeiter' },
];
F['intex hausverwaltung_ugmembers'] = [
  { UserName: 'admin', GroupID: 1 },
  { UserName: 'mitarbeiter', GroupID: 2 },
];
F['intex hausverwaltung_ugrights'] = [
  { TableName: 'Objekte', GroupID: 2, AccessMask: 'S' },
  { TableName: 'Einheiten', GroupID: 2, AccessMask: 'S' },
  { TableName: 'Adressen', GroupID: 2, AccessMask: 'SE' },
  { TableName: 'Aufgaben', GroupID: 2, AccessMask: 'SAED' },
];

F.Einstellungen = [
  { ID: 1, Waehrung: 'EUR', Team: TEAM },
];

// ------------------------------------------------------------- insertion

function toColumns(info, row) {
  const cols = [];
  const vals = [];
  const unknown = [];
  for (const [key, value] of Object.entries(row)) {
    const f = info.fields.find((x) => x.name === key || x.column === key);
    if (!f) { unknown.push(key); continue; }
    cols.push('"' + f.column + '"');
    vals.push(value === undefined ? null : value);
  }
  return { cols, vals, unknown };
}

function keyColumn(info) {
  const id = info.fields.find((f) => f.name === 'ID');
  if (id) return id.column;
  const gid = info.fields.find((f) => /^(GroupID)$/.test(f.name));
  return gid ? gid.column : null;
}

function main() {
  const schema = parseSchema();

  // 1. the shared dataset definition, consumable by both ports
  const jsonPath = path.join(root, 'prisma', 'fixture-data.json');
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ team: TEAM, extraTeams: [TEAM_B], tables: F }, null, 1));
  console.log('fixture definition ->', path.relative(root, jsonPath));
  if (JSON_ONLY) return;

  // 2. create the database only when absent — never clobber real data
  const existed = fs.existsSync(DBFILE);
  const db = new DatabaseSync(DBFILE);
  if (!existed) {
    for (const stmt of ddl(schema)) db.exec(stmt);
    console.log('created', path.relative(root, DBFILE), 'with', Object.keys(schema).length, 'tables');
  } else {
    for (const stmt of ddl(schema)) db.exec(stmt); // CREATE IF NOT EXISTS: harmless
    console.log('using existing', path.relative(root, DBFILE));
  }

  // 3. idempotent insert: wipe the fixture range, then re-insert
  let total = 0;
  for (const [table, rows] of Object.entries(F)) {
    const info = schema[table];
    if (!info) { console.warn('  !! no model for table', table); continue; }
    const key = keyColumn(info);
    if (key) db.prepare(`DELETE FROM "${table}" WHERE "${key}" >= ?`).run(FIXTURE_BASE);
    // composite tables (ugmembers) have no numeric key: wipe the fixture rows by content
    if (table === 'intex hausverwaltung_ugmembers') {
      db.prepare(`DELETE FROM "${table}" WHERE "GroupID" >= 1 AND "UserName" IN ('admin','mitarbeiter')`).run();
    }
    let n = 0;
    const warned = new Set();
    for (const raw of rows) {
      // shift small IDs into the fixture range on numeric key columns
      const row = { ...raw };
      if (key && typeof row[key === 'ID' ? 'ID' : key] === 'number') {
        const name = info.fields.find((f) => f.column === key)?.name;
        if (name && row[name] < FIXTURE_BASE) row[name] = row[name] + FIXTURE_BASE;
      }
      const { cols, vals, unknown } = toColumns(info, row);
      for (const u of unknown) {
        if (!warned.has(u)) { warned.add(u); console.warn(`  ?? ${table}: unknown field ${u}`); }
      }
      // keep the small FK references intact: only key columns shift
      db.prepare(`INSERT INTO "${table}" (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...vals);
      n += 1;
    }
    total += n;
    console.log(`  ${table.padEnd(34)} ${n} rows`);
  }
  console.log(`fixture loaded: ${total} rows across ${Object.keys(F).length} tables`);
  db.close();
}

main();
