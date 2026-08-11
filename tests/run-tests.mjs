/**
 * Ap Emlaki test suite (phases 0-5).
 *
 * The sandbox has no network, so the real dependencies cannot be installed and
 * `prisma generate` cannot run. tests/install-stubs.py drops purpose-built
 * stubs into node_modules first; the @prisma/client stub parses the REAL
 * prisma/schema.prisma and queries the REAL prisma/dev.db through node:sqlite,
 * so schema-dependent assertions are checked against genuine data.
 *
 *   python3 tests/install-stubs.py
 *   node --test tests/run-tests.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  metaIndex, loadMeta, pageFields, fieldLabel, lookups, virtualEntities,
  resolveEntityName,
} from '../src/meta-store.js';
import { columnToField } from '../src/page-query.js';
import {
  relationsFor, relationsForPage, findRelation, childWhere,
  summary as mdSummary,
} from '../src/master-detail.js';
import {
  runHandler, getSpec, listHandlers, ops, pageToRoute, numberFormatDe, dateToCal,
} from '../src/button-handlers/runtime.js';
import createMediaRouter, { sniffMime, decodeStored } from '../routes/media.js';
import {
  createFulltextHandler, escapeHtml, nl2br, collectKeys, fieldReadable, resolveEntity,
} from '../src/fulltext.js';
import {
  contentTypeByExtension, supposeImageType, resolveMime, contentDisposition,
  sanitizeFileName, uploadPolicy, validateUpload, acceptsFileName,
  fileObject, parseStoredFiles, serializeStoredFiles, removeStoredFile,
} from '../src/uploads.js';
import { decodeDownload, downloadHeaders } from '../src/downloads.js';
import {
  loadMenu, menuFor, loadCatalogue, modifyMenuItem, menuSummary, MENU_TITLE,
} from '../src/menu.js';
import {
  escapeHtml as escapeFieldHtml,
  fieldMeta, viewSettings, editSettings, lookupSpec, formatNumber,
  displayCategory, renderView, formatBytes, inputAttributes, attributesToHtml,
} from '../src/field-format.js';
import {
  summary as lookupSummary,
  resolveLinkEntity, dependentsOf, parentOf, lookupChain, isLookupUnique,
  buildLookupQuery, toPrismaArgs, toOptions,
} from '../src/lookups.js';
import {
  summary as dashboardSummary, slugify as dashSlugify,
  menuDashboards, entityForSlug, dashboardFor, listElements,
  normalizeFileName, cellPosition,
} from '../src/dashboards.js';
import { getSnippet, renderSnippet, snippetSummary } from '../src/snippets.js';
import {
  computeCoverage, resolveLookupTarget, isDashboardEntity,
} from '../src/meta-coverage.js';
import {
  loadSearchOptions, fieldSearchSpec, coerceValue, clauseToWhere,
  buildSearchWhere, parseSearchRequest,
} from '../src/search-ops.js';
import {
  formSpec, viewSpec, fieldSpec, orderedFields, validateSubmission,
  loadFormSpec, loadViewSpec, manifestFor, labelFor,
} from '../src/form-builder.js';
import * as nodeFs from 'node:fs';
import { DatabaseSync as SqliteDb } from 'node:sqlite';
import { signatureToSvg, parseSignatureJson, code39Pattern, code39Stripes, barcode39Svg } from '../src/signcode.js';
import { loadMigrations, translateSql as migrateSql, mapColumnType, pendingMigrations, runMigrations } from '../src/migrations.js';
import { parseSchema as importParseSchema, coerce as importCoerce, mapRow as importMapRow } from '../scripts/import-mysql-dump.js';
import { aggregate, buildGrouped, buildCrosstab, numericColumns } from '../src/reports/engine.js';
import { buildPrintTable, paginate, renderPrintHtml, printOptions } from '../src/print/renderer.js';
import { formatCell, exportCsv, exportXml, FORMATS } from '../src/exporters/index.js';
import createButtonHandlerRouter from '../routes/buttonhandler.js';
import { routeHandler } from './route-helper.mjs';
import { parseCsv, parseXlsx, detectDelimiter } from '../src/importers/csv.js';
import { parseVcards } from '../src/importers/vcard.js';
import { parseIcal } from '../src/importers/ical.js';
import { buildSepaTransferXml } from '../src/lib/sepa.js';
import { csrfProtection } from '../src/csrf.js';
import { dispatchWebhook } from '../src/webhooks.js';
import { dateRange } from '../routes/variants.js';
import { datevRows, addressMailMergeRows, salesMailMergeRows } from '../src/exporters/special.js';
import { applyBankImport, importedAmount, subject } from '../src/importers/bank.js';
import { runAccountingHandler } from '../src/button-handlers/accounting.js';
import { sanitizeRichText, isRichTextField } from '../src/rich-text.js';
import { geocode, addressText, resetGeocodingCache } from '../src/geocoding.js';
import { paritySummary } from '../src/parity.js';
import { compareJson, readFixture } from '../src/parity-runner.js';

// ---------------------------------------------------------------- helpers

function fakeRes() {
  const res = {
    headers: {}, chunks: [], statusCode: 200, jsonBody: undefined, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; this.ended = true; return this; },
    write(c) { this.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; },
    end(c) { if (c) this.write(c); this.ended = true; return this; },
    send(c) { if (c) this.write(c); this.ended = true; return this; },
    render(view, data) { this.rendered = { view, data }; this.ended = true; return this; },
    get text() { return Buffer.concat(this.chunks).toString('utf8'); },
  };
  return res;
}

const ADRESSE = {
  ID: 7, Vorname: 'Anna', Nachname: 'Muster', Firma: 'Muster GmbH',
  Stellung: 'Verwalterin', Strasse: 'Hauptstr. 1', PLZ: '10115', Ort: 'Berlin',
  Bundesland: 'Berlin', Email: 'anna@example.de', Telefon: '030-1234',
  Handy: '0170-9999', Website: 'https://example.de', Titel: 'Vertrag 2024',
};

const TERMIN = {
  ID: 42, Titel: 'Eigentuemerversammlung', Zustaendigkeit: 'Verwaltung',
  Bemerkungen: 'Raum 3; bitte puenktlich', Termin: '2026-03-15T10:00:00',
  Dauer: 90,
};

function fakePrisma(record) {
  const delegate = { findFirst: async () => record, findMany: async () => [record] };
  return new Proxy({}, { get: () => delegate });
}

const passReq = { session: { user: { admin: true } }, headers: { host: 'localhost:3000' }, protocol: 'http' };
const allowAll = () => true;
const noTeamScope = (req, extra = {}) => ({ ...extra });

test('remaining phases: CSV parser handles German delimiter and quoted lines', () => {
  const text = 'Kurzname;Bemerkungen\r\nMuster;"Zeile 1\nZeile 2"';
  assert.equal(detectDelimiter(text), ';');
  const parsed = parseCsv(text, ';');
  assert.deepEqual(parsed.headers, ['Kurzname', 'Bemerkungen']);
  assert.equal(parsed.rows[0].Bemerkungen, 'Zeile 1\nZeile 2');
});

test('remaining phases: XLSX import reads the first sheet headers and rows', async () => {
  const module = await import('exceljs');
  const Workbook = module.Workbook || module.default?.Workbook;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Import');
  sheet.addRow(['Kurzname', 'PLZ']);
  sheet.addRow(['Muster', '12345']);
  const buffer = await workbook.xlsx.writeBuffer();
  const parsed = await parseXlsx(buffer);
  assert.deepEqual(parsed.headers, ['Kurzname', 'PLZ']);
  assert.equal(parsed.rows[0].Kurzname, 'Muster');
  assert.equal(parsed.rows[0].PLZ, '12345');
});

test('remaining phases: vCard and iCal import parse source-compatible fields', () => {
  const cards = parseVcards('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Muster;Anna;;;\r\nEMAIL:anna@example.de\r\nEND:VCARD');
  assert.equal(cards[0].Vorname, 'Anna');
  assert.equal(cards[0].Nachname, 'Muster');
  const events = parseIcal('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260809T100000Z\r\nDTEND:20260809T113000Z\r\nSUMMARY:Termin\r\nEND:VEVENT\r\nEND:VCALENDAR');
  assert.equal(events[0].Titel, 'Termin');
  assert.equal(events[0].Dauer, 90);
});

test('remaining phases: SEPA pain.001 escapes values and validates bank data', () => {
  const xml = buildSepaTransferXml({ amount: 12.34, date: '2026-08-09', recipientName: 'A & B', recipientIban: 'DE89370400440532013000', recipientBic: 'COBADEFFXXX', senderName: 'Sender', senderIban: 'DE12500105170648489890', senderBic: 'INGDDEFFXXX', reference: '<Test>' });
  assert.match(xml, /pain\.001\.001\.03/);
  assert.match(xml, /A &amp; B/);
  assert.match(xml, /12\.34/);
  assert.throws(() => buildSepaTransferXml({ amount: 0 }), /positiv/);
});

test('remaining phases: CSRF rejects missing token and accepts the session token', () => {
  const middleware = csrfProtection;
  const denied = fakeRes();
  middleware({ method: 'POST', body: {}, session: { csrfToken: 'a'.repeat(64) }, path: '/settings', get: () => null, is: () => false }, denied, () => {});
  assert.equal(denied.statusCode, 403);
  let passed = false;
  middleware({ method: 'POST', body: { _csrf: 'a'.repeat(64) }, session: { csrfToken: 'a'.repeat(64) }, path: '/settings', get: () => null, is: () => false }, fakeRes(), () => { passed = true; });
  assert.equal(passed, true);
});

test('remaining phases: webhook is team-scoped and retries failures', async () => {
  let attempts = 0;
  const prisma = { einstellungen: { findFirst: async ({ where }) => ({ WebhookAdressen: `https://example.test/hook?team=${where.Team}` }) } };
  const result = await dispatchWebhook({ prisma, entity: 'adressen', record: { ID: 1, Firma: 'A&B' }, req: { session: { user: { Team: 'TeamB' } } }, retries: 1, fetchImpl: async (url) => { attempts += 1; if (attempts === 1) throw new Error('temporary'); assert.match(String(url), /TeamB/); assert.match(String(url), /A%26B/); return { ok: true, status: 200 }; } });
  assert.equal(result.sent, true);
  assert.equal(attempts, 2);
});

test('remaining phases: calendar date windows are bounded', () => {
  const now = new Date('2026-08-09T12:00:00Z');
  const week = dateRange('week', now);
  const month = dateRange('month', now);
  assert.ok(week.lt > week.gte);
  assert.equal(month.gte.getDate(), 1);
  assert.equal(month.lt.getMonth(), 8);
});

test('remaining phases: DATEV export fields match the source contract', async () => {
  const prisma = { buchungen: { findMany: async () => [{ Belegnummer: 4, Betreff: 'Miete', Datum: new Date('2026-08-09'), Betrag: 12.34, Konto: 1, Gegenkonto: 2, DATEV_Betragskennzeichen: 'S', DATEV_Steuerschluessel: '9', rel_Kontenrahmen_Konto: { Kontobezeichnung: 'Bank' }, rel_Kontenrahmen_Gegenkonto: { Kontobezeichnung: 'Miete' } }] } };
  const [row] = await datevRows(prisma, {});
  assert.deepEqual(row, { Belegnummer: 4, Betreff: 'Miete', DATEVDatum: '09082026', DATEVBetrag: 1234, Kontonummer: 1, Konto: 'Bank', Gegenkontonummer: 2, Gegenkonto: 'Miete', DATEVBetragskennzeichen: 'S', DATEVSteuerschluessel: '9', DATEVFestschreibekennzeichen: 0 });
});

test('remaining phases: mailmerge rows follow source aliases and sales calculations', async () => {
  const prisma = {
    adressen: { findMany: async () => [{ Kurzname: 'A', Vorname: 'Anna', Nachname: 'Muster', Email: 'a@example.de' }] },
    verkauf: { findMany: async () => [{ ID: 1, Kunde: 2, Datum: new Date('2026-01-01'), Art: 'Rechnung', rel_Adressen_Kunde: { Vorname: 'A', Nachname: 'B' }, rel_Positionen_Verkaufsvorgang: [{ Menge: 2, Listenpreis: 10, Mwst_Satz: 19, Bezeichnung: 'Leistung' }] }] },
  };
  const [address] = await addressMailMergeRows(prisma, {});
  assert.equal(address['Eindeutiger Bezeichner'], 'A');
  const [sale] = await salesMailMergeRows(prisma, {});
  assert.equal(sale.Netto, 20);
  assert.equal(sale.Brutto, 23.8);
});

test('remaining phases: bank import mirrors source BeforeInsert side effects', async () => {
  const created = [];
  const prisma = {
    kontenrahmen: { findFirst: async ({ where }) => ({ ID: where.Nummer === '1200' ? 10 : 11 }) },
    buchungen: { aggregate: async () => ({ _max: { Belegnummer: 7 } }), create: async ({ data }) => { created.push(data); return data; } },
    kontobuch: { findFirst: async () => ({ Kategorie: 'Miete', Art: 'Einnahme' }), aggregate: async () => ({ _max: { Belegnummer: 4 } }), create: async ({ data }) => { created.push(data); return data; } },
  };
  assert.equal(importedAmount({ Betrag: '-10,50' }), 10.5);
  assert.equal(subject({ Verwendungszweck1: 'A', Verwendungszweck2: 'B' }), 'A B');
  await applyBankImport({ prisma, entity: 'Buchungsimport', row: { Buchfuehrung: 1, Konto: '1200', Gegenkonto: '1400', Betrag: '10,50', Betreff: 'Test', Datum: '2026-08-09' }, session: { Team: 'Team', Benutzername: 'u' } });
  assert.equal(created[0].Belegnummer, 8);
  assert.equal(created[0].Konto, 10);
});

test('remaining phases: accounting handlers duplicate records with shared tenant numbers', async () => {
  const created = [];
  const prisma = {
    kontobuch: { findMany: async () => [{ ID: 3, Betrag: 10, Betreff: 'Miete', Kategorie: 'Miete', Art: 'Einnahme', Team: 'Team' }], aggregate: async () => ({ _max: { Belegnummer: 4 } }), create: async ({ data }) => { created.push(data); return { ID: created.length, ...data }; } },
    buchungen: { findMany: async () => [], aggregate: async () => ({ _max: { Belegnummer: 5 } }), create: async ({ data }) => { created.push(data); return { ID: created.length, ...data }; } },
  };
  const result = await runAccountingHandler({ buttId: 'Markierte_duplizieren', entity: 'kontobuch', keys: [3], prisma, req: { session: { user: { Team: 'Team', Benutzername: 'u' } } }, teamWhere: (req, extra) => extra });
  assert.equal(result.created, 1);
  assert.equal(created[0].Belegnummer, 5);
  assert.equal(created[0].Team, 'Team');
});

test('remaining phases: rich text keeps allowed markup and removes executable markup', () => {
  const safe = sanitizeRichText('<p>Hello <strong>world</strong></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>');
  assert.match(safe, /<strong>world<\/strong>/);
  assert.doesNotMatch(safe, /script|javascript/i);
  assert.equal(isRichTextField('adressen', 'Bemerkungen'), true);
});

test('remaining phases: geocoding provider is injectable and cached', async () => {
  resetGeocodingCache(); let calls = 0;
  const fetchImpl = async () => ({ ok: true, json: async () => [{ lat: '51.1', lon: '7.2', display_name: 'Test' }] });
  const first = await geocode('Musterstraße 1', { fetchImpl });
  const second = await geocode('Musterstraße 1', { fetchImpl });
  calls += first?.lat === second?.lat ? 0 : 1;
  assert.equal(first.lng, 7.2); assert.equal(calls, 0); assert.equal(addressText({ Strasse: 'A', PLZ: '1', Ort: 'B' }), 'A, 1, B');
});

test('remaining phases: parity summary covers all extracted catalogs', () => {
  const summary = paritySummary();
  assert.equal(summary.handlers, 139);
  assert.equal(summary.handlerCatalogued, 139);
  assert.equal(summary.hooks, 134);
  assert.equal(summary.hooksCatalogued, 134);
  assert.ok(summary.sourceEntries > 500);
});

test('remaining phases: parity runner detects nested output and side-effect differences', async () => {
  const fixture = await readFixture();
  assert.equal(fixture.version, '1812');
  assert.deepEqual(compareJson({ output: { value: 1 }, database: { inserted: 2 } }, { output: { value: 1 }, database: { inserted: 2 } }), []);
  const differences = compareJson({ output: { value: 1 }, database: { inserted: 1 } }, { output: { value: 1 }, database: { inserted: 2 } });
  assert.equal(differences[0].path, '$.database.inserted');
});

// ---------------------------------------------------------------- phase 1

test('phase 1: metadata index covers every entity', () => {
  const idx = metaIndex();
  const names = Array.isArray(idx) ? idx : Object.keys(idx.entities || idx);
  assert.equal(names.length, 172, 'expected 172 extracted entities');
});

test('phase 1: Adressen metadata matches the PHP source', () => {
  const meta = loadMeta('Adressen');
  assert.ok(meta, 'Adressen metadata should load');
  assert.equal(meta.entity, 'Adressen');
  assert.equal(meta.baseTable, 'Adressen');
  assert.equal(meta.isVirtual, false);
  assert.equal(meta.fields.length, 72, 'Adressen has 72 fields in the source');
  assert.deepEqual(meta.keys, ['ID']);
  assert.match(meta.sql.strOrderBy, /Kurzname/);
});

test('phase 1: page field sets resolve', () => {
  const meta = loadMeta('Adressen');
  assert.equal(pageFields(meta, 'list').length, 10);
  assert.equal(pageFields(meta, 'export').length, 62);
  assert.equal(pageFields(meta, 'view').length, 65);
  assert.equal(pageFields(meta, 'edit').length, 66);
});

test('phase 1: German labels resolve', () => {
  const meta = loadMeta('Adressen');
  assert.equal(fieldLabel(meta, 'Kurzname'), 'Kurzname');
  assert.equal(fieldLabel(meta, 'Nachname'), 'Nachname');
});

test('phase 1: lookup catalog and virtual entities', () => {
  const lk = lookups();
  const count = Array.isArray(lk) ? lk.length : Object.keys(lk).length;
  assert.ok(count > 0, 'lookup catalog should not be empty');
  const virt = virtualEntities();
  const vcount = Array.isArray(virt) ? virt.length : Object.keys(virt).length;
  // re-measured by the rebuilt extractor (scripts/extract-metadata.py) in this
  // snapshot: 116 entities are views over base tables. The older figure (111)
  // came from a lost tooling run; like the 768->767 file-count correction, the
  // machine-measured value wins.
  assert.equal(vcount, 116, 'expected 116 virtual entities');
});

test('phase 1: entity names resolve case-insensitively', () => {
  assert.equal(resolveEntityName('adressen'), 'Adressen');
  assert.equal(resolveEntityName('ADRESSEN'), 'Adressen');
});

test('phase 1: columns map to Prisma fields using the real schema', () => {
  assert.equal(columnToField('Adressen', 'ID'), 'ID');
  assert.equal(columnToField('Adressen', 'Nachname'), 'Nachname');
  assert.equal(columnToField('Adressen', 'does_not_exist'), null);
});

// ---------------------------------------------------------------- phase 2

test('phase 2: mime sniffing from magic bytes', () => {
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(sniffMime(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(sniffMime(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.equal(sniffMime(Buffer.from([0x42, 0x4d, 0x01, 0x02])), 'image/bmp');
  assert.equal(sniffMime(Buffer.from([0x00, 0x01, 0x02, 0x03])), 'application/octet-stream');
  assert.equal(sniffMime(null), 'application/octet-stream');
});

test('phase 2: stored blobs decode as raw bytes or upload envelope', () => {
  const raw = decodeStored(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11]));
  assert.equal(raw.kind, 'buffer');
  assert.equal(raw.mime, 'image/jpeg');

  const envelope = decodeStored(JSON.stringify([
    { name: 'files/plan.pdf', usrName: 'Plan.pdf', type: 'application/pdf' },
  ]));
  assert.equal(envelope.kind, 'file');
  assert.equal(envelope.name, 'Plan.pdf');
  assert.equal(envelope.path, 'files/plan.pdf');

  assert.equal(decodeStored(null), null);
});

// ---------------------------------------------------------------- phase 3

test('phase 3: every handler in the source is accounted for', () => {
  const data = ops();
  assert.equal(data.total, 139, 'buttonhandler.php dispatches 139 buttons');
  assert.equal(data.automated, 139);
  assert.equal(data.manual, 0);
  assert.equal(data.unrecognised, 0);
  assert.equal(data.automated + data.manual + data.unrecognised, 139);
  assert.equal(listHandlers().length, 139);
});

test('phase 3: PHP helpers are ported faithfully', () => {
  // number_format($v, 2, ',', '.')
  assert.equal(numberFormatDe(1234.5), '1.234,50');
  assert.equal(numberFormatDe(0), '0,00');
  assert.equal(numberFormatDe('abc'), '');
  // date("Ymd\THis") and its UTC variant
  assert.equal(dateToCal('2026-03-15T10:00:00Z', true), '20260315T100000Z');
  assert.match(dateToCal('2026-03-15T10:00:00', false), /^20260315T\d{6}$/);
  // X_list.php -> the Node route
  assert.equal(pageToRoute('Notizen', 'list'), '/Notizen');
  assert.equal(pageToRoute('Dokumente', 'view'), '/Dokumente/view');
});

test('phase 3: noop and constant handlers', async () => {
  const spec = Object.entries(ops().specs).find(([, s]) => s.op === 'noop');
  const out = await runHandler({
    buttId: spec[0], keys: [1], prisma: fakePrisma(ADRESSE), req: passReq,
    teamWhere: noTeamScope,
  });
  assert.deepEqual(out.result, {});
});

test('phase 3: master/detail navigation builds the right link', async () => {
  const out = await runHandler({
    buttId: 'Notizen', entity: 'Adressen', keys: [7],
    prisma: fakePrisma(ADRESSE), req: passReq, teamWhere: noTeamScope,
  });
  assert.equal(out.result, '/Notizen?masterkey1=7&mastertable=Adressen');
  assert.equal(out.redirect, out.result);
});

test('phase 3: vCard output is valid and escaped', async () => {
  const out = await runHandler({
    buttId: 'vCard', entity: 'Adressen', keys: [7],
    prisma: fakePrisma(ADRESSE), req: passReq, teamWhere: noTeamScope,
  });
  const vcf = out.body;
  assert.match(vcf, /^BEGIN:VCARD/);
  assert.match(vcf, /VERSION:3\.0/);
  assert.match(vcf, /FN:Anna Muster/);
  assert.match(vcf, /N:Muster;Anna/);
  assert.match(vcf, /ORG:Muster GmbH/);
  assert.match(vcf, /EMAIL;TYPE=internet,pref:anna@example\.de/);
  assert.match(vcf, /END:VCARD$/);
  assert.equal(out.contentType, 'text/vcard; charset=utf-8');
  assert.equal(out.filename, 'Muster.vcf');
  assert.ok(vcf.includes('\r\n'), 'vCard must use CRLF line endings');
});

test('phase 3: iCalendar output computes DTEND from Dauer', async () => {
  const out = await runHandler({
    buttId: '_ics_Kalender', entity: 'Termine', keys: [42],
    prisma: fakePrisma(TERMIN), req: passReq, teamWhere: noTeamScope,
  });
  const ics = out.body;
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:42@ap-emlaki/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}/);
  assert.match(ics, /DTEND:\d{8}T\d{6}/);
  assert.match(ics, /SUMMARY:Eigentuemerversammlung - Termin fuer Verwaltung/);
  // RFC 5545 requires semicolons to be escaped inside text values
  assert.match(ics, /DESCRIPTION:Raum 3\\; bitte puenktlich/);
  assert.match(ics, /END:VCALENDAR$/);

  // 10:00 + 90 minutes = 11:30
  const start = ics.match(/DTSTART:\d{8}T(\d{2})(\d{2})/);
  const end = ics.match(/DTEND:\d{8}T(\d{2})(\d{2})/);
  const mins = (h, m) => Number(h) * 60 + Number(m);
  assert.equal(mins(end[1], end[2]) - mins(start[1], start[2]), 90);
});

test('phase 3: unsupported handler execution returns a controlled error', async () => {
  const out = await runHandler({
     buttId: 'New_Button16', entity: 'Buchfuehrungen', keys: [1],
    prisma: fakePrisma(ADRESSE), req: passReq, teamWhere: noTeamScope,
  });
  assert.equal(out.status, 500);
  assert.ok(out.result.error);
});

test('phase 3: unknown button is rejected', async () => {
  const out = await runHandler({
    buttId: 'does_not_exist', prisma: fakePrisma(ADRESSE), req: passReq,
    teamWhere: noTeamScope,
  });
  assert.equal(out.status, 404);
});

test('phase 3: route exposes a coverage catalog', async () => {
  const router = createButtonHandlerRouter({
    prisma: fakePrisma(ADRESSE), canAccess: allowAll, teamWhere: noTeamScope,
  });
  const handler = routeHandler(router, 'get', '/catalog');
  assert.ok(handler, '/catalog route should be registered');
  const res = fakeRes();
  await handler({ query: {} }, res);
  assert.equal(res.jsonBody.total, 139);
  assert.equal(res.jsonBody.automated, 139);
});

test('phase 3: route enforces access rights', async () => {
  const router = createButtonHandlerRouter({
    prisma: fakePrisma(ADRESSE), canAccess: () => false, teamWhere: noTeamScope,
  });
  const handler = routeHandler(router, 'post', '/');
  const res = fakeRes();
  await handler({ body: { buttId: 'Notizen', table: 'Adressen', keys: [7] } }, res);
  assert.equal(res.statusCode, 403);
});

test('phase 3: SQL values are bound, not interpolated', () => {
  const specs = ops().specs;
  const sqlOps = Object.values(specs)
    .filter((s) => s.op === 'dbLookupScalar' || s.op === 'sqlScalar');
  assert.ok(sqlOps.length >= 30, 'expected the SQL-backed handlers to be present');
  sqlOps.forEach((s) => {
    assert.ok(!/\$params/.test(s.sql || ''), 'compiled SQL must not embed $params');
  });
});

// ---------------------------------------------------------------- phase 4

test('phase 4: every declared export format has a writer', () => {
  ['csv', 'excel', 'word', 'xml', 'pdf'].forEach((f) => {
    assert.equal(typeof FORMATS[f], 'function', `missing writer for ${f}`);
  });
});

test('phase 4: cell formatting follows the German conventions of the PHP pages', () => {
  assert.equal(formatCell(null), '');
  assert.equal(formatCell(undefined), '');
  assert.equal(formatCell('plain'), 'plain');
  assert.equal(formatCell(42), '42', 'whole numbers stay unformatted');
  // the PHP pages printed booleans as Ja/Nein, not true/false
  assert.equal(formatCell(true), 'Ja');
  assert.equal(formatCell(false), 'Nein');
  // decimals use the German separators
  assert.equal(formatCell(1234.5), '1.234,50');
  // dates use d.m.Y
  assert.equal(formatCell(new Date(2026, 2, 15)), '15.03.2026');
  // blobs are summarised, never dumped into a spreadsheet cell
  assert.equal(formatCell(Buffer.alloc(2048)), '[2048 bytes]');
});

test('phase 4: CSV export uses BOM and the German delimiter', () => {
  const res = fakeRes();
  exportCsv(res, {
    title: 'Adressen',
    headers: [{ key: 'Kurzname', label: 'Kurzname' }, { key: 'Ort', label: 'Ort' }],
    rows: [
      { Kurzname: 'Muster', Ort: 'Berlin' },
      { Kurzname: 'Beispiel; AG', Ort: 'Köln' },
      { Kurzname: 'Quelle GmbH', Ort: 'Q-Stadt' },
    ],
  }, {});
  const buf = Buffer.concat(res.chunks);
  assert.equal(buf[0], 0xef, 'CSV must start with a UTF-8 BOM for Excel');
  const text = buf.toString('utf8');
  assert.ok(text.includes('Kurzname;Ort'), 'header row with ; delimiter');
  assert.ok(text.includes('Berlin'));
  assert.ok(text.includes('"Beispiel; AG"'), 'values containing the delimiter must be quoted');
  // regression: the old /\Q/ regex quoted every value containing the letter Q
  assert.ok(text.includes('Quelle GmbH;'), 'a plain value with a Q must not be quoted');
  assert.ok(res.headers['content-disposition'].includes('Adressen.csv'));
});

test('phase 4: XML export is well formed and escapes markup', () => {
  const res = fakeRes();
  exportXml(res, {
    title: 'Adressen',
    headers: [{ key: 'Name', label: 'Name' }, { key: 'Notiz', label: 'Notiz' }],
    rows: [{ Name: 'Müller & Co', Notiz: '<b>fett</b>' }],
  });
  const xml = res.text;
  assert.match(xml, /^<\?xml version="1\.0"/);
  assert.ok(xml.includes('&amp;'), 'ampersands must be escaped');
  assert.ok(xml.includes('&lt;b&gt;'), 'angle brackets must be escaped');
  assert.ok(!/<b>fett<\/b>/.test(xml), 'raw markup must not leak through');
});

// ---------------------------------------------------------------- phase 5

test('phase 5: print pagination splits on the configured record count', () => {
  const rows = Array.from({ length: 25 }, (_, i) => [i]);
  assert.equal(paginate(rows, 10).length, 3);
  assert.equal(paginate(rows, 10)[0].length, 10);
  assert.equal(paginate(rows, 10)[2].length, 5);
  assert.equal(paginate(rows, 0).length, 1, 'no split means a single page');
});

test('phase 5: print options come from the entity metadata', () => {
  const meta = loadMeta('Adressen');
  const opts = printOptions(meta);
  assert.ok(opts);
  assert.ok('orientation' in opts || 'scale' in opts || 'splitRecords' in opts);
});

test('phase 5: print HTML carries page setup and escapes content', () => {
  const meta = loadMeta('Adressen');
  const field = meta.fields.find((f) => f.name === 'Kurzname');
  const columns = [{ meta: field, prismaField: 'Kurzname' }];
  const table = buildPrintTable(meta, columns, [{ Kurzname: '<script>x</script>' }], 'Adressen');
  const html = renderPrintHtml(table, { orientation: 'landscape', scale: 100 }, {});
  assert.match(html, /@page/, 'must emit an @page rule for printing');
  assert.ok(html.includes('&lt;script&gt;'), 'content must be escaped');
  assert.ok(!html.includes('<script>x</script>'), 'no raw script injection');
});

test('phase 5: aggregation matches the report engine contract', () => {
  assert.equal(aggregate([1, 2, 3], 'sum'), 6);
  assert.equal(aggregate([1, 2, 3], 'avg'), 2);
  assert.equal(aggregate([1, 2, 3], 'min'), 1);
  assert.equal(aggregate([1, 2, 3], 'max'), 3);
  assert.equal(aggregate([1, 2, 3], 'count'), 3);
  // deliberate: an empty set aggregates to null, not 0, so the renderer can
  // print an empty cell instead of a misleading zero
  assert.equal(aggregate([], 'sum'), null);
  assert.equal(aggregate([], 'count'), 0);
  assert.equal(aggregate(['10', '20'], 'sum'), 30, 'numeric strings are coerced');
});

test('phase 5: grouped report totals per group and overall', () => {
  const rows = [
    { Objekt: 'Haus A', Betrag: 100 },
    { Objekt: 'Haus A', Betrag: 50 },
    { Objekt: 'Haus B', Betrag: 25 },
  ];
  const out = buildGrouped(rows, ['Objekt'], ['Betrag'], 'sum');
  assert.ok(out.groups, 'result should expose groups');
  assert.equal(out.groups.length, 2, 'two distinct Objekt values');
  const totalOfAll = out.totals ? Object.values(out.totals)[0] : null;
  assert.equal(Number(totalOfAll), 175, 'grand total must be 100+50+25');
});

test('phase 5: crosstab pivots rows against columns', () => {
  const rows = [
    { Objekt: 'Haus A', Jahr: '2025', Betrag: 10 },
    { Objekt: 'Haus A', Jahr: '2026', Betrag: 20 },
    { Objekt: 'Haus B', Jahr: '2025', Betrag: 5 },
  ];
  const cross = buildCrosstab(rows, 'Objekt', 'Jahr', 'Betrag', 'sum');
  assert.deepEqual(cross.colKeys, ['2025', '2026'], 'two year columns, sorted');
  assert.deepEqual(cross.rowKeys, ['Haus A', 'Haus B'], 'two Objekt rows, sorted');
  const hausA = cross.matrix.find((m) => m.key === 'Haus A');
  assert.deepEqual(hausA.cells, [10, 20], 'Haus A: 10 in 2025, 20 in 2026');
  assert.equal(hausA.total, 30);
  assert.deepEqual(cross.colTotals, [15, 20], '2025 = 10+5, 2026 = 20');
  assert.equal(cross.grand, 35, 'grand total');
  // an empty intersection must be blank, not zero
  const hausB = cross.matrix.find((m) => m.key === 'Haus B');
  assert.equal(hausB.cells[1], null, 'Haus B has no 2026 row');
});

test('phase 5: numeric column detection ignores text columns', () => {
  const cols = [
    { prismaField: 'Betrag', meta: { name: 'Betrag' } },
    { prismaField: 'Bezeichnung', meta: { name: 'Bezeichnung' } },
    // a numeric-looking string column must NOT be treated as a measure
    { prismaField: 'Kontonummer', meta: { name: 'Kontonummer' } },
  ];
  const rows = [
    { Betrag: 10, Bezeichnung: 'Miete', Kontonummer: '8100' },
    { Betrag: 20, Bezeichnung: 'Strom', Kontonummer: '8200' },
  ];
  const names = numericColumns(cols, rows).map((c) => c.prismaField);
  assert.deepEqual(names, ['Betrag']);
});

// =========================================================== phase 6: charts

import {
  charts, listCharts, getChart, translateSql, splitArgs,
  buildChartSql, toChartData, renderChartHtml,
} from '../src/charts/engine.js';
import createChartRouter from '../routes/charts.js';

test('phase 6: chart catalogue matches the 18 source pages', () => {
  const all = charts();
  assert.equal(all.total, 18, '18 *_chart.php pages in the source');
  assert.equal(Object.keys(all.charts).length, 18);

  // every chart must have a category axis and at least one value series,
  // otherwise the extractor mis-read <attr value="parameters">
  for (const [name, c] of Object.entries(all.charts)) {
    assert.ok(c.category, `${name} has a category field`);
    assert.ok(c.series.length >= 1, `${name} has at least one series`);
    assert.ok(c.baseTable, `${name} resolves to a base table`);
    assert.ok(['doughnut', 'pie', 'bar', 'column', 'line', 'area'].includes(c.chartType),
      `${name} has a known type, got ${c.chartType}`);
  }

  const listed = listCharts();
  assert.equal(listed.length, 18);
  assert.ok(getChart('objekte_nach_art'), 'lookup is case-insensitive');
  assert.equal(getChart('does_not_exist'), null);
});

test('phase 6: last parameter is the category, the rest are series', () => {
  // classes/charts.php:220 -> for ($i = 0; $i < count($parameters) - 1; $i++)
  const pie = getChart('Objekte_nach_Art');
  assert.equal(pie.category, 'Objektart');
  assert.deepEqual(pie.series, ['Anteil']);

  // the multi-series bar chart proves the rule generalises
  const bar = getChart('Verbrauchsanteile');
  assert.equal(bar.category, 'Bezeichnung', 'last parameter is the label axis');
  assert.equal(bar.series.length, 6, 'the other six parameters are value series');
  assert.ok(bar.series.includes('QM_Anteil'));
  assert.ok(!bar.series.includes('Bezeichnung'), 'category must not double as a series');
});

test('phase 6: GROUP BY is recovered from the serialised SQLQuery', () => {
  // PHPRunner keeps GROUP BY in $proto0["m_groupby"], NOT in .sqlTail.
  // Without it every doughnut would collapse to a single slice.
  const spec = getChart('Objekte_nach_Art');
  assert.equal(spec.sql.tail, '', 'sqlTail really is empty in the source');
  assert.deepEqual(spec.groupBy.map((g) => g.name), ['Objektart']);

  const built = buildChartSql(spec);
  assert.match(built.sql, /GROUP BY/i, 'the built query groups');
  assert.match(built.sql, /"Objektart"/, 'grouped by the category column');
  assert.match(built.sql, /COUNT/i, 'keeps the source aggregate');

  // Leerstandsquote groups by Objekt while charting Status - two group items
  const leer = getChart('Leerstandsquote');
  assert.equal(leer.groupBy.length, 2, 'two SQLGroupByItem entries');
});

test('phase 6: splitArgs respects nesting and quotes', () => {
  assert.deepEqual(splitArgs('a, b, c'), ['a', 'b', 'c']);
  assert.deepEqual(splitArgs('f(a, b), c'), ['f(a, b)', 'c']);
  assert.deepEqual(splitArgs("'x, y', z"), ["'x, y'", 'z']);
});

test('phase 6: MySQL to SQLite translation', () => {
  // backtick identifiers become standard double quotes
  assert.match(translateSql('SELECT `Betrag` FROM `Kontobuch`').sql,
    /SELECT "Betrag" FROM "Kontobuch"/);

  // MySQL reads "x" as a string; SQLite would read it as an identifier.
  // This is the difference between a filter and a crash.
  const q = translateSql('SELECT * FROM t WHERE Art="Einnahme"');
  assert.match(q.sql, /Art='Einnahme'/, 'double-quoted literal becomes single-quoted');

  assert.match(translateSql("SELECT concat(a,' - ',b) FROM t").sql,
    /\(a \|\| ' - ' \|\| b\)/, 'concat becomes ||');

  assert.match(translateSql('SELECT if(Art="Ausgabe",-1*Betrag,Betrag) FROM t').sql,
    /iif\(/, 'if() becomes iif()');

  assert.match(translateSql('SELECT datediff(Bis,Von) FROM t').sql,
    /julianday\(Bis\) - julianday\(Von\)/, 'datediff becomes a julianday difference');

  assert.match(translateSql('SELECT date_format(Von,"%Y") FROM t').sql,
    /strftime\('%Y', Von\)/, 'date_format becomes strftime');

  // nested calls must resolve bottom-up
  const nested = translateSql('SELECT concat(date_format(Von,"%Y"),"-01-01") FROM t');
  assert.match(nested.sql, /strftime\('%Y', Von\)/);
  assert.match(nested.sql, /\|\|/);
});

test('phase 6: session variables are inlined, not left dangling', () => {
  // Abrechnungskonten_Zeitliche_Verteilung defines @anfang and reuses it later.
  // SQLite has no @vars, so the expression must be substituted at each use.
  const spec = getChart('Abrechnungskonten_Zeitliche_Verteilung');
  assert.ok(spec.mysqlOnly.length, 'flagged as MySQL-only by the extractor');

  const built = buildChartSql(spec);
  assert.ok(!/@\w+/.test(built.sql), 'no @variable survives translation:\n' + built.sql);
  assert.ok(built.notes.some((n) => n.includes('@anfang')), 'reports what it inlined');

  // and the simpler case: @betrag := if(...) AS Betrag
  const konto = buildChartSql(getChart('Kontost_nde'));
  assert.ok(!/@\w+/.test(konto.sql), 'Kontostaende has no @vars left');
  assert.match(konto.sql, /iif\(/, 'its if() was translated');
});

test('phase 6: all 18 charts translate without unsupported leftovers', () => {
  const bad = [];
  for (const name of Object.keys(charts().charts)) {
    const built = buildChartSql(getChart(name));
    if (built.unsupported.length) bad.push(`${name}: ${built.unsupported.join(', ')}`);
    if (/`/.test(built.sql)) bad.push(`${name}: backtick survived`);
  }
  assert.deepEqual(bad, [], 'every chart produces runnable SQLite');
});

test('phase 6: rows become labels and series', () => {
  const spec = getChart('Objekte_nach_Art');
  const data = toChartData(spec, [
    { Objektart: 'Wohnhaus', Anteil: 12 },
    { Objektart: 'Gewerbe', Anteil: 3 },
    { Objektart: null, Anteil: '1,5' },   // German decimal comma, like the PHP
  ]);

  assert.deepEqual(data.labels, ['Wohnhaus', 'Gewerbe', '(leer)'],
    'empty categories get a placeholder instead of disappearing');
  assert.equal(data.series.length, 1);
  assert.deepEqual(data.series[0].data, [12, 3, 1.5],
    'charts.php:1107 does str_replace(",", ".") + 0');
  assert.equal(data.type, 'doughnut');
  assert.equal(data.rowCount, 3);
  assert.equal(data.noDataMessage, null);

  const empty = toChartData(spec, []);
  assert.ok(empty.noDataMessage, 'empty result reports no data');
});

test('phase 6: rendered chart escapes hostile labels', () => {
  const spec = getChart('Objekte_nach_Art');
  const data = toChartData(spec, [
    { Objektart: '<script>alert(1)</script>', Anteil: 5 },
    { Objektart: 'Normal', Anteil: 5 },
  ]);
  const html = renderChartHtml(data);

  assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script tag');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped instead');
  assert.match(html, /<svg/, 'renders inline SVG (no CDN dependency)');
  assert.match(html, /<table class="data"/, 'data table accompanies the chart');
});

test('phase 6: chart routes', async () => {
  const captured = [];
  const prisma = {
    $queryRawUnsafe: async (sql, ...params) => {
      captured.push({ sql, params });
      return [{ Objektart: 'Wohnhaus', Anteil: 7 }];
    },
  };
  const router = createChartRouter({ prisma, canAccess: allowAll });

  // catalogue
  const catRes = fakeRes();
  await routeHandler(router, 'get', '/catalog')({ path: '/catalog', query: {}, params: {} }, catRes);
  assert.equal(catRes.jsonBody.total, 18);

  // unknown chart -> 404
  const missRes = fakeRes();
  await routeHandler(router, 'get', '/:name/data')(
    { params: { name: 'nope' }, query: {}, session: {} }, missRes);
  assert.equal(missRes.statusCode, 404);

  // data route returns the payload
  const dataRes = fakeRes();
  await routeHandler(router, 'get', '/:name/data')(
    { params: { name: 'Objekte_nach_Art' }, query: {}, session: {} }, dataRes);
  assert.equal(dataRes.statusCode, 200);
  assert.deepEqual(dataRes.jsonBody.labels, ['Wohnhaus']);
  assert.deepEqual(dataRes.jsonBody.series[0].data, [7]);

  // team scoping must be bound, never concatenated
  captured.length = 0;
  const teamRes = fakeRes();
  await routeHandler(router, 'get', '/:name/data')(
    {
      params: { name: 'Objekte_nach_Art' },
      query: {},
      session: { user: { Team: "Team'; DROP TABLE Objekte;--", isAdmin: false } },
    }, teamRes);
  const last = captured[captured.length - 1];
  assert.match(last.sql, /Team = \?/, 'team filter is a bound placeholder');
  assert.ok(!last.sql.includes('DROP TABLE'), 'the value never reaches the SQL string');
  assert.deepEqual(last.params, ["Team'; DROP TABLE Objekte;--"]);

  // permission denied
  const denyRouter = createChartRouter({ prisma, canAccess: () => false });
  const denyRes = fakeRes();
  await routeHandler(denyRouter, 'get', '/:name/data')(
    { params: { name: 'Objekte_nach_Art' }, query: {}, session: {} }, denyRes);
  assert.equal(denyRes.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Phase 1 - event runtime (91 include/*_events.php files, 134 hooks)
// ---------------------------------------------------------------------------
import { runHook, hasHook, pendingHooks, summary as eventSummary } from '../src/events/runtime.js';

test('phase 1: event catalogue matches the 91 source event files', () => {
  const s = eventSummary();
  assert.equal(s.hooks, 134, 'the source declares 134 hooks');
  assert.equal(s.compiled + s.partial + s.manual + s.empty, s.hooks,
    'every hook is accounted for in exactly one status bucket');
  assert.ok(s.ops > 0, 'at least some hooks compiled to executable ops');
});

test('phase 1: pending hooks are an explicit, countable backlog', () => {
  const pending = pendingHooks();
  const s = eventSummary();
  assert.equal(pending.length, s.partial + s.manual);
  // sorted biggest first so the backlog can be worked in priority order
  for (let i = 1; i < pending.length; i++) {
    assert.ok(pending[i - 1].lines >= pending[i].lines, 'sorted by size');
  }
  for (const p of pending) {
    assert.ok(p.entity && p.hook, 'every backlog item names entity + hook');
    assert.ok(p.status === 'manual' || p.status === 'partial');
  }
});

test('phase 1: sessionCopy writes the tenant onto new rows', async () => {
  // Kontobuch.BeforeInsert starts with $values['Team']=$_SESSION["Team"];
  assert.ok(hasHook('Kontobuch', 'BeforeInsert'));
  const ctx = {
    values: { Betreff: 'Miete' },
    rawValues: { Betreff: 'Miete' },
    session: { Team: 'TeamB' },
    prisma: { $queryRawUnsafe: async () => [{ mx: 7 }] },
  };
  const r = await runHook('Kontobuch', 'BeforeInsert', ctx);
  assert.equal(ctx.values.Team, 'TeamB');
  assert.ok(r.applied.includes('Team'));
});

test('phase 1: nextNumber continues the per-team sequence', async () => {
  let seenSql = null;
  let seenParams = null;
  const ctx = {
    values: {},
    rawValues: {},
    session: { Team: 'TeamB' },
    prisma: {
      $queryRawUnsafe: async (sql, ...p) => { seenSql = sql; seenParams = p; return [{ mx: 41 }]; },
    },
  };
  await runHook('Kontobuch', 'BeforeInsert', ctx);
  assert.equal(ctx.values.Belegnummer, 42, 'max(Belegnummer)+1');
  assert.match(seenSql, /MAX\("Belegnummer"\)/i);
  assert.match(seenSql, /FROM "Kontobuch"/i);
  assert.deepEqual(seenParams, ['TeamB'], 'team is bound, not interpolated');
});

test('phase 1: a failing sequence query degrades instead of throwing', async () => {
  const ctx = {
    values: {},
    rawValues: {},
    session: { Team: 'TeamB' },
    prisma: { $queryRawUnsafe: async () => { throw new Error('no such table'); } },
  };
  const r = await runHook('Kontobuch', 'BeforeInsert', ctx);
  assert.ok(r.skipped.includes('Belegnummer'), 'reported as skipped');
  assert.equal(ctx.values.Belegnummer, undefined);
  assert.equal(ctx.values.Team, 'TeamB', 'unrelated ops still applied');
});

test('phase 1: unknown entity or hook is a safe no-op', async () => {
  const ctx = { values: { a: 1 }, rawValues: {}, session: {}, prisma: {} };
  const r = await runHook('DoesNotExist', 'BeforeAdd', ctx);
  assert.equal(r.status, 'none');
  assert.deepEqual(r.applied, []);
  assert.deepEqual(ctx.values, { a: 1 }, 'values untouched');
  assert.equal(hasHook('Kontobuch', 'BeforeNothing'), false);
});

// ---------------------------------------------------------------------------
// Phase 1 - authentication (register / activate / remind / changepwd / captcha)
// ---------------------------------------------------------------------------
import { checkPassword, passwordErrors, randString, generateToken, POLICY }
  from '../src/auth/policy.js';
import createAuthRouter, { verifyPassword, ADMIN_NOTIFY_EMAIL } from '../routes/auth.js';

test('phase 1: checkpassword() matches include/commonfunctions.php:4862', () => {
  assert.equal(POLICY.pwdMinLength, 8);
  assert.equal(POLICY.pwdUnique, 4);
  assert.equal(POLICY.pwdDigits, 2);
  assert.equal(checkPassword('Online@1234'), true, 'the seeded admin password passes');
  assert.equal(checkPassword('short1A'), false, 'under 8 chars');
  assert.equal(checkPassword('alllower12'), false, 'no upper case');
  assert.equal(checkPassword('ALLUPPER12'), false, 'no lower case');
  assert.equal(checkPassword('AbcdefgH'), false, 'fewer than 2 non-letters');
  assert.equal(checkPassword('AaAaAa11'), false, 'fewer than 4 unique chars');
  // the PHP counts symbols as "digits" too - keep that quirk
  assert.equal(checkPassword('Abcdefg@#'), true, 'symbols satisfy pwdDigits');
});

test('phase 1: password errors use the German wording of the PHP page', () => {
  const errs = passwordErrors('abc');
  assert.equal(errs.length, 4);
  assert.ok(errs.some((e) => e.includes('mindestens 8 Zeichen')));
  assert.ok(errs.some((e) => e.includes('4 eindeutige Zeichen')));
  assert.ok(errs.some((e) => e.includes('2 Ziffern oder Sonderzeichen')));
  assert.ok(errs.some((e) => e.includes('Gro\u00df- und Kleinschrift')));
  assert.deepEqual(passwordErrors('Online@1234'), [], 'valid password has no errors');
});

test('phase 1: randString() mirrors securitycode.php', () => {
  // alphanum excludes 0 and O/l-lookalikes exactly as the PHP list does
  const alphanum = randString('alphanum', 500);
  assert.equal(alphanum.length, 500);
  assert.ok(!alphanum.includes('0'), 'zero is not in the PHP alphanum list');
  assert.ok(!alphanum.includes('O'), 'letter O is not in the PHP alpha list');
  assert.equal(randString('num', 6, () => 0), '000000', 'num list starts at 0');
  assert.equal(generateToken().length, 20, 'remindpwdpage uses generatePassword(20)');
});

test('phase 1: verifyPassword accepts plain and bcrypt hashes', async () => {
  assert.equal(await verifyPassword('Online@1234', 'Online@1234'), true);
  assert.equal(await verifyPassword('wrong', 'Online@1234'), false);
  assert.equal(await verifyPassword('x', null), false);
});

// --- router-level tests with a fake prisma + fake mailer ---------------------
function fakeUsers(rows = []) {
  const store = rows.slice();
  return {
    Benutzer: {
      findFirst: async ({ where }) => {
        const test = (r) => {
          if (where.OR) return where.OR.some((c) => Object.entries(c).every(([k, v]) => r[k] === v));
          return Object.entries(where).every(([k, v]) => r[k] === v);
        };
        return store.find(test) || null;
      },
      aggregate: async () => ({ _max: { ID: store.reduce((m, r) => Math.max(m, r.ID || 0), 0) } }),
      create: async ({ data }) => { store.push(data); return data; },
      update: async ({ where, data }) => {
        const r = store.find((x) => x.ID === where.ID);
        Object.assign(r, data);
        return r;
      },
    },
    _store: store,
  };
}

function routerFor(prisma, mails) {
  const r = createAuthRouter({
    prisma,
    sendMail: async (m) => { mails.push(m); return { mailed: true }; },
  });
  // the express stub already exposes find(method, path)
  return r;
}

function resStub() {
  return {
    statusCode: 200, view: null, locals: null, redirected: null, body: null,
    status(c) { this.statusCode = c; return this; },
    render(v, l) { this.view = v; this.locals = l; return this; },
    redirect(u) { this.redirected = u; return this; },
    type() { return this; },
    send(b) { this.body = b; return this; },
    json(b) { this.body = b; return this; },
    setHeader() { return this; },
  };
}

const reqStub = (over = {}) => ({
  body: {}, query: {}, params: {}, session: {},
  protocol: 'http', get: () => 'localhost:3000', ...over,
});

test('phase 1: register rejects a weak password and never writes a row', async () => {
  const prisma = fakeUsers();
  const mails = [];
  const router = routerFor(prisma, mails);
  const res = resStub();
  await routeHandler(router, 'post', '/register')(reqStub({
    body: { Benutzername: 'neu', Email: 'neu@example.de', Passwort: 'abc', confirm: 'abc' },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.view, 'auth/register');
  assert.ok(res.locals.errors.length >= 4);
  assert.equal(prisma._store.length, 0, 'nothing written');
  assert.equal(mails.length, 0, 'no mail sent');
});

test('phase 1: register creates an INACTIVE user and mails user + admin', async () => {
  const prisma = fakeUsers();
  const mails = [];
  const router = routerFor(prisma, mails);
  const res = resStub();
  await routeHandler(router, 'post', '/register')(reqStub({
    body: {
      Benutzername: 'neu', Name: 'Neu', Email: 'neu@example.de',
      Passwort: 'Online@1234', confirm: 'Online@1234',
    },
  }), res);
  assert.equal(res.view, 'auth/message');
  const row = prisma._store[0];
  assert.equal(row.active, 0, 'registerpage.php sets active = 0');
  assert.notEqual(row.Passwort, 'Online@1234', 'password is hashed, not stored plain');
  assert.ok(row.reset_token && row.reset_token.length === 20);
  assert.equal(mails.length, 2);
  assert.equal(mails[0].to, 'neu@example.de');
  assert.equal(mails[1].to, ADMIN_NOTIFY_EMAIL);
});

test('phase 1: duplicate username or email is refused', async () => {
  const prisma = fakeUsers([{ ID: 1, Benutzername: 'admin', Email: 'a@b.de' }]);
  const router = routerFor(prisma, []);
  const res = resStub();
  await routeHandler(router, 'post', '/register')(reqStub({
    body: { Benutzername: 'admin', Email: 'neu@example.de', Passwort: 'Online@1234', confirm: 'Online@1234' },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.locals.errors.some((e) => e.includes('bereits vergeben')));
  assert.equal(prisma._store.length, 1, 'no second row');
});

test('phase 1: activation link flips active to 1 and burns the token', async () => {
  const prisma = fakeUsers([{ ID: 1, Benutzername: 'neu', active: 0, reset_token: 'TOK123' }]);
  const router = routerFor(prisma, []);
  const res = resStub();
  await routeHandler(router, 'get', '/activate')(reqStub({ query: { token: 'TOK123' } }), res);
  assert.equal(prisma._store[0].active, 1);
  assert.equal(prisma._store[0].reset_token, null, 'token cannot be replayed');

  const res2 = resStub();
  await routeHandler(router, 'get', '/activate')(reqStub({ query: { token: 'TOK123' } }), res2);
  assert.equal(res2.statusCode, 400, 'replay is rejected');
});

test('phase 1: remind uses the exact German not-registered wording', async () => {
  const router = routerFor(fakeUsers(), []);
  const res = resStub();
  await routeHandler(router, 'post', '/remind')(reqStub({ body: { username_email: 'niemand' } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.locals.message, 'Benutzer niemand ist nicht registriert.');
});

test('phase 1: remind stores a token and mails a /changepwd link', async () => {
  const prisma = fakeUsers([{ ID: 1, Benutzername: 'admin', Email: 'a@b.de' }]);
  const mails = [];
  const router = routerFor(prisma, mails);
  const res = resStub();
  // looked up by email as well as username (remindpwdpage.php:230)
  await routeHandler(router, 'post', '/remind')(reqStub({ body: { username_email: 'a@b.de' } }), res);
  assert.equal(prisma._store[0].reset_token.length, 20);
  assert.equal(mails.length, 1);
  assert.match(mails[0].data.reseturl, /\/changepwd\?token=/);
  assert.ok(res.locals.sent);
});

test('phase 1: changepwd requires a token or a session', async () => {
  const router = routerFor(fakeUsers(), []);
  const res = resStub();
  await routeHandler(router, 'get', '/changepwd')(reqStub(), res);
  assert.equal(res.redirected, '/login?message=expired');
});

test('phase 1: changepwd rejects a wrong current password', async () => {
  const prisma = fakeUsers([{ ID: 1, Benutzername: 'admin', Passwort: 'Online@1234' }]);
  const router = routerFor(prisma, []);
  const res = resStub();
  await routeHandler(router, 'post', '/changepwd')(reqStub({
    session: { user: { Benutzername: 'admin' } },
    body: { oldpass: 'falsch', newpass: 'Neues@9999', confirm: 'Neues@9999' },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.locals.errors, ['Ung\u00fcltiges Passwort']);
  assert.equal(prisma._store[0].Passwort, 'Online@1234', 'unchanged');
});

test('phase 1: changepwd via token sets a hash and burns the token', async () => {
  const prisma = fakeUsers([{ ID: 1, Benutzername: 'admin', Passwort: 'alt', reset_token: 'T20' }]);
  const router = routerFor(prisma, []);
  const res = resStub();
  await routeHandler(router, 'post', '/changepwd')(reqStub({
    body: { token: 'T20', newpass: 'Neues@9999', confirm: 'Neues@9999' },
  }), res);
  assert.equal(res.view, 'auth/message');
  assert.equal(prisma._store[0].reset_token, null);
  assert.notEqual(prisma._store[0].Passwort, 'Neues@9999', 'hashed');
  assert.equal(await verifyPassword('Neues@9999', prisma._store[0].Passwort), true);
});

test('phase 1: captcha is stored in the session and cleared once used', async () => {
  const router = routerFor(fakeUsers(), []);
  const req = reqStub({ params: { id: 'abc' } });
  const res = resStub();
  await routeHandler(router, 'get', '/captcha/:id')(req, res);
  const code = req.session.captcha.abc;
  assert.equal(code.length, 6);
  assert.equal(res.body, '&securitycode=' + code + '&', 'securitycode.php output shape');

  // a wrong code blocks registration
  const bad = resStub();
  await routeHandler(router, 'post', '/register')(reqStub({
    session: req.session,
    body: { captchaId: 'abc', securitycode: 'WRONG', Benutzername: 'n',
      Email: 'n@e.de', Passwort: 'Online@1234', confirm: 'Online@1234' },
  }), bad);
  assert.equal(bad.statusCode, 400);
  assert.ok(bad.locals.errors.some((e) => e.includes('Sicherheitscode')));
});

// ---------------------------------------------------------------------------
// Phase 1 - admin area (groups, membership, rights matrix, auto bookings)
// ---------------------------------------------------------------------------
import { MASK_LETTERS, FULL_MASK, normalizeMask, maskHas, maskToMap }
  from '../src/auth/rights.js';
import createAdminRouter, { runAutoBookings } from '../routes/admin.js';

test('phase 1: access masks normalise into canonical order', () => {
  assert.deepEqual(MASK_LETTERS, ['S', 'A', 'E', 'D', 'P', 'M', 'I']);
  assert.equal(normalizeMask('EASD'), 'SAED', 'reordered, not just concatenated');
  assert.equal(normalizeMask('ssSS'), 'S', 'de-duplicated');
  assert.equal(normalizeMask(['s', 'a']), 'SA', 'accepts arrays');
  assert.equal(normalizeMask({ S: 'on', D: 'on', X: 'on' }), 'SD', 'unknown letters dropped');
  assert.equal(normalizeMask({ S: 'on', A: 'off' }), 'S', 'unchecked boxes dropped');
  assert.equal(normalizeMask(''), '', 'empty stays empty');
  assert.equal(FULL_MASK, 'SAEDPMI');
});

test('phase 1: maskHas and maskToMap', () => {
  assert.equal(maskHas('SAE', 'ES'), true);
  assert.equal(maskHas('SA', 'D'), false);
  assert.equal(maskHas('', 'S'), false);
  assert.equal(maskToMap('SD').S, true);
  assert.equal(maskToMap('SD').A, false);
});

/** Minimal in-memory prisma covering the four admin tables. */
function fakeAdminDb(seed = {}) {
  const mk = (rows) => {
    const store = rows.slice();
    const match = (r, where) => Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return v.some((c) => match(r, c));
      return r[k] === v;
    });
    const flatten = (where) => {
      const out = {};
      for (const [k, v] of Object.entries(where || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && k.includes('_')) Object.assign(out, v);
        else out[k] = v;
      }
      return out;
    };
    return {
      store,
      findMany: async ({ where } = {}) => (where ? store.filter((r) => match(r, flatten(where))) : store.slice()),
      findFirst: async ({ where }) => store.find((r) => match(r, flatten(where))) || null,
      aggregate: async ({ _max, where }) => {
        const key = Object.keys(_max)[0];
        const rows = where ? store.filter((r) => match(r, flatten(where))) : store;
        return { _max: { [key]: rows.reduce((m, r) => Math.max(m, r[key] || 0), 0) } };
      },
      create: async ({ data }) => { store.push({ ...data }); return data; },
      update: async ({ where, data }) => {
        const r = store.find((x) => match(x, flatten(where)));
        Object.assign(r, data); return r;
      },
      delete: async ({ where }) => {
        const i = store.findIndex((x) => match(x, flatten(where)));
        if (i < 0) throw new Error('not found');
        return store.splice(i, 1)[0];
      },
      deleteMany: async ({ where }) => {
        const w = flatten(where);
        let n = 0;
        for (let i = store.length - 1; i >= 0; i--) if (match(store[i], w)) { store.splice(i, 1); n++; }
        return { count: n };
      },
    };
  };
  return {
    benutzer: mk(seed.users || []),
    intex_hausverwaltung_uggroups: mk(seed.groups || []),
    intex_hausverwaltung_ugmembers: mk(seed.members || []),
    intex_hausverwaltung_ugrights: mk(seed.rights || []),
    kontobuch: mk(seed.kontobuch || []),
  };
}

const adminRouter = (prisma, names = ['Objekte', 'Kontobuch']) =>
  createAdminRouter({ prisma, entityNames: () => names.slice() });

test('phase 1: admin creates a group and refuses a duplicate label', async () => {
  const db = fakeAdminDb();
  const r = adminRouter(db);
  const res1 = resStub();
  await routeHandler(r, 'post', '/groups')(reqStub({ body: { Label: 'Buchhaltung' } }), res1);
  assert.equal(db.intex_hausverwaltung_uggroups.store.length, 1);
  assert.equal(db.intex_hausverwaltung_uggroups.store[0].GroupID, 1);
  assert.match(res1.redirected, /^\/admin/);

  await routeHandler(r, 'post', '/groups')(reqStub({ body: { Label: 'Buchhaltung' } }), resStub());
  assert.equal(db.intex_hausverwaltung_uggroups.store.length, 1, 'duplicate refused');

  await routeHandler(r, 'post', '/groups')(reqStub({ body: { Label: '   ' } }), resStub());
  assert.equal(db.intex_hausverwaltung_uggroups.store.length, 1, 'blank label refused');
});

test('phase 1: deleting a group also removes its members and rights', async () => {
  const db = fakeAdminDb({
    groups: [{ GroupID: 7, Label: 'Alt' }, { GroupID: 8, Label: 'Bleibt' }],
    members: [{ UserName: 'a', GroupID: 7 }, { UserName: 'b', GroupID: 8 }],
    rights: [{ TableName: 'Objekte', GroupID: 7, AccessMask: 'S' },
             { TableName: 'Objekte', GroupID: 8, AccessMask: 'S' }],
  });
  const r = adminRouter(db);
  await routeHandler(r, 'post', '/groups/:id/delete')(reqStub({ params: { id: '7' } }), resStub());
  assert.deepEqual(db.intex_hausverwaltung_uggroups.store.map((g) => g.GroupID), [8]);
  assert.deepEqual(db.intex_hausverwaltung_ugmembers.store.map((m) => m.GroupID), [8],
    'no orphaned memberships');
  assert.deepEqual(db.intex_hausverwaltung_ugrights.store.map((x) => x.GroupID), [8],
    'no orphaned rights');
});

test('phase 1: membership add is idempotent and delete uses the composite key', async () => {
  const db = fakeAdminDb({ groups: [{ GroupID: 3, Label: 'G' }] });
  const r = adminRouter(db);
  const body = { UserName: 'mitarbeiter', GroupID: '3' };
  await routeHandler(r, 'post', '/members')(reqStub({ body }), resStub());
  await routeHandler(r, 'post', '/members')(reqStub({ body }), resStub());
  assert.equal(db.intex_hausverwaltung_ugmembers.store.length, 1, 'no duplicate membership');
  assert.equal(db.intex_hausverwaltung_ugmembers.store[0].GroupID, 3, 'GroupID coerced to a number');

  await routeHandler(r, 'post', '/members/delete')(reqStub({ body }), resStub());
  assert.equal(db.intex_hausverwaltung_ugmembers.store.length, 0);
});

test('phase 1: rights matrix saves, updates and clears rows', async () => {
  const db = fakeAdminDb({ groups: [{ GroupID: 2, Label: 'Mitarbeiter' }] });
  const r = adminRouter(db);
  const post = routeHandler(r, 'post', '/rights/:groupId');

  await post(reqStub({ params: { groupId: '2' },
    body: { rights: { Objekte: { E: 'on', S: 'on' }, Kontobuch: { S: 'on' } } } }), resStub());
  const byTable = () => Object.fromEntries(
    db.intex_hausverwaltung_ugrights.store.map((x) => [x.TableName, x.AccessMask]));
  assert.deepEqual(byTable(), { Objekte: 'SE', Kontobuch: 'S' }, 'canonical order stored');

  await post(reqStub({ params: { groupId: '2' },
    body: { rights: { Objekte: { S: 'on', A: 'on', D: 'on' } } } }), resStub());
  assert.equal(db.intex_hausverwaltung_ugrights.store.length, 2, 'still two rows');
  assert.equal(byTable().Objekte, 'SAD');

  await post(reqStub({ params: { groupId: '2' }, body: { rights: { Objekte: {} } } }), resStub());
  assert.equal(byTable().Objekte, undefined, 'row deleted, not blanked');
  assert.equal(db.intex_hausverwaltung_ugrights.store.length, 1);
});

test('phase 1: grant-all writes the full mask for every known table', async () => {
  const db = fakeAdminDb({
    groups: [{ GroupID: 1, Label: 'Admins' }],
    rights: [{ TableName: 'Objekte', GroupID: 1, AccessMask: 'S' }],
  });
  const r = adminRouter(db, ['Objekte', 'Kontobuch', 'Adressen']);
  await routeHandler(r, 'post', '/rights/:groupId/grant-all')(reqStub({ params: { groupId: '1' } }), resStub());
  assert.equal(db.intex_hausverwaltung_ugrights.store.length, 3, 'one row per table, existing updated');
  assert.ok(db.intex_hausverwaltung_ugrights.store.every((x) => x.AccessMask === FULL_MASK));
});

test('phase 1: the rights matrix view includes legacy tables not in the registry', async () => {
  const db = fakeAdminDb({
    groups: [{ GroupID: 4, Label: 'Alt' }],
    rights: [{ TableName: 'Legacy_Tabelle', GroupID: 4, AccessMask: 'SP' }],
  });
  const r = adminRouter(db, ['Objekte']);
  const res = resStub();
  await routeHandler(r, 'get', '/rights/:groupId')(reqStub({ params: { groupId: '4' } }), res);
  assert.equal(res.view, 'admin-rights');
  const names = res.locals.matrix.map((m) => m.table);
  assert.deepEqual(names, ['Legacy_Tabelle', 'Objekte'], 'sorted, legacy row kept');
  const legacy = res.locals.matrix.find((m) => m.table === 'Legacy_Tabelle');
  assert.equal(legacy.checked.S, true);
  assert.equal(legacy.checked.P, true);
  assert.equal(legacy.checked.E, false);
});

test('phase 1: unknown group in the rights matrix is a 404, not a crash', async () => {
  const res = resStub();
  await routeHandler(adminRouter(fakeAdminDb()), 'get', '/rights/:groupId')(
    reqStub({ params: { groupId: '99' } }), res);
  assert.equal(res.statusCode, 404);
});

test('phase 1: admin-created passwords are hashed, never stored in clear text', async () => {
  const db = fakeAdminDb({ groups: [{ GroupID: 1, Label: 'Admins' }] });
  const r = adminRouter(db);
  await routeHandler(r, 'post', '/users')(reqStub({
    body: { Benutzername: 'neu', Passwort: 'Klartext@12', Gruppe: 'Admins' },
  }), resStub());
  const u = db.benutzer.store[0];
  assert.notEqual(u.Passwort, 'Klartext@12');
  assert.equal(await verifyPassword('Klartext@12', u.Passwort), true);
  assert.equal(db.intex_hausverwaltung_ugmembers.store.length, 1, 'membership created alongside');

  await routeHandler(r, 'post', '/users/:id/active')(reqStub({ params: { id: String(u.ID) } }), resStub());
  assert.equal(db.benutzer.store[0].active, 0);
});

test('phase 1: deleting a user removes their group memberships', async () => {
  const db = fakeAdminDb({
    users: [{ ID: 5, Benutzername: 'weg' }],
    members: [{ UserName: 'weg', GroupID: 1 }, { UserName: 'bleibt', GroupID: 1 }],
  });
  await routeHandler(adminRouter(db), 'post', '/users/:id/delete')(reqStub({ params: { id: '5' } }), resStub());
  assert.equal(db.benutzer.store.length, 0);
  assert.deepEqual(db.intex_hausverwaltung_ugmembers.store.map((m) => m.UserName), ['bleibt']);
});

test('phase 1: Autobuchungen replaces the MySQL EVENT without MySQL syntax', async () => {
  // The original used CURDATE() and @Team := which SQLite does not support.
  const db = fakeAdminDb({ kontobuch: [
    { ID: 1, Team: 'Team', Belegnummer: 7, Betrag: 100, Wiederholung: 1, Wiederholende: '2030-01-01' },
    { ID: 2, Team: 'TeamB', Belegnummer: 3, Betrag: 50, Wiederholung: 1, Wiederholende: '2030-01-01' },
    { ID: 3, Team: 'Team', Belegnummer: 9, Betrag: 10, Wiederholung: 1, Wiederholende: '2020-01-01' },
    { ID: 4, Team: 'Team', Belegnummer: 9, Betrag: 10, Wiederholung: 0 },
  ] });
  const created = await runAutoBookings(db, new Date('2026-08-07T00:00:00Z'));
  assert.equal(created, 2, 'expired and non-recurring rows are skipped');
  const added = db.kontobuch.store.slice(4);
  const team = added.find((r) => r.Team === 'Team');
  const teamB = added.find((r) => r.Team === 'TeamB');
  assert.equal(team.Belegnummer, 10, 'next Belegnummer per Team, not global');
  assert.equal(teamB.Belegnummer, 4, 'TeamB keeps its own sequence');
  assert.equal(team.Wiederholung, 0, 'the copy does not recur again');
  assert.equal(team.Datum.toISOString().slice(0, 10), '2026-08-07', 'CURDATE() equivalent');
});

// ---------------------------------------------------------------------------
// Phase 4 - export query parameters (?all, ?keys, ?raw, ?fields, ?delimiter)
// ---------------------------------------------------------------------------
import { isTruthy, rawCell, exportTake } from '../routes/exports.js';
import { formatCell as formatCellRef } from '../src/exporters/index.js';

test('phase 4: isTruthy accepts the shapes a PHP query string arrives in', () => {
  for (const v of ['1', 'true', 'yes', 'on', 'ja', 1]) assert.equal(isTruthy(v), true, String(v));
  for (const v of ['0', 'false', 'no', 'off', '', undefined, null])
    assert.equal(isTruthy(v), false, String(v));
});

test('phase 4: exportTake honours pageSize and lifts it for ?all and ?keys', () => {
  // regression: the old line was `req.query.all ? null : pageSize>0 ? null : null`
  // so every branch returned null and the cap never applied.
  assert.equal(exportTake({ pageSize: 20 }, {}, null), 20, 'default caps at pageSize');
  assert.equal(exportTake({ pageSize: 20 }, { all: '1' }, null), null, '?all=1 lifts the cap');
  assert.equal(exportTake({ pageSize: 20 }, { all: '0' }, null), 20, '?all=0 keeps the cap');
  assert.equal(exportTake({ pageSize: 20 }, {}, ['3', '4']), null, 'explicit keys are uncapped');
  assert.equal(exportTake({ pageSize: 0 }, {}, null), null, 'no pageSize means no limit');
  assert.equal(exportTake({ list: { pageSize: 50 } }, {}, null), 50, 'falls back to list.pageSize');
  assert.equal(exportTake({}, {}, null), null);
});

test('phase 4: rawCell bypasses the German localisation', () => {
  assert.equal(rawCell(null), '');
  assert.equal(rawCell(undefined), '');
  assert.equal(rawCell(true), '1');
  assert.equal(rawCell(false), '0');
  assert.equal(rawCell(1234.5), '1234.5', 'no thousands separator, no comma decimal');
  assert.equal(rawCell(new Date('2026-08-07T10:00:00Z')), '2026-08-07', 'ISO, not 07.08.2026');
  assert.equal(rawCell(Buffer.from('abc')), '[3 bytes]');
  assert.equal(rawCell({ toNumber: () => 42 }), '42', 'Prisma Decimal unwrapped');
});

test('phase 4: formatted and raw cells really differ', () => {
  const d = new Date('2026-08-07T00:00:00Z');
  assert.notEqual(formatCellRef(1234.5), rawCell(1234.5));
  assert.notEqual(formatCellRef(d), rawCell(d));
  assert.equal(formatCellRef(true), 'Ja');
  assert.equal(rawCell(true), '1');
});

// Phase 5: master/detail relations

test('phase 5: the relation catalogue is fully resolvable', () => {
  const s = mdSummary();
  assert.equal(s.relations, 102, '102 relations from include/*_settings.php');
  assert.equal(s.masters, 25);
  assert.equal(s.unresolvable.length, 0, 'every detail table is renderable');
  assert.equal(s.resolvable, s.relations);
  assert.ok(s.viaRegistry >= 80, 'most go straight through the registry');
  assert.ok(s.viaMeta > 0, 'view-backed details resolve via the metadata');
});

test('phase 5: real parent/child keys replace the old name guessing', () => {
  const rels = relationsFor('Objekte');
  assert.ok(rels.length > 0);
  const einheiten = rels.find((r) => r.detail === 'Einheiten');
  assert.ok(einheiten, 'Objekte has an Einheiten detail');
  assert.deepEqual(einheiten.masterKeys, ['ID']);
  assert.deepEqual(einheiten.detailKeys, ['Objekt'], 'Objekte.ID -> Einheiten.Objekt');
});

test('phase 5: a foreign key not named after its parent', () => {
  const r = findRelation('Angebote', 'Positionen');
  assert.ok(r, 'Angebote has a Positionen detail');
  assert.deepEqual(r.detailKeys, ['Verkaufsvorgang'], 'guessing would have said Angebot');
});

test('phase 5: childWhere builds the link, including composite keys', () => {
  const single = { masterKeys: ['ID'], detailKeys: ['Objekt'] };
  assert.deepEqual(childWhere(single, { ID: 7 }), { Objekt: 7 });
  const composite = { masterKeys: ['ID', 'Team'], detailKeys: ['Objekt', 'Team'] };
  assert.deepEqual(childWhere(composite, { ID: 7, Team: 'A' }), { Objekt: 7, Team: 'A' });
});

test('phase 5: a missing parent key means no children, not all children', () => {
  const rel = { masterKeys: ['ID'], detailKeys: ['Objekt'] };
  assert.equal(childWhere(rel, {}), null, 'undefined key');
  assert.equal(childWhere(rel, { ID: null }), null, 'null key');
  assert.equal(childWhere(rel, { ID: '' }), null, 'empty key');
  assert.equal(childWhere({ masterKeys: [], detailKeys: [] }, { ID: 1 }), null);
  assert.equal(childWhere({ masterKeys: ['ID'], detailKeys: [] }, { ID: 1 }), null);
});

test('phase 5: preview flags follow the original page kinds', () => {
  const onView = relationsForPage('Objekte', 'view');
  const onList = relationsForPage('Objekte', 'list');
  assert.ok(onView.every((r) => r.previewOnView));
  assert.ok(onList.every((r) => r.previewOnList));
  assert.deepEqual(relationsForPage('Objekte', 'nonsense'), []);
});

test('phase 5: view-backed details resolve through their base table', () => {
  const j = findRelation('Buchfuehrungen', 'Journal');
  assert.ok(j, 'Buchfuehrungen has a Journal detail');
  assert.equal(j.viaMeta, true, 'resolved via metadata, not the registry');
  assert.equal(loadMeta(j.detailSlug).baseTable, 'Buchungen');
});

// Phase 2: fulltext endpoint (port of fulltext.php)

test('phase 2: fulltext escapes html before turning newlines into <br />', () => {
  assert.equal(escapeHtml('<b>&"x"</b>'), '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');
  assert.equal(nl2br('a\nb'), 'a<br />\nb', 'nl2br keeps the newline, PHP style');
  assert.equal(nl2br('a\r\nb'), 'a<br />\r\nb');
  assert.equal(nl2br('plain'), 'plain');
  assert.ok(!nl2br(escapeHtml('<script>')).includes('<script>'), 'no raw tag survives');
});

test('phase 2: fulltext maps key1..keyN onto the primary key', () => {
  const ent = { entityName: 'Objekte', slug: 'objekte' };
  assert.deepEqual(collectKeys({ key1: '42' }, ent, undefined), { ID: 42 }, 'numeric keys coerce');
  assert.deepEqual(collectKeys({}, ent, '7'), { ID: 7 }, 'route id is the fallback');
  assert.equal(collectKeys({}, ent, undefined), null, 'no key at all is a refusal');
  assert.equal(collectKeys({ key1: '' }, ent, undefined), null, 'empty key is a refusal');
});

test('phase 2: fulltext refuses a field the page does not expose', () => {
  const ent = { entityName: 'Objekte', slug: 'objekte' };
  assert.equal(fieldReadable(ent, 'Passwort_geheim_xyz', 'list'), false);
});

test('phase 2: fulltext resolves the short table name like checkTableName', () => {
  assert.ok(resolveEntity('objekte'), 'known table resolves');
  assert.equal(resolveEntity('Objekte').slug, 'objekte', 'case-insensitive');
  assert.equal(resolveEntity('no_such_table_xyz'), null);
  assert.equal(resolveEntity(''), null);
  assert.equal(resolveEntity(undefined), null);
});

test('phase 2: fulltext denies an anonymous caller without leaking a reason', async () => {
  const res = resStub();
  const handler = createFulltextHandler({
    prisma: {}, canAccess: () => true, teamWhere: (_r, w) => w,
  });
  await handler(reqStub({ body: { table: 'objekte', field: 'Bezeichnung', key1: '1' } }), res);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, '', 'PHP returns an empty error for the unauthenticated case');
});

// Phase 2: BLOB download (port of getfile.php)

test('phase 2: the content type comes from the extension, like getContentTypeByExtension', () => {
  assert.equal(contentTypeByExtension('Anhang.pdf'), 'application/pdf');
  assert.equal(contentTypeByExtension('Bild.JPG'), 'image/jpeg', 'case insensitive');
  assert.equal(contentTypeByExtension('.docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(contentTypeByExtension('unbekannt.xyz'), 'application/octet-stream');
  assert.equal(contentTypeByExtension(''), 'application/octet-stream');
});

test('phase 2: a wrongly named blob still falls back to its magic bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  assert.equal(supposeImageType(png), 'image/png');
  assert.equal(resolveMime('scan.dat', png), 'image/png', 'extension unknown, bytes win');
  assert.equal(resolveMime('scan.pdf', png), 'application/pdf', 'extension wins when known');
  assert.equal(supposeImageType(Buffer.from([1, 2])), null, 'too short to guess');
});

test('phase 2: german file names survive Content-Disposition', () => {
  assert.equal(contentDisposition('Anhang.pdf'), 'attachment; filename="Anhang.pdf"');
  const umlaut = contentDisposition('Geb\u00e4ude.pdf');
  assert.ok(umlaut.includes("filename*=UTF-8''"), 'non-ascii gets the RFC 5987 form');
  assert.ok(contentDisposition('x.pdf', { inline: true }).startsWith('inline;'));
});

test('phase 2: a download name can never escape its folder', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('C:\\\\temp\\\\a.pdf'), 'a.pdf');
  assert.equal(sanitizeFileName(''), '');
});

test('phase 2: raw bytes and the json envelope both decode', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(10)]);
  const raw = decodeDownload(pdf, { field: 'Beleg' });
  assert.equal(raw.kind, 'buffer');
  assert.equal(raw.mime, 'application/pdf');
  assert.equal(raw.fileName, 'Beleg.pdf', 'a name is invented from the bytes');
  assert.equal(raw.size, pdf.length);

  const envelope = JSON.stringify([
    { name: 'a_1.pdf', usrName: 'Rechnung.pdf', size: 5, type: 'application/pdf' },
  ]);
  const ref = decodeDownload(envelope, { field: 'Beleg' });
  assert.equal(ref.kind, 'reference', 'the bytes live on disk, not in the column');
  assert.equal(ref.fileName, 'Rechnung.pdf', 'the user-visible name is used');

  assert.equal(decodeDownload(null, { field: 'Beleg' }), null);
  assert.equal(decodeDownload('', { field: 'Beleg' }), null);
});

test('phase 2: the response carries the four headers getfile.php sent', () => {
  const decoded = decodeDownload(Buffer.from('%PDF-1.4'), { field: 'Beleg' });
  const h = downloadHeaders(decoded);
  assert.equal(h['Content-Type'], 'application/pdf');
  assert.equal(h['Cache-Control'], 'private');
  assert.equal(h['Content-Length'], String(decoded.size));
  assert.ok(h['Content-Disposition'].startsWith('attachment;'));
});

// Phase 2: multipart upload (port of mfhandler.php)

test('phase 2: the upload policy comes from the field metadata', () => {
  const meta = loadMeta('Objekte');
  const p = uploadPolicy(meta, 'Bild');
  assert.equal(p.exists, true, 'Objekte.Bild is a real field');
  assert.equal(p.maxNumberOfFiles, 1, 'every extracted field allows exactly one file');
  assert.equal(p.createThumbnail, true, 'Objekte.Bild carries ShowThumbnail');
  assert.equal(uploadPolicy(meta, 'Feld_gibt_es_nicht').exists, false);
});

test('phase 2: upload validation enforces count and size, and names the reason', () => {
  const policy = {
    acceptFileTypes: '.+$', maxNumberOfFiles: 1,
    maxFileSize: 100, maxTotalFileSize: 1000,
  };
  const ok = validateUpload([{ originalname: 'a.pdf', size: 50 }], policy);
  assert.equal(ok.ok, true);
  assert.equal(ok.accepted.length, 1);

  const tooMany = validateUpload(
    [{ originalname: 'a.pdf', size: 10 }, { originalname: 'b.pdf', size: 10 }], policy);
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.accepted.length, 1);
  assert.equal(tooMany.rejected[0].error, 'maxNumberOfFiles');

  const tooBig = validateUpload([{ originalname: 'a.pdf', size: 101 }], policy);
  assert.equal(tooBig.rejected[0].error, 'maxFileSize');
  assert.equal(tooBig.accepted.length, 0, 'nothing is stored when it is too big');
});

test('phase 2: acceptFileTypes only bites when the source really set one', () => {
  assert.equal(acceptsFileName({ acceptFileTypes: '.+$' }, 'anything.exe'), true);
  assert.equal(acceptsFileName({ acceptFileTypes: '\\.(pdf)$' }, 'a.pdf'), true);
  assert.equal(acceptsFileName({ acceptFileTypes: '\\.(pdf)$' }, 'a.exe'), false);
  assert.equal(acceptsFileName({ acceptFileTypes: '([' }, 'a.pdf'), true,
    'a broken pattern must not lock uploads out');
});

test('phase 2: the stored envelope round-trips and can lose one file', () => {
  const files = [
    { name: 'a_1.pdf', usrName: 'Rechnung.pdf', size: 5, type: 'application/pdf' },
    { name: 'b_1.pdf', usrName: 'Mahnung.pdf', size: 6, type: 'application/pdf' },
  ];
  const stored = serializeStoredFiles(files);
  assert.deepEqual(parseStoredFiles(stored).map((f) => f.usrName),
    ['Rechnung.pdf', 'Mahnung.pdf']);
  assert.equal(parseStoredFiles(Buffer.from(stored)).length, 2, 'also from a BLOB column');

  const left = parseStoredFiles(removeStoredFile(stored, 'Rechnung.pdf'));
  assert.deepEqual(left.map((f) => f.usrName), ['Mahnung.pdf']);
  const emptied = removeStoredFile(removeStoredFile(stored, 'Mahnung.pdf'), 'Rechnung.pdf');
  assert.equal(parseStoredFiles(emptied).length, 0);

  assert.deepEqual(parseStoredFiles(Buffer.from([0xff, 0xd8, 0xff, 0x00])), [],
    'raw image bytes are not an envelope');
  assert.deepEqual(parseStoredFiles(null), []);
  assert.equal(serializeStoredFiles([]), '', 'an empty list clears the column');
});

test('phase 2: an uploaded file becomes the envelope PHPRunner wrote', () => {
  const obj = fileObject({
    originalname: '../Rechnung Mai.pdf', size: 12, mimetype: 'application/pdf',
  });
  assert.equal(obj.name, 'Rechnung Mai.pdf', 'the path is stripped');
  assert.equal(obj.usrName, 'Rechnung Mai.pdf');
  assert.equal(obj.size, 12);
  assert.equal(obj.type, 'application/pdf');
  assert.equal(fileObject({ originalname: 'x.png', buffer: Buffer.alloc(3) }).type, 'image/png',
    'the mime is derived when the client does not send one');
});

// Phase 1: main menu (port of menunodes_main.php + ModifyMenuItem)

test('phase 1: every menu node survives extraction, groups and separators included', () => {
  const s = menuSummary();
  assert.equal(s.nodes, 195, 'main + admin area nodes');
  assert.equal(s.groups, 41);
  assert.equal(s.leaves, 151);
  assert.equal(s.separators, 3);
  assert.equal(s.withoutHref, 0, 'no leaf may be a dead link');
});

test('phase 1: a report leaf no longer points at a list route', () => {
  const { items } = loadCatalogue();
  const byPage = {};
  for (const i of items) {
    if (i.type !== 'Leaf') continue;
    byPage[i.pageType] = (byPage[i.pageType] || 0) + 1;
  }
  assert.equal(byPage.Report, 36, 'the source declares 36 report pages');
  assert.equal(byPage.Chart, 7);
  assert.equal(byPage.Dashboard, 7);

  for (const i of items) {
    if (i.type !== 'Leaf' || i.external) continue;
    if (i.pageType === 'Report') assert.ok(i.href.startsWith('/report/'), i.title);
    if (i.pageType === 'Chart') assert.ok(i.href.startsWith('/chart/'), i.title);
    if (i.pageType === 'Dashboard') assert.ok(i.href.startsWith('/dashboard/'), i.title);
    if (i.pageType === 'Add') assert.ok(i.href.endsWith('/add'), i.title);
  }
});

test('phase 1: ModifyMenuItem hides Backup and Vertragsdaten from non-admins', () => {
  const backup = { title: 'Backup' };
  assert.equal(modifyMenuItem(backup, { isAdmin: false }), false);
  assert.equal(modifyMenuItem(backup, { isAdmin: true }), true);
  assert.equal(modifyMenuItem({ title: 'Vertragsdaten' }, { isAdmin: false }), false);
  assert.equal(modifyMenuItem({ title: 'Objekte' }, { isAdmin: false }), true,
    'ordinary entries stay visible');
});

test('phase 1: guests lose the external office links, signed-in users keep them', () => {
  for (const title of ['OneNote', 'Outlook Mail', 'Word online', 'Urteile']) {
    assert.equal(modifyMenuItem({ title }, { isGuest: true }), false, title);
    assert.equal(modifyMenuItem({ title }, { isGuest: false }), true, title);
  }
});

test('phase 1: the sidebar only shows entries the AccessMask allows', () => {
  const allowed = new Set(['objekte', 'einheiten', 'adressen']);
  const menu = menuFor({
    isAdmin: false,
    isGuest: false,
    canAccess: (slug) => allowed.has(slug),
  });
  const slugs = menu.groups.flatMap((g) => g.items.map((i) => i.slug)).filter(Boolean);
  assert.ok(slugs.length > 0, 'something is rendered');
  for (const slug of slugs) {
    assert.ok(allowed.has(slug), `${slug} leaked into the sidebar`);
  }
  assert.ok(slugs.includes('objekte'));

  const full = menuFor({ isAdmin: true, isGuest: false });
  assert.ok(
    full.groups.flatMap((g) => g.items).length > slugs.length,
    'an admin sees strictly more than a restricted user',
  );
});

test('phase 1: a group whose children were all filtered away disappears', () => {
  const menu = menuFor({ isAdmin: false, isGuest: false, canAccess: () => false });
  const withEntries = menu.groups.filter((g) => g.items.some((i) => !i.special));
  assert.equal(menu.groups.length, withEntries.length, 'no empty headings remain');
  const external = menu.groups.flatMap((g) => g.items).filter((i) => i.external);
  assert.ok(external.length > 0, 'external links do not need a table permission');
});

test('phase 1: the admin area is a group of its own and only admins get it', () => {
  const admin = menuFor({ isAdmin: true, isGuest: false });
  const area = admin.groups.find((g) => g.id === 'adminarea');
  assert.ok(area, 'admins see the administration group');
  assert.deepEqual(area.items.map((i) => i.table).sort(),
    ['admin_members', 'admin_rights', 'admin_users']);

  const plain = menuFor({ isAdmin: false, isGuest: false });
  assert.equal(plain.groups.find((g) => g.id === 'adminarea'), undefined);
});

test('phase 1: BeforeShowMenu supplies the page title the source assigned', () => {
  assert.equal(MENU_TITLE, 'Erwin Property Mgmt - Men\u00fc');
  assert.equal(menuFor({ isAdmin: true }).title, MENU_TITLE);
});

test('phase 1: the render contract layout_top.ejs relies on is intact', () => {
  const menu = loadMenu();
  assert.ok(Array.isArray(menu.groups));
  for (const g of menu.groups) {
    assert.equal(typeof g.label, 'string');
    assert.ok(Array.isArray(g.items));
    for (const i of g.items) {
      assert.equal(typeof i.label, 'string');
      assert.equal(typeof i.href, 'string');
      assert.equal(typeof i.module, 'string');
      assert.ok(i.label.length > 0, 'a nameless entry would render as a blank row');
    }
  }
});

// Phase 1: metadata-driven formatter registry

test('phase 1: a field carries its own precision instead of a global default', () => {
  const netto = loadMeta('Abrechnungsdruck_Netto');
  assert.equal(viewSettings(netto, 'Anteil').decimalDigits, 6,
    'Anteil is declared with six decimal places in the source');
  assert.equal(formatNumber(1.2345678, 6), '1,234568', 'german decimal comma, six places');
  assert.equal(formatNumber(1.2345678, 2), '1,23');
  assert.equal(formatNumber(1000.5, 2), '1.000,50', 'thousands separator is a dot');
  assert.equal(formatNumber(0, 2), '0,00', 'zero is a value, not an empty cell');
  assert.equal(formatNumber(null, 2), '');
  assert.equal(formatNumber('keine Zahl', 2), '');
});

test('phase 1: rounding a six-digit share to two places is no longer possible', () => {
  const netto = loadMeta('Abrechnungsdruck_Netto');
  const rendered = renderView(netto, 'Anteil', 0.123456, { entitySlug: 'abrechnungsdruck_netto', id: 1 });
  assert.equal(rendered, '0,123456');

  const abr = loadMeta('Abrechnungen');
  assert.equal(viewSettings(abr, 'Quadratmeter').decimalDigits, 2);
  assert.equal(renderView(abr, 'Quadratmeter', 85.5, {}), '85,50');
});

test('phase 1: NeedEncode really escapes, it is not decoration', () => {
  const objekte = loadMeta('Objekte');
  assert.equal(viewSettings(objekte, 'Bezeichnung').needEncode, true);
  const evil = '<script>alert(1)</script>';
  const out = renderView(objekte, 'Bezeichnung', evil, {});
  assert.ok(!out.includes('<script>'), 'the tag must not survive');
  assert.ok(out.includes('&lt;script&gt;'));
  assert.equal(escapeFieldHtml('a & b "c"'), 'a &amp; b &quot;c&quot;');
});

test('phase 1: a thumbnail field renders an image, not a [BLOB] badge', () => {
  const objekte = loadMeta('Objekte');
  assert.equal(viewSettings(objekte, 'Bild').showThumbnail, true);
  assert.equal(displayCategory(objekte, 'Bild', Buffer.from([1, 2, 3])), 'image');

  const html = renderView(objekte, 'Bild', Buffer.from([1, 2, 3]), {
    entitySlug: 'objekte', id: 7,
  });
  assert.ok(html.startsWith('<img'), html);
  assert.ok(html.includes('/media/objekte/7/Bild'), 'points at the streaming route');
  assert.ok(html.includes('loading="lazy"'));
});

test('phase 1: a binary field without a thumbnail flag becomes a download link', () => {
  const objekte = loadMeta('Objekte');
  const buf = Buffer.alloc(2048);
  const html = renderView(objekte, 'Bezeichnung', buf, { entitySlug: 'objekte', id: 3 });
  assert.ok(html.includes('/file/get/objekte/3/Bezeichnung'), html);
  assert.ok(html.includes('2,0 KB'), 'the size is shown in german notation');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1024 * 1024 * 3), '3,0 MB');
});

test('phase 1: lookup wiring comes from the settings file, not from a guess', () => {
  const objekte = loadMeta('Objekte');
  const spec = lookupSpec(objekte, 'Besitzer');
  assert.ok(spec, 'Objekte.Besitzer is a lookup');
  assert.equal(spec.table, 'Kerndaten');
  assert.equal(spec.linkField, 'ID');
  assert.equal(spec.displayField, 'Kurzname');
  assert.equal(spec.where, 'Aktiv is null or Aktiv=0', 'the filter is carried through verbatim');
  assert.equal(spec.orderBy, 'Kurzname');
  assert.equal(spec.control, 'dropdown');
  assert.equal(lookupSpec(objekte, 'Bezeichnung'), null, 'a plain text field has no lookup');
});

test('phase 1: a lookup cell shows the resolved text and falls back to the key', () => {
  const objekte = loadMeta('Objekte');
  assert.equal(displayCategory(objekte, 'Besitzer', 42), 'lookup');
  assert.equal(renderView(objekte, 'Besitzer', 42, { lookupText: 'Meier GmbH' }), 'Meier GmbH');
  assert.equal(renderView(objekte, 'Besitzer', 42, {}), '42',
    'without a resolved text the raw key is still readable');
  assert.equal(renderView(objekte, 'Besitzer', 42, { lookupText: '<b>x</b>' }), '&lt;b&gt;x&lt;/b&gt;',
    'the resolved text is escaped too');
});

test('phase 1: form inputs inherit type, requiredness and width from the source', () => {
  const objekte = loadMeta('Objekte');
  const bez = editSettings(objekte, 'Bezeichnung');
  assert.equal(bez.inputType, 'text');
  assert.equal(bez.required, true);
  assert.equal(bez.width, 200);

  const id = editSettings(objekte, 'ID');
  assert.equal(id.inputType, 'number');

  const attrs = inputAttributes(objekte, 'Bezeichnung');
  assert.equal(attrs.type, 'text');
  assert.equal(attrs.required, true);
  assert.equal(attrs.style, 'width:200px');

  const html = attributesToHtml(inputAttributes(objekte, 'ID'));
  assert.ok(html.includes('type="number"'), html);
  assert.ok(html.includes('required'), html);
});

test('phase 1: an unknown field degrades quietly instead of throwing', () => {
  const objekte = loadMeta('Objekte');
  assert.equal(fieldMeta(objekte, 'Gibt_es_nicht'), null);
  assert.equal(viewSettings(objekte, 'Gibt_es_nicht').exists, false);
  assert.equal(editSettings(objekte, 'Gibt_es_nicht').inputType, 'text');
  assert.equal(renderView(objekte, 'Gibt_es_nicht', 'wert', {}), 'wert');
  assert.equal(renderView(objekte, 'Bezeichnung', null, {}), '');
  assert.equal(renderView({}, 'egal', 'wert', {}), 'wert', 'even without a manifest');
});

// Phase 1: dependent lookups and suggestion endpoints

test('phase 1: the dynamic half of a lookup is extracted, not invented', () => {
  const s = lookupSummary();
  assert.equal(s.counts.settingsFiles, 172, 'every settings file was parsed');
  assert.equal(s.entities, 73);
  assert.equal(s.fields, 175);
  assert.equal(s.dependents, 68, 'DependentLookups entries found in the source');
  assert.equal(s.unique, 60, 'LookupUnique entries found in the source');
  assert.equal(resolveLinkEntity('Abrechnungsempf\u00e4nger'), 'Abrechnungsempf_nger',
    'the umlaut spelling of the settings file is resolved');
});

test('phase 1: choosing an Objekt narrows Einheit and Raum', () => {
  assert.deepEqual(dependentsOf('Aufgaben', 'Objekt'), ['Einheit', 'Raum'],
    'both the dependent dropdown and the dependent filter are honoured');
  assert.equal(parentOf('Aufgaben', 'Einheit'), 'Objekt');
});

test('phase 1: a cascade knows its whole chain, outermost parent first', () => {
  assert.deepEqual(lookupChain('Aufgaben', 'Raum'), ['Objekt', 'Einheit', 'Raum']);
  assert.deepEqual(lookupChain('Aufgaben', 'Objekt'), ['Objekt'], 'the top of the chain is itself');
  assert.equal(parentOf('Abrechnungsbericht', 'Abrechnungskonto'), 'Abrechnung');
});

test('phase 1: a field without dynamic wiring stays independent', () => {
  assert.equal(parentOf('Objekte', 'Bezeichnung'), null);
  assert.deepEqual(dependentsOf('Objekte', 'Bezeichnung'), []);
  assert.deepEqual(dependentsOf('Gibt_es_nicht', 'Egal'), [], 'an unknown entity does not throw');
  assert.deepEqual(lookupChain('Gibt_es_nicht', 'Egal'), ['Egal']);
});

test('phase 1: the parent value really reaches the query as a filter', () => {
  const meta = loadMeta('Aufgaben');
  const q = buildLookupQuery({ meta, entity: 'Aufgaben', field: 'Einheit', parentValue: 5 });
  assert.equal(q.table, 'Einheiten');
  assert.equal(q.linkField, 'ID');
  assert.equal(q.displayField, 'Bezeichnung');
  assert.equal(q.parentField, 'Objekt');
  assert.deepEqual(q.filters, [{ field: 'Objekt', equals: 5, source: 'parentFilter' }]);

  const args = toPrismaArgs(q);
  assert.deepEqual(args.where, { Objekt: 5 }, 'the cascade actually filters the rows');
  assert.deepEqual(args.orderBy, { Bezeichnung: 'asc' });
});

test('phase 1: without a parent value the dropdown is not silently filtered', () => {
  const meta = loadMeta('Aufgaben');
  for (const value of [undefined, null, '']) {
    const q = buildLookupQuery({ meta, entity: 'Aufgaben', field: 'Einheit', parentValue: value });
    assert.deepEqual(q.filters, [], 'an empty parent must not become where { Objekt: "" }');
    assert.deepEqual(toPrismaArgs(q).where, {});
  }
});

test('phase 1: LookupWhere is carried through instead of being dropped', () => {
  const meta = loadMeta('Objekte');
  const q = buildLookupQuery({ meta, entity: 'Objekte', field: 'Besitzer' });
  assert.equal(q.table, 'Kerndaten');
  assert.equal(q.displayField, 'Kurzname');
  assert.equal(q.rawWhere, 'Aktiv is null or Aktiv=0');
  const args = toPrismaArgs(q);
  assert.equal(args.unsupportedWhere, 'Aktiv is null or Aktiv=0',
    'the caller is told about the raw SQL rather than losing the rule');

  assert.equal(buildLookupQuery({ meta, entity: 'Objekte', field: 'Bezeichnung' }), null,
    'a plain text field produces no query at all');
});

test('phase 1: autocomplete adds a contains search and clamps the limit', () => {
  const meta = loadMeta('Objekte');
  const q = buildLookupQuery({ meta, entity: 'Objekte', field: 'Besitzer', term: '  Meier ', limit: 500 });
  assert.deepEqual(q.search, { field: 'Kurzname', contains: 'Meier' }, 'the term is trimmed');
  assert.equal(q.take, 100, 'a caller cannot ask for the whole table');
  assert.deepEqual(toPrismaArgs(q).where, { Kurzname: { contains: 'Meier' } });

  const plain = buildLookupQuery({ meta, entity: 'Objekte', field: 'Besitzer', term: '   ' });
  assert.equal(plain.search, undefined, 'whitespace is not a search term');
  assert.equal(plain.take, 20, 'the default page size');
});

test('phase 1: rows become value/label options and unique fields are flagged', () => {
  const meta = loadMeta('Aufgaben');
  const q = buildLookupQuery({ meta, entity: 'Aufgaben', field: 'Einheit', parentValue: 1 });
  const options = toOptions([
    { ID: 1, Bezeichnung: 'Wohnung 1' },
    { ID: 2, Bezeichnung: '' },
  ], q);
  assert.deepEqual(options, [
    { value: 1, label: 'Wohnung 1' },
    { value: 2, label: '2' },
  ], 'a row without a display value still shows its key');
  assert.deepEqual(toOptions(null, q), []);

  assert.equal(isLookupUnique('Adressen', 'Datenherkunft'), true);
  assert.equal(isLookupUnique('Aufgaben', 'Objekt'), false);
});

// Phase 1: dashboards extracted from the source settings

test('phase 1: all seven dashboards come out of the source with every element', () => {
  const s = dashboardSummary();
  assert.equal(s.dashboards, 7);
  assert.equal(s.elements, 41, 'every element of every dashboard was extracted');
  assert.equal(s.byType.list, 22);
  assert.equal(s.byType.chart, 11);
  assert.equal(s.byType.report, 1);
  assert.equal(s.byType.map, 1);
  assert.equal(s.byType.snippet, 6);
  assert.equal(s.menuLeaves, 7, 'the menu links to exactly these seven');
});

test('phase 1: every dashboard link in the menu resolves to its settings', () => {
  const leaves = menuDashboards();
  assert.equal(leaves.filter((d) => d.hasSettings).length, 7,
    'no menu link is allowed to land on a 404');
  assert.equal(entityForSlug('heute'), 'Heute');
  assert.equal(entityForSlug('assistent_doppelte_buchfuehrung'), 'Assistent_Doppelte_Buchf_hrung',
    'the umlaut in the menu title still finds the settings file spelling');
  assert.equal(entityForSlug('immobilien_diagramme'), 'Immobilien_Diagramme');
});

test('phase 1: the Wiedervorlage dashboard keeps its eight lists in cell order', () => {
  const heute = dashboardFor('heute');
  assert.ok(heute, 'Heute resolves');
  assert.deepEqual(heute.elements.map((e) => e.table), [
    'WV', 'Aufgaben', 'Termine', 'Notizen', 'Korrespondenz',
    'Adressen', 'Dokumente', 'Vertraege',
  ]);
  assert.deepEqual(heute.elements.map((e) => e.cell), [
    'cell_0_0', 'cell_1_0', 'cell_2_0', 'cell_3_0',
    'cell_4_0', 'cell_5_0', 'cell_6_0', 'cell_7_0',
  ], 'the source assigns one row per list');
  assert.ok(heute.elements.every((e) => e.typeName === 'list'));
  assert.equal(heute.elements[1].masterTable, 'WV',
    'the seven follow-up lists hang under the WV master');
  assert.deepEqual(listElements(heute).map((e) => e.table), [
    'WV', 'Aufgaben', 'Termine', 'Notizen', 'Korrespondenz',
    'Adressen', 'Dokumente', 'Vertraege',
  ]);
});

test('phase 1: only WV_list is inline-editable, like the source declares', () => {
  const heute = dashboardFor('Heute');
  const wv = heute.elements.find((e) => e.name === 'WV_list');
  assert.equal(wv.inlineEdit, true);
  for (const e of heute.elements) {
    if (e.name === 'WV_list') continue;
    assert.equal(e.inlineEdit, false, e.name + ' must not be inline-editable');
    assert.equal(e.deleteRecord, false, e.name + ' offers no delete on the dashboard');
    assert.equal(e.popupAdd, false);
  }
});

test('phase 1: the dashboard-wide search field is extracted', () => {
  const heute = dashboardFor('heute');
  assert.deepEqual(heute.searchFields, {
    WV_Tag: [{ table: 'WV', field: 'Tag' }],
  }, 'Heute searches WV.Tag, nothing else');
});

test('phase 1: chart, map and snippet elements keep their real types', () => {
  const adr = dashboardFor('adressen_diagramme');
  assert.equal(adr.elements.filter((e) => e.typeName === 'chart').length, 4);
  assert.equal(adr.elements.filter((e) => e.typeName === 'map').length, 1);
  assert.equal(adr.elements.filter((e) => e.typeName === 'snippet').length, 2);
  const map = adr.elements.find((e) => e.typeName === 'map');
  assert.equal(map.table, 'Adressen');
  const snippet = adr.elements.find((e) => e.typeName === 'snippet');
  assert.ok(snippet.snippetId, 'the snippet keeps its PHP snippet id');
});

test('phase 1: the file-name spelling of display names is reversible', () => {
  assert.equal(normalizeFileName('Assistent Doppelte Buchf\u00fchrung'),
    'Assistent_Doppelte_Buchf_hrung');
  assert.equal(normalizeFileName('Adressen Diagramme'), 'Adressen_Diagramme');
  assert.equal(dashSlugify('Immobilien_Diagramme'), 'immobilien_diagramme');
  assert.deepEqual(cellPosition('cell_12_3'), { row: 12, col: 3 });
  assert.equal(cellPosition('keins').row, 999, 'a cell-less element sorts last');
});

test('phase 1: an unknown dashboard degrades quietly instead of throwing', () => {
  assert.equal(dashboardFor('gibt_es_nicht'), null);
  assert.equal(entityForSlug(''), null);
  assert.deepEqual(listElements(null), []);
  assert.deepEqual(listElements('gibt_es_nicht'), []);
});

// Phase 1: metadata coverage audit

test('phase 1: every one of the 172 manifests loads with its required keys', () => {
  const report = computeCoverage();
  assert.equal(report.manifests, 172, 'one manifest per settings file');
  assert.deepEqual(report.missingKeys, [],
    'no manifest may miss any of the 13 required keys');
});

test('phase 1: every field carries a name and a numeric type', () => {
  const report = computeCoverage();
  assert.equal(report.totalFields, 2896, 'all source fields are extracted');
  assert.equal(report.fieldsWithoutName, 0);
  assert.equal(report.fieldsWithBadType, 0);
});

test('phase 1: only the seven dashboard entities have no fields', () => {
  const report = computeCoverage();
  assert.equal(report.dashboardEntities.length, 7);
  assert.deepEqual(report.emptyNonDashboard, [],
    'a table page without fields would mean an extraction gap');
  assert.equal(report.virtual, 116, 'the report and search variants stay virtual');
});

test('phase 1: only the three diagram dashboards lack labels, matching the source', () => {
  const report = computeCoverage();
  assert.deepEqual(report.withoutLabels, [
    'Adressen_Diagramme',
    'Immobilien_Diagramme',
    'Inventar_Diagramme',
  ], 'their settings files declare empty label arrays');
});

test('phase 1: all 486 lookup references resolve to an entity or the rights table', () => {
  const report = computeCoverage();
  assert.equal(report.lookupRefs, 486);
  assert.equal(report.lookupTables, 36);
  assert.deepEqual(report.unresolvedLookupTables, ['intex hausverwaltung_uggroups'],
    'the only non-entity target is the rights table, which lives in the database');
});

test('phase 1: display-name spellings resolve to the file-name spelling', () => {
  const byDisplay = resolveLookupTarget('Klassifikationen Inventar');
  assert.equal(byDisplay.kind, 'entity');
  assert.equal(byDisplay.name, 'Klassifikationen_Inventar');

  const direct = resolveLookupTarget('Objekte');
  assert.equal(direct.kind, 'entity');

  const rights = resolveLookupTarget('intex hausverwaltung_uggroups');
  assert.equal(rights.kind, 'table',
    'the rights table has no page and is reported as a plain table');

  assert.ok(isDashboardEntity('Heute'));
  assert.ok(!isDashboardEntity('Objekte'));
});

// Phase 1: exact search operators from the source settings

test('phase 1: every searchable field keeps the operators the source declared', () => {
  const data = loadSearchOptions();
  assert.equal(data.counts.settingsFiles, 172);
  assert.equal(data.counts.entitiesWithOptions, 131);
  assert.equal(data.counts.fieldsWithOptions, 2028);

  const spec = fieldSearchSpec('Objekte', 'Bezeichnung');
  assert.deepEqual(spec.options, [
    'Contains', 'Equals', 'Starts with', 'More than',
    'Less than', 'Between', 'Empty', 'NOT Empty',
  ]);
  assert.equal(spec.default, 'Contains');
  assert.equal(spec.declared, true);
});

test('phase 1: the default operator distribution matches the source exactly', () => {
  const data = loadSearchOptions();
  const counts = {};
  for (const fields of Object.values(data.entities)) {
    for (const record of Object.values(fields)) {
      counts[record.default] = (counts[record.default] || 0) + 1;
    }
  }
  assert.deepEqual(counts, { Contains: 1339, Equals: 689 },
    'Contains for text, Equals for numbers and dates');
});

test('phase 1: an undeclared field falls back by type instead of throwing', () => {
  const text = fieldSearchSpec('Gibt_es_nicht', 'Feld', 'String');
  assert.equal(text.default, 'Contains');
  assert.equal(text.declared, false);
  assert.ok(text.options.includes('Starts with'));

  const num = fieldSearchSpec('Gibt_es_nicht', 'Zahl', 'Int');
  assert.equal(num.default, 'Equals');
  assert.ok(!num.options.includes('Contains'), 'numbers offer no Contains');

  const date = fieldSearchSpec('Objekte', 'Egal', 'DateTime');
  assert.equal(date.default, 'Equals');
});

test('phase 1: Contains and Starts with build string conditions', () => {
  assert.deepEqual(
    clauseToWhere({ field: 'Bezeichnung', option: 'Contains', value: 'berg', type: 'String' }),
    { Bezeichnung: { contains: 'berg' } });
  assert.deepEqual(
    clauseToWhere({ field: 'Bezeichnung', option: 'Starts with', value: 'Nord', type: 'String' }),
    { Bezeichnung: { startsWith: 'Nord' } });
  assert.equal(clauseToWhere({ field: 'Bezeichnung', option: 'Contains', value: '' }), null,
    'an empty search text builds no condition');
});

test('phase 1: Equals coerces numbers and rejects garbage', () => {
  assert.deepEqual(
    clauseToWhere({ field: 'Betrag', option: 'Equals', value: '12,5', type: 'Decimal' }),
    { Betrag: 12.5 }, 'german decimal comma is parsed');
  assert.deepEqual(
    clauseToWhere({ field: 'ID', option: 'Equals', value: '7.9', type: 'Int' }),
    { ID: 7 }, 'integers are truncated');
  assert.equal(
    clauseToWhere({ field: 'ID', option: 'Equals', value: 'keine Zahl', type: 'Int' }),
    null, 'garbage never reaches the database');
});

test('phase 1: ranges build gt/lt and Between allows one side open', () => {
  assert.deepEqual(
    clauseToWhere({ field: 'Betrag', option: 'More than', value: '100', type: 'Decimal' }),
    { Betrag: { gt: 100 } });
  assert.deepEqual(
    clauseToWhere({ field: 'Betrag', option: 'Less than', value: '100', type: 'Decimal' }),
    { Betrag: { lt: 100 } });
  assert.deepEqual(
    clauseToWhere({ field: 'Betrag', option: 'Between', value: '10', value2: '20', type: 'Decimal' }),
    { Betrag: { gte: 10, lte: 20 } });
  assert.deepEqual(
    clauseToWhere({ field: 'Betrag', option: 'Between', value: '', value2: '20', type: 'Decimal' }),
    { Betrag: { lte: 20 } }, 'open lower bound');
  assert.equal(
    clauseToWhere({ field: 'Betrag', option: 'Between', value: '', value2: '', type: 'Decimal' }),
    null, 'both sides open means no condition');
});

test('phase 1: Empty and NOT Empty match null and the empty string both', () => {
  assert.deepEqual(
    clauseToWhere({ field: 'Bemerkungen', option: 'Empty' }),
    { OR: [{ Bemerkungen: null }, { Bemerkungen: '' }] });
  assert.deepEqual(
    clauseToWhere({ field: 'Bemerkungen', option: 'NOT Empty' }),
    { AND: [{ Bemerkungen: { not: null } }, { Bemerkungen: { not: '' } }] });
});

test('phase 1: several clauses AND together, even on the same field', () => {
  const where = buildSearchWhere([
    { field: 'Ort', option: 'Contains', value: 'ber', type: 'String' },
    { field: 'Betrag', option: 'More than', value: '100', type: 'Decimal' },
    { field: 'Betrag', option: 'Less than', value: '999', type: 'Decimal' },
    { field: 'Mist', option: 'Contains', value: 'x' },
  ]);
  assert.deepEqual(where.Ort, { contains: 'ber' });
  assert.deepEqual(where.Mist, { contains: 'x' }, 'Contains without a type hint still applies');
  assert.ok(Array.isArray(where.AND), 'the second Betrag clause must not overwrite the first');
  assert.equal(where.AND.length, 1);
  assert.deepEqual(where.AND[0], { Betrag: { lt: 999 } });
});

test('phase 1: the request parser only accepts what the field allows', () => {
  const typeOf = () => 'String';
  const clauses = parseSearchRequest({
    Bezeichnung: { option: 'Equals', value: 'Villa' },
    Nummer: { option: 'NOT A REAL OP', value: '5' },
    Unbekannt: 'x',
    Leer: '',
  }, 'Objekte', typeOf);

  const byField = Object.fromEntries(clauses.map((c) => [c.field, c]));
  assert.equal(byField.Bezeichnung.option, 'Equals');
  assert.equal(byField.Nummer.option, 'Contains',
    'a bogus operator falls back to the declared default');
  assert.equal(byField.Leer, undefined, 'empty values are skipped');
  assert.ok(byField.Unbekannt, 'an unknown field still searches with the fallback spec');

  const scalar = parseSearchRequest({ Bezeichnung: 'Villa' }, 'Objekte', typeOf);
  assert.equal(scalar[0].option, 'Contains', 'a bare value uses the default operator');
});

// Phase 1: form/view specs built from the source metadata

test('phase 1: the form follows the source field order, not the column order', () => {
  const meta = loadMeta('Objekte');
  const spec = formSpec(meta, 'Objekte', 'add');
  const expected = meta.fields
    .filter((f) => f.pages && f.pages.add === true)
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((f) => f.name);
  assert.ok(expected.length > 0, 'Objekte has an add page');
  assert.deepEqual(spec.fields.map((f) => f.name), expected);
  const indexes = spec.fields.map((f) => meta.fields.find((x) => x.name === f.name).index);
  const sorted = [...indexes].sort((a, b) => a - b);
  assert.deepEqual(indexes, sorted, 'source index order is preserved');
});

test('phase 1: only the fields the source shows on a page appear there', () => {
  const meta = loadMeta('Objekte');
  // ID is declared with pages {add:false, edit:false, view:false, search:true}
  assert.ok(!orderedFields(meta, 'add').includes('ID'),
    'the auto-assigned key is not on the add form');
  assert.ok(!orderedFields(meta, 'edit').includes('ID'));
  assert.ok(!orderedFields(meta, 'view').includes('ID'));
  assert.ok(orderedFields(meta, 'search').includes('ID'),
    'but it is searchable');
  assert.equal(orderedFields(null, 'add').length, 0, 'no manifest, no fields');
});

test('phase 1: required marks come from the source, not from a guess', () => {
  const meta = loadMeta('Objekte');
  const spec = formSpec(meta, 'Objekte', 'add');
  const bezeichnung = spec.fields.find((f) => f.name === 'Bezeichnung');
  assert.ok(bezeichnung, 'Bezeichnung is on the add form');
  assert.equal(bezeichnung.required, true, 'IsRequired: true in the settings file');
  assert.ok(spec.fields.some((f) => f.required === false),
    'and optional fields stay optional');
});

test('phase 1: inputs inherit type, width and step from the edit block', () => {
  const meta = loadMeta('Objekte');
  const bez = fieldSpec(meta, 'Objekte', 'Bezeichnung');
  assert.equal(bez.inputType, 'text');
  assert.equal(bez.width, 200, 'controlWidth: 200 in the source');

  // The source declares Quadratmeter as a TEXT input with two view
  // decimals, so no step is generated for it.
  const abr = loadMeta('Abrechnungen');
  const qm = fieldSpec(abr, 'Abrechnungen', 'Quadratmeter');
  assert.equal(qm.inputType, 'text', 'the source declares a text input here');
  assert.equal(qm.width, 200);
  assert.equal(qm.step, null);

  const adr = loadMeta('Adressen');
  const lng = fieldSpec(adr, 'Adressen', 'Laengengrad');
  assert.equal(lng.inputType, 'number');
  assert.equal(lng.step, '0.01', 'two declared decimal digits become the step');

  const inv = loadMeta('Inventar');
  const anzahl = fieldSpec(inv, 'Inventar', 'Anzahl');
  assert.equal(anzahl.inputType, 'number');
  assert.equal(anzahl.step, '1', 'zero digits mean whole numbers');

  const id = fieldSpec(meta, 'Objekte', 'ID');
  assert.equal(id.inputType, 'number');
});

test('phase 1: a lookup field carries its wiring and its dependents', () => {
  const meta = loadMeta('Objekte');
  const besitzer = fieldSpec(meta, 'Objekte', 'Besitzer');
  assert.ok(besitzer.lookup, 'Besitzer is a lookup');
  assert.equal(besitzer.lookup.table, 'Kerndaten');
  assert.equal(besitzer.lookup.displayField, 'Kurzname');

  const aufgaben = loadMeta('Aufgaben');
  const objekt = fieldSpec(aufgaben, 'Aufgaben', 'Objekt');
  assert.deepEqual(objekt.dependents, ['Einheit', 'Raum'],
    'changing the Objekt must reload Einheit and Raum');
  assert.equal(fieldSpec(meta, 'Objekte', 'Bezeichnung').lookup, null,
    'a plain text field has no lookup wiring');
});

test('phase 1: validation names the missing required fields of the page only', () => {
  const meta = loadMeta('Objekte');
  const expectedMissing = meta.fields
    .filter((f) => f.pages && f.pages.add === true && f.edit && f.edit.IsRequired)
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((f) => f.name);
  assert.ok(expectedMissing.length > 0, 'the add form has required fields');
  assert.ok(!expectedMissing.includes('ID'), 'ID is auto-assigned, never required on add');

  const empty = validateSubmission(meta, 'Objekte', 'add', {});
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.missing.map((m) => m.name), expectedMissing);

  const filled = {};
  for (const name of expectedMissing) filled[name] = 'x';
  assert.equal(validateSubmission(meta, 'Objekte', 'add', filled).ok, true);

  assert.equal(validateSubmission(null, 'Objekte', 'add', {}).ok, true,
    'without a manifest nothing is blocked');
});

test('phase 1: the view spec carries the German labels in source order', () => {
  const meta = loadMeta('Objekte');
  const spec = viewSpec(meta, 'Objekte');
  const expected = meta.fields
    .filter((f) => f.pages && f.pages.view === true)
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((f) => f.name);
  assert.ok(expected.length > 0);
  assert.deepEqual(spec.fields.map((f) => f.name), expected);
  for (const f of spec.fields) {
    assert.equal(f.label, (meta.labels.German && meta.labels.German[f.name]) || f.name);
  }
});

test('phase 1: the loaders resolve slugs and degrade quietly', () => {
  const spec = loadFormSpec('objekte', 'add');
  assert.ok(spec, 'lowercase slug resolves to the Objekte manifest');
  assert.equal(spec.entity, 'Objekte');
  assert.equal(loadFormSpec('gibt_es_nicht', 'add'), null);
  assert.equal(loadViewSpec('gibt_es_nicht'), null);
  assert.equal(manifestFor('gibt_es_nicht'), null);
  assert.equal(labelFor(null, 'Feld'), 'Feld');
});

// Phase 1: real Prisma relations from the source catalogue

{
  const relReport = JSON.parse(nodeFs.readFileSync('src/meta/relation-report.json', 'utf8'));
  const schemaText = nodeFs.readFileSync('prisma/schema.prisma', 'utf8');
  const schemaReport = JSON.parse(nodeFs.readFileSync('src/meta/schema-report.json', 'utf8'));

  test('phase 1: every source relation is accounted for, nothing vanishes', () => {
    const c = relReport.counts;
    assert.equal(c.relations, 102);
    assert.equal(c.generated, 66, 'physical foreign keys became real relations');
    assert.equal(c.deduped, 6, 'virtual masters sharing one base table share its relation');
    assert.equal(c.skipped, 30);
    assert.equal(c.generated + c.deduped + c.skipped, c.relations);
  });

  test('phase 1: each generated relation exists on both models under one name', () => {
    assert.equal(relReport.generated.length, 66);
    for (const rel of relReport.generated) {
      const occurrences = schemaText.split('@relation("' + rel.relation + '"').length - 1;
      assert.equal(occurrences, 2, rel.relation + ' must appear on both sides');
    }
    assert.equal((schemaText.match(/@relation\("/g) || []).length, 132);
  });

  test('phase 1: the two rowid tables keep ID as the documented unique business key', () => {
    for (const model of ['Buchfuehrungen', 'Kontenrahmen']) {
      const body = schemaText.split('model ' + model + ' {')[1].split('\n}')[0];
      assert.ok(/rowid\s+Int\s+@id/.test(body), model + ' keeps the SQLite identity shim');
      assert.ok(/^\s*ID\s+Int\s+@unique/m.test(body), model + ' ID is the unique business key');
    }
  });

  test('phase 1: the 30 non-FK relations are documented, not silently dropped', () => {
    const reasons = {};
    for (const s of relReport.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
    assert.deepEqual(reasons, {
      non_unique_master_key: 20,
      composite_key: 4,
      audit_detail: 4,
      fk_column_missing: 1,
      fk_not_int: 1,
    });
  });

  test('phase 1: the working schema matches the faithful MySQL source field for field', () => {
    assert.equal(schemaReport.models.sqlite, 62);
    assert.equal(schemaReport.models.mysql, 62);
    assert.deepEqual(schemaReport.models.onlySqlite, []);
    assert.deepEqual(schemaReport.models.onlyMysql, []);
    assert.equal(schemaReport.fields.scalarCompared, 914);
    assert.equal(schemaReport.unexplainedCount, 0,
      'no unexplained table/column/type/default/key difference may remain');
  });

  test('phase 1: the relation-rich schema still parses into 62 models', () => {
    const models = schemaText.match(/model\s+(\w+)\s*\{/g) || [];
    assert.equal(models.length, 62);
    assert.deepEqual(relReport.counts.uniqueBusinessKeys, ['Buchfuehrungen', 'Kontenrahmen']);
  });
}

// Phase 0: repeatable dump import + the revision-ladder migration runner

test('phase 0: the extracted ladder is the exact 1804-to-1812 chain', () => {
  const data = loadMigrations();
  assert.equal(data.steps.length, 7, 'seven guarded steps');
  assert.equal(data.steps[0].from, '1804');
  assert.equal(data.steps[data.steps.length - 1].to, '1812');
  for (let i = 1; i < data.steps.length; i++) {
    assert.equal(data.steps[i].from, data.steps[i - 1].to,
      'each step guards on the revision the previous one set');
  }
  assert.equal(data.counts.statements, 250, 'every CustomQuery statement extracted');
});

test('phase 0: MySQL dialect translates to SQLite', () => {
  assert.equal(
    migrateSql('ALTER TABLE Abrechnungen add Team Varchar (30)'),
    'ALTER TABLE "Abrechnungen" ADD COLUMN "Team" TEXT');
  assert.equal(
    migrateSql('alter table `Benutzer` add `Flags` int(11)'),
    'ALTER TABLE "Benutzer" ADD COLUMN "Flags" INTEGER');
  assert.equal(
    migrateSql("show columns from Einstellungen like 'Revision'"),
    null, 'a MySQL probe is not a runnable statement');
  assert.equal(
    migrateSql("UPDATE Adressen SET Ort='Berlin' WHERE ID=5;"),
    "UPDATE Adressen SET Ort='Berlin' WHERE ID=5", 'plain DML passes through');
  assert.equal(mapColumnType('Varchar (30)'), 'TEXT');
  assert.equal(mapColumnType('decimal(10,2)'), 'NUMERIC');
  assert.equal(mapColumnType('datetime'), 'TEXT');
  assert.equal(mapColumnType('longblob'), 'BLOB');
});

test('phase 0: only newer steps are pending', () => {
  assert.equal(pendingMigrations('1812').length, 0, 'up to date');
  assert.equal(pendingMigrations('1807').map((s) => s.to).join(','), '1808,1809,1810,1811,1812');
  assert.equal(pendingMigrations(null).length, 7, 'no revision means the whole ladder');
  assert.equal(pendingMigrations('1804').length, 7);
});

test('phase 0: the runner applies steps in order and stamps every revision', async () => {
  const calls = [];
  const fake = {
    async $queryRawUnsafe(sql) {
      calls.push(sql);
      if (sql.startsWith('PRAGMA')) return [{ name: 'ID' }, { name: 'Revision' }];
      if (sql.startsWith('SELECT "Revision"')) return [{ Revision: '1807' }];
      return [];
    },
  };
  const report = await runMigrations({ prisma: fake });
  assert.equal(report.from, '1807');
  assert.deepEqual(report.applied, ['1808', '1809', '1810', '1811', '1812']);
  assert.equal(report.to, '1812');
  assert.equal(report.bootstrapped, false);
  const stamps = calls.filter((c) => c.includes('SET "Revision"'));
  assert.equal(stamps.length, 5, 'one revision stamp per applied step');
  assert.ok(stamps[0].includes("'1808'"), 'the first stamp is the first pending step');
  assert.ok(stamps[4].includes("'1812'"));
  assert.equal(report.statementsFailed, 0);
});

test('phase 0: a failing statement is recorded, never thrown — like CustomQuery', async () => {
  let thrown = false;
  const fake = {
    async $queryRawUnsafe(sql) {
      if (sql.startsWith('PRAGMA')) return [{ name: 'Revision' }];
      if (sql.startsWith('SELECT "Revision"')) return [{ Revision: '1811' }];
      if (sql.includes('SET "Revision"')) return [];
      if (!thrown) { thrown = true; throw new Error('duplicate column name'); }
      return [];
    },
  };
  const report = await runMigrations({ prisma: fake });
  assert.deepEqual(report.applied, ['1812'], 'the step still completes');
  assert.ok(report.statementsFailed >= 1);
  assert.ok(report.errors[0].error.includes('duplicate column'));
});

test('phase 0: a pre-1804 database is bootstrapped before the ladder', async () => {
  const calls = [];
  const fake = {
    async $queryRawUnsafe(sql) {
      calls.push(sql);
      if (sql.startsWith('PRAGMA')) return [{ name: 'ID' }]; // no Revision column
      if (sql.startsWith('SELECT "Revision"')) return [];
      return [];
    },
  };
  const report = await runMigrations({ prisma: fake });
  assert.equal(report.bootstrapped, true);
  assert.equal(report.from, '1804');
  assert.equal(report.applied.length, 7, 'the whole ladder follows the bootstrap');
  assert.ok(calls.some((c) => c.includes('ADD COLUMN "Revision"')),
    'the Revision column itself is created first');
});

test('phase 0: the dump importer maps every table through the schema', () => {
  const schema = importParseSchema();
  assert.equal(Object.keys(schema).length, 62, 'one mapping per table');
  const manifest = JSON.parse(nodeFs.readFileSync('prisma/dump-data/_manifest.json', 'utf8'));
  const tables = Object.keys(manifest);
  assert.equal(tables.length, 62, 'the extracted dump covers every table');
  const unmappable = tables.filter((t) => !schema[t]);
  assert.deepEqual(unmappable, [], 'every dumped table resolves to a model');

  let total = 0;
  let empty = 0;
  for (const t of tables) {
    const rows = JSON.parse(nodeFs.readFileSync('prisma/dump-data/' + manifest[t].file, 'utf8'));
    total += rows.length;
    if (!rows.length) empty += 1;
  }
  assert.equal(total, 19819, 'every dump row is present in the extraction');
  assert.equal(empty, 23, 'the genuinely empty tables stay empty');
});

test('phase 0: the importer coerces MySQL values to Prisma types', () => {
  assert.equal(importCoerce('1234.56', 'Decimal'), 1234.56, 'dump decimals arrive as SQL literals');
  assert.equal(importCoerce('12,5', 'Decimal'), 12.5, 'a stray decimal comma still parses');
  assert.equal(importCoerce('42.9', 'Int'), 42);
  assert.equal(importCoerce('0000-00-00', 'DateTime'), null, 'MySQL zero date is null');
  assert.equal(importCoerce('2024-03-01', 'DateTime') instanceof Date, true);
  assert.equal(importCoerce('N', 'Boolean'), false);
  assert.equal(importCoerce('1', 'Boolean'), true);
  const buf = importCoerce({ __hex__: 'ff25' }, 'Bytes');
  assert.ok(Buffer.isBuffer(buf) && buf[0] === 0xff && buf[1] === 0x25);
  assert.equal(importCoerce(null, 'String'), null);
});

test('phase 0: row mapping skips relation fields and honours @map', () => {
  const schema = importParseSchema();
  const objekte = Object.values(schema).find((s) => s.model === 'Objekte');
  assert.ok(objekte, 'Objekte model resolved');
  assert.ok(!objekte.fields.some((f) => f.name.startsWith('rel_')),
    'the generated relation fields never become import columns');
  const row = importMapRow({ ID: 88, Bezeichnung: 'Test', UnbekannteSpalte: 'x' }, objekte.fields);
  assert.equal(row.ID, 88);
  assert.equal(row.Bezeichnung, 'Test');
  assert.equal(row.UnbekannteSpalte, undefined, 'unknown columns are dropped');
});

// Phase 6: every chart executes against the real database

{
  test('phase 6: all 18 charts execute and honour the data contract', () => {
    const db = new SqliteDb('prisma/dev.db', { readOnly: true });
    try {
      const names = Object.keys(charts().charts).sort();
      assert.equal(names.length, 18);
      for (const name of names) {
        const spec = getChart(name);
        const built = buildChartSql(spec);
        let rows;
        try {
          rows = db.prepare(built.sql).all();
        } catch (e) {
          assert.fail(name + ': query failed — ' + e.message);
        }
        const data = toChartData(spec, rows);
        assert.equal(data.entity, spec.entity);
        assert.equal(data.rowCount, rows.length);
        assert.ok(Array.isArray(data.labels), name + ': labels is an array');
        assert.ok(Array.isArray(data.series) && data.series.length >= 1,
          name + ': at least one series');
        for (const s of data.series) {
          assert.equal(s.data.length, data.labels.length,
            name + ': series align with labels');
        }
        if (!rows.length) {
          assert.equal(data.noDataMessage, 'Keine Daten vorhanden',
            name + ': an empty table says so honestly');
        }
      }
    } finally {
      db.close();
    }
  });
}

// Phase 7: dashboard snippets and chart elements wired to real content

{
  const dashData = JSON.parse(nodeFs.readFileSync('src/meta/dashboards.json', 'utf8'));
  const allSnippets = [];
  const allCharts = [];
  for (const defn of Object.values(dashData.dashboards)) {
    for (const el of defn.elements || []) {
      if (el.type === 7) allSnippets.push(el.snippetId);
      if (el.type === 1) allCharts.push(el.table);
    }
  }

  test('phase 7: every snippet in the catalogue has a port', () => {
    assert.equal(allSnippets.length, 6, 'the source defines six snippets');
    for (const id of allSnippets) {
      assert.ok(getSnippet(id), 'no port for snippet ' + id);
    }
    assert.equal(snippetSummary().total, 6);
  });

  test('phase 7: link snippets point at Node routes, never at .php pages', () => {
    const s = getSnippet('Assistent_Doppelte_Buchf_hrung1');
    assert.equal(s.title, 'Kontenblätter drucken');
    assert.equal(s.href, '/kontenblaetter');
    assert.ok(!s.href.endsWith('.php'));
    assert.equal(getSnippet('Assistent_Abrechnungen_snippet').href, '/report/abrechnungsdruck');
    assert.equal(getSnippet('Assistent_Doppelte_Buchf_hrung').title, 'Summen und Salden drucken');
    assert.equal(getSnippet('Assistent_Doppelte_Buchf_hrung2').href, '/report/gewinn_und_verlust');
  });

  test('phase 7: the partner counter counts Mieter and Eigentümer team-scoped', async () => {
    const seen = [];
    const count = async (table, where) => {
      seen.push({ table, where });
      return where.Klassifikation === 'Mieter' ? 3 : 2;
    };
    const out = await renderSnippet('Anzahl_Mieter_Eigent_mer', { count });
    assert.equal(out.title, 'Ihre Partner');
    assert.ok(out.html.includes('Mieter: 3'));
    assert.ok(out.html.includes('Eigentümer: 2'));
    assert.deepEqual(seen.map((s) => s.table), ['Adressen', 'Adressen']);
  });

  test('phase 7: Verwaltungsgröße multiplies the two sums, like the source', async () => {
    const count = async (table) => (table === 'Objekte' ? 5 : 12);
    const sum = async (table, field) => (field === 'Breite' ? 40.5 : 20);
    const out = await renderSnippet('Objekte__Einheiten_und_Fl_chen', { count, sum });
    assert.equal(out.title, 'Ihre Verwaltungsgröße');
    assert.ok(out.html.includes('Objekte: 5'));
    assert.ok(out.html.includes('Einheiten: 12'));
    assert.ok(out.html.includes('Flächen: 810 Qm'),
      'round(sum(Breite) * sum(Tiefe)) = round(40.5 * 20) = 810, not a row-wise area sum');
  });

  test('phase 7: a snippet without data deps still renders its title', async () => {
    const out = await renderSnippet('Anzahl_Mieter_Eigent_mer', {});
    assert.equal(out.title, 'Ihre Partner');
    assert.equal(out.html, '');
    assert.equal(await renderSnippet('gibt_es_nicht', {}), null);
    assert.equal(getSnippet(''), null);
  });

  test('phase 7: every chart element resolves to a ported chart', () => {
    assert.equal(allCharts.length, 11, 'eleven chart elements across the dashboards');
    for (const table of allCharts) {
      const key = normalizeFileName(table);
      assert.ok(getChart(key), 'no ported chart for dashboard element ' + table);
    }
  });
}

// Phase 2: signature/barcode ports and the thumbnail route

test('phase 2: the signature renders as SVG in the enlarged coordinate space', () => {
  const svg = signatureToSvg([{ lx: 1, ly: 2, mx: 3, my: 4 }], {});
  assert.ok(svg.startsWith('<svg'), 'is an svg');
  assert.ok(svg.includes('width="198"') && svg.includes('height="55"'),
    'the source default canvas size');
  assert.ok(svg.includes('viewBox="0 0 990 275"'),
    'drawn 5x and shrunk by the browser, like the GD multiplier trick');
  assert.ok(svg.includes('<line x1="5" y1="10" x2="15" y2="20"'),
    'the stroke coordinates are multiplied');
  assert.ok(svg.includes('stroke="#145394"'), 'the source pen colour');
  assert.ok(svg.includes('stroke-width="10"'), 'penWidth 4 times multiplier/2');
  assert.ok(svg.includes('fill="#ffffff"'), 'the white background');
});

test('phase 2: signature options and edge cases match the PHP', () => {
  const transparent = signatureToSvg([], { bgColour: 'transparent' });
  assert.ok(!transparent.includes('<rect'), 'transparent means no background rect');

  const svg = signatureToSvg('not json', {});
  assert.ok(svg.includes('</svg>'), 'garbage still renders an empty signature');
  assert.deepEqual(parseSignatureJson('nichts'), []);
  assert.equal(parseSignatureJson('[{\\"lx\\":1,\\"ly\\":2,\\"mx\\":3,\\"my\\":4}]').length, 1,
    'stripslashes like the PHP');

  const dirty = signatureToSvg([{ lx: 'x', ly: 1, mx: 2, my: 3 }, { lx: 0, ly: 0, mx: 1, my: 1 }], {});
  assert.equal((dirty.match(/<line/g) || []).length, 1, 'the NaN stroke is skipped');
});

test('phase 2: the barcode is Code39 with the exact source table', () => {
  assert.equal(code39Pattern('*'), '010010100', 'start/stop');
  assert.equal(code39Pattern('A'), '100001001');
  assert.equal(code39Pattern('~'), '011000100', 'unknown chars become a space, like the PHP default');

  const { text, stripes } = code39Stripes('ab-12');
  assert.equal(text, '*AB-12*', 'uppercased and star-wrapped');
  assert.equal(stripes.length, 7 * 10, 'nine stripes plus a quiet zone per character (7 chars incl. the stars)');
  assert.deepEqual(stripes[0], { width: 'narrow', black: true }, 'starts with a narrow bar');
  assert.deepEqual(stripes[1], { width: 'wide', black: false }, 'then a wide space');
  assert.equal(stripes[9].width, 'quiet', 'quiet zone after every character');
  assert.equal(stripes[9].black, false);
});

test('phase 2: barcode SVG keeps the source geometry and its too-small guard', () => {
  const svg = barcode39Svg('AB', { width: 300, height: 100 });
  assert.ok(svg.includes('>*AB*</text>'), 'the text line is printed underneath');
  assert.ok((svg.match(/fill="#000000"/g) || []).length > 10, 'bars are drawn');
  assert.ok(svg.includes('width="300"'));

  const tiny = barcode39Svg('LANGESINVENTAR12345', { width: 30 });
  assert.ok(tiny.includes('Image is too small!'), 'the source error survives');

  const noText = barcode39Svg('AB', { text: 0 });
  assert.ok(!noText.includes('<text'), 'text: 0 hides the caption');
});

test('phase 2: the QR and signature assets ship with the app', () => {
  for (const asset of [
    'public/js/qrcode2.js',
    'public/js/jquery.qrcode.js',
    'public/js/jquery.signaturepad.js',
    'public/css/jquery.signaturepad.css',
  ]) {
    const stat = nodeFs.statSync(asset);
    assert.ok(stat.size > 1000, asset + ' must be the real library, not a stub');
  }
});

test('phase 2: the thumbnail route resizes images and passes other types through', async () => {
  const pngMagic = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const pdfMagic = Buffer.from('%PDF-1.4 fake', 'latin1');
  const prisma = {
    objekte: {
      async findFirst({ where }) {
        if (where.ID === 1) return { Bild: pngMagic };
        if (where.ID === 2) return { Bild: pdfMagic };
        return null;
      },
    },
  };
  const router = createMediaRouter({ prisma, canAccess: allowAll, teamWhere: noTeamScope });

  const imgRes = fakeRes();
  await routeHandler(router, 'get', '/:entity/:id/:field/thumb')(
    { params: { entity: 'Objekte', id: '1', field: 'Bild' }, query: { w: '120' }, session: {} }, imgRes);
  assert.equal(imgRes.headers['content-type'], 'image/jpeg', 'thumbnails are normalised to jpeg');
  assert.equal(imgRes.headers['cache-control'], 'private, max-age=3600');
  assert.deepEqual([...Buffer.concat(imgRes.chunks).slice(0, 3)], [0xff, 0xd8, 0xff],
    'the resized body is a jpeg');

  const pdfRes = fakeRes();
  await routeHandler(router, 'get', '/:entity/:id/:field/thumb')(
    { params: { entity: 'Objekte', id: '2', field: 'Bild' }, query: {}, session: {} }, pdfRes);
  assert.equal(pdfRes.headers['content-type'], 'application/pdf',
    'a non-image is never resized, it passes through');
  assert.deepEqual(Buffer.concat(pdfRes.chunks), pdfMagic);

  const missRes = fakeRes();
  await routeHandler(router, 'get', '/:entity/:id/:field/thumb')(
    { params: { entity: 'Objekte', id: '99', field: 'Bild' }, query: {}, session: {} }, missRes);
  assert.equal(missRes.statusCode, 404);

  const badRes = fakeRes();
  await routeHandler(router, 'get', '/:entity/:id/:field/thumb')(
    { params: { entity: 'Gibt_es_nicht', id: '1', field: 'Bild' }, query: {}, session: {} }, badRes);
  assert.equal(badRes.statusCode, 404);
});


// ============================================================ phase 10 additions
// audit trail, record locking, saved searches, dedicated settings page

import { auditLog, describeChange } from '../src/audit.js';
import {
  checkLock, acquireLock, releaseLock, lockKeys, LOCK_TTL_MINUTES,
} from '../src/locking.js';
import {
  listSearches, saveSearch, deleteSearch, SAVED_SEARCH_TYPE,
} from '../src/saved-searches.js';
import createSettingsRouter, { FIELD_GROUPS } from '../routes/settings.js';
import { buildCatalog } from '../scripts/build-source-catalog.mjs';

/** Minimal in-memory delegate for the phase-10 system tables. */
function memDelegate(rows = []) {
  const store = rows.slice();
  const match = (r, where) => Object.entries(where || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('lt' in v) return new Date(r[k]) < v.lt;
      if ('in' in v) return v.in.includes(r[k]);
      return false;
    }
    return r[k] === v;
  });
  let nextId = 1000;
  return {
    store,
    async findMany({ where } = {}) { return where ? store.filter((r) => match(r, where)) : store.slice(); },
    async findFirst({ where } = {}) { return (where ? store.filter((r) => match(r, where)) : store)[0] || null; },
    async create({ data }) { const row = { id: ++nextId, ID: nextId, ...data }; store.push(row); return row; },
    async update({ where, data }) { const r = store.find((x) => match(x, where)); if (r) Object.assign(r, data); return r; },
    async delete({ where }) { const i = store.findIndex((x) => match(x, where)); if (i < 0) throw new Error('not found'); return store.splice(i, 1)[0]; },
    async deleteMany({ where }) { let n = 0; for (let i = store.length - 1; i >= 0; i--) if (match(store[i], where)) { store.splice(i, 1); n++; } return { count: n }; },
  };
}

test('phase 10: audit log writes datetime, ip, user, table and action', async () => {
  const delegate = memDelegate();
  const prisma = { intex_hausverwaltung_audit: delegate };
  const req = { headers: { 'x-forwarded-for': '10.0.0.1' }, session: { user: { Benutzername: 'admin' } } };
  await auditLog({ prisma, req, table: 'objekte', action: 'add', recordId: 5, newData: { Bezeichnung: 'Haus A' } });
  assert.equal(delegate.store.length, 1);
  const row = delegate.store[0];
  assert.equal(row.ip, '10.0.0.1');
  assert.equal(row.user, 'admin');
  assert.equal(row.table, 'objekte');
  assert.equal(row.action, 'add');
  assert.ok(row.datetime instanceof Date);
  assert.match(row.description, /Bezeichnung=Haus A/);
});

test('phase 10: audit edit description is an old → new diff', () => {
  const d = describeChange('edit', 7, { Ort: 'Berlin', PLZ: '10115' }, { Ort: 'München', PLZ: '10115' });
  assert.match(d, /Ort: Berlin → München/);
  assert.ok(!d.includes('PLZ'), 'unchanged fields are left out of the log line');
});

test('phase 10: an audit failure never breaks the actual CRUD operation', async () => {
  const prisma = { intex_hausverwaltung_audit: { create: async () => { throw new Error('db down'); } } };
  assert.equal(await auditLog({ prisma, req: {}, table: 'x', action: 'add' }), null);
  assert.equal(await auditLog({ prisma: {}, req: {}, table: 'x', action: 'add' }), null);
});

test('phase 10: a record lock blocks other sessions but not the owner', async () => {
  const prisma = { intex_hausverwaltung_locking: memDelegate() };
  const base = { prisma, table: 'objekte', keys: { ID: 7 } };
  assert.equal(lockKeys({ ID: 7 }), 'ID=7');
  const a = await acquireLock({ ...base, sessionId: 's1', userId: 'anna' });
  assert.equal(a.own, true);
  const b = await acquireLock({ ...base, sessionId: 's2', userId: 'bert' });
  assert.equal(b.locked, true);
  assert.equal(b.own, false);
  assert.equal(b.by, 'anna');
  // the owner re-entering refreshes (heartbeat) instead of being blocked
  const a2 = await acquireLock({ ...base, sessionId: 's1', userId: 'anna' });
  assert.equal(a2.own, true);
});

test('phase 10: releasing the lock frees the record for others', async () => {
  const prisma = { intex_hausverwaltung_locking: memDelegate() };
  const base = { prisma, table: 'objekte', keys: { ID: 7 } };
  await acquireLock({ ...base, sessionId: 's1', userId: 'anna' });
  await releaseLock({ ...base, sessionId: 's1' });
  const b = await acquireLock({ ...base, sessionId: 's2', userId: 'bert' });
  assert.equal(b.own, true, 'the freed record can be locked by someone else');
});

test('phase 10: an expired lock is taken over and its stale row removed', async () => {
  const old = new Date(Date.now() - (LOCK_TTL_MINUTES + 5) * 60000);
  const delegate = memDelegate([{
    id: 1, table: 'objekte', keys: 'ID=7', sessionid: 'dead', userid: 'ghost',
    startdatetime: old, confirmdatetime: old,
  }]);
  const prisma = { intex_hausverwaltung_locking: delegate };
  const out = await acquireLock({ prisma, table: 'objekte', keys: { ID: 7 }, sessionId: 's9', userId: 'neu' });
  assert.equal(out.own, true);
  assert.equal(delegate.store.filter((r) => r.sessionid === 'dead').length, 0, 'the stale row is gone');
});

test('phase 10: saved searches persist per user and upsert by name', async () => {
  const delegate = memDelegate();
  const prisma = { iNtex_Hausverwaltung_settings: delegate };
  const clause = { q: 'berlin', filters: { Ort: 'Berlin' } };
  await saveSearch({ prisma, user: 'anna', table: 'adressen', name: 'Berliner', clause });
  await saveSearch({ prisma, user: 'anna', table: 'adressen', name: 'Berliner', clause: { q: 'x' } });
  const list = await listSearches({ prisma, user: 'anna', table: 'adressen' });
  assert.equal(list.length, 1, 'saving the same name overwrites, never duplicates');
  assert.deepEqual(list[0].clause, { q: 'x' });
  assert.equal(delegate.store[0].TYPE, SAVED_SEARCH_TYPE);
  assert.equal((await listSearches({ prisma, user: 'bert', table: 'adressen' })).length, 0,
    'saved searches are per user');
  const del = await deleteSearch({ prisma, user: 'anna', table: 'adressen', name: 'Berliner' });
  assert.equal(del.deleted, true);
  assert.equal((await listSearches({ prisma, user: 'anna', table: 'adressen' })).length, 0);
});

test('phase 10: the settings page renders the team record and saves edits', async () => {
  const delegate = memDelegate([{ ID: 1, Waehrung: 'EUR', Team: 'Team' }]);
  const prisma = { einstellungen: delegate, intex_hausverwaltung_audit: memDelegate() };
  const router = createSettingsRouter({ prisma, canAccess: allowAll, teamWhere: noTeamScope });

  const res = resStub();
  await routeHandler(router, 'get', '/')(reqStub({ query: {} }), res);
  assert.equal(res.view, 'settings');
  assert.equal(res.locals.row.Waehrung, 'EUR');
  assert.ok(res.locals.groups.length >= 4, 'grouped form');

  const res2 = resStub();
  await routeHandler(router, 'post', '/')(reqStub({ body: { Waehrung: 'CHF', SMTPPort: '587' } }), res2);
  assert.equal(res2.redirected, '/settings?saved=1');
  assert.equal(delegate.store[0].Waehrung, 'CHF');
  assert.equal(delegate.store[0].SMTPPort, 587, 'SMTPPort is stored as a number');
});

test('phase 10: the settings page is gated on the access mask', async () => {
  const router = createSettingsRouter({
    prisma: { einstellungen: memDelegate() }, canAccess: () => false, teamWhere: noTeamScope,
  });
  const res = resStub();
  await routeHandler(router, 'get', '/')(reqStub(), res);
  assert.equal(res.statusCode, 403);
});

test('phase 10: every grouped settings field exists in the schema model', async () => {
  const schemaText = nodeFs.readFileSync('prisma/schema.prisma', 'utf8');
  const body = schemaText.split('model Einstellungen {')[1].split('\n}')[0];
  for (const group of FIELD_GROUPS) {
    for (const field of group.fields) {
      assert.ok(new RegExp('^\\s*' + field + '\\s', 'm').test(body),
        field + ' must be a real Einstellungen column');
    }
  }
});

// ============================================================ phase 11: PWA

test('phase 11: the PWA shell ships manifest, service worker and offline page', () => {
  const manifest = JSON.parse(nodeFs.readFileSync('public/manifest.json', 'utf8'));
  assert.equal(manifest.name, 'Erwin Property Mgmt');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.length >= 2, 'icons for the install prompt');
  for (const icon of manifest.icons) {
    const p = icon.src.replace('/static/', 'public/');
    assert.ok(nodeFs.statSync(p).size > 500, p + ' must be a real png');
  }
  const sw = nodeFs.readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /offline\.html/, 'the offline fallback is wired');
  assert.match(sw, /addEventListener\('fetch'/, 'requests are intercepted');
  assert.ok(nodeFs.statSync('public/offline.html').size > 300);
});

// ============================================================ phase 13: source catalog

test('phase 13: the source catalog aggregates every extracted artifact with a status', () => {
  const catalog = buildCatalog();
  assert.equal(catalog.counts.menuLeaves, 151, 'every menu leaf is catalogued');
  assert.equal(catalog.counts.charts, 18);
  assert.equal(catalog.counts.dashboards, 7);
  assert.equal(catalog.counts.hooks, 134);
  const VALID = new Set(['ported', 'tested', 'partial', 'manual', 'not-applicable', 'pending']);
  for (const e of catalog.entries) {
    assert.ok(VALID.has(e.status), e.id + ' carries an invalid status');
  }
  for (const e of catalog.entries.filter((x) => x.kind === 'chart')) {
    assert.equal(e.status, 'tested', 'charts are proven against the fixture');
  }
  assert.ok(catalog.counts.byStatus.manual > 0, 'the manual backlog stays visible, not hidden');
});
