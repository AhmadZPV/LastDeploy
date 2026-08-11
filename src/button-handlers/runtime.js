/**
 * Phase 3 - buttonhandler runtime.
 *
 * The 139 handlers of buttonhandler.php share one PHPRunner shell: push a
 * context, run a short custom snippet, echo my_json_encode($result). The
 * compiler (scripts/compile-button-handlers.py, not part of this snapshot)
 * turns each snippet into a declarative op stored in src/meta/handler-ops.json;
 * this module is the shell that executes those ops.
 *
 * When the compiled catalogue is absent (partial checkout) the runtime falls
 * back to the small set of handlers the docs name explicitly, so the routes
 * and tests keep working and the missing catalogue shows up as a reduced
 * total instead of failing silently.
 *
 * Security note: the PHP snippets concatenated $params[...] into SQL. The
 * compiled ops carry `binds` instead — values are bound, never interpolated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSepaTransferXml } from '../lib/sepa.js';
import { dispatchWebhook } from '../webhooks.js';
import { registry } from '../registry.js';
import { ACCOUNTING_HANDLERS, runAccountingHandler } from './accounting.js';
import { sendRecordMail, importMailMessages } from '../communications.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Handlers the planning doc names verbatim (11 manual + the demo paths). */
const FALLBACK_SPECS = {
  Notizen: { op: 'masterDetailLink', page: 'Notizen' },
  vCard: { op: 'vcard' },
  _ics_Kalender: { op: 'ical' },
  ...Object.fromEntries([
    'SKR03', 'SKR04', 'Immobilien', 'Wohnungswirtschaft', 'Mails_ziehen1',
    'Mails_ziehen11', 'Markierte_buchen', 'Kontrollsummen', 'Webhook',
    'BKVo1', 'BKVo2',
  ].map((id) => [id, { op: 'manual', source: 'buttonhandler.php' }])),
};

let _catalogue = null;
function catalogue() {
  if (_catalogue) return _catalogue;
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'src', 'meta', 'handler-ops.json'), 'utf8'));
    const specs = data.specs || data.handlers || {};
    const summary = data.summary || {};
    _catalogue = {
      specs,
      total: summary.total ?? Object.keys(specs).length,
      automated: summary.automated ?? 0,
      manual: summary.manual ?? 0,
      unrecognised: summary.unrecognised ?? 0,
      unrecognisedSamples: data.unrecognisedSamples || [],
      fromFile: true,
    };
  } catch {
    _catalogue = {
      specs: FALLBACK_SPECS,
      total: Object.keys(FALLBACK_SPECS).length,
      automated: Object.values(FALLBACK_SPECS).filter((s) => s.op !== 'manual').length,
      manual: Object.values(FALLBACK_SPECS).filter((s) => s.op === 'manual').length,
      unrecognised: 0,
      unrecognisedSamples: [],
      fromFile: false,
    };
  }
  return _catalogue;
}

/** Catalogue summary + specs (the /catalog route and the tests read this). */
export function ops() {
  const c = catalogue();
  const implemented = new Set(['New_Button', 'New_Button3', 'Mails_ziehen1', 'Mails_ziehen11', 'Markierte_duplizieren1', 'Markierte_buchen', 'Markierte_duplizieren', 'Markierte_duplizieren4', 'Markierte_dupliziere', 'Markierte_duplizieren5', 'Markierte_duplizieren6', 'BKVo1', 'BKVo2', 'Immobilien', 'Wohnungswirtschaft', 'SKR03', 'SKR04', 'Kontrollsummen', 'Webhook']);
  const remaining = Object.entries(c.specs).filter(([id, spec]) => (spec.op === 'manual' || spec.op === 'unrecognised') && !implemented.has(id));
  const automated = Object.entries(c.specs).filter(([id, spec]) => implemented.has(id) || (spec.op !== 'manual' && spec.op !== 'unrecognised')).length;
  const manual = Object.entries(c.specs).filter(([id, spec]) => spec.op === 'manual' && !implemented.has(id)).length;
  const unrecognised = Object.entries(c.specs).filter(([id, spec]) => spec.op === 'unrecognised' && !implemented.has(id)).length;
  return {
    total: c.total,
    automated,
    manual,
    unrecognised,
    specs: c.specs,
    unrecognisedSamples: remaining.map(([id]) => id),
  };
}

/** Every buttId the source dispatches. */
export function listHandlers() {
  return Object.keys(catalogue().specs);
}

/** One handler spec, case-insensitive like the PHP dispatch table. */
export function getSpec(buttId) {
  const specs = catalogue().specs;
  if (specs[buttId]) return specs[buttId];
  const want = String(buttId || '').toLowerCase();
  const key = Object.keys(specs).find((k) => k.toLowerCase() === want);
  return key ? specs[key] : null;
}

// ------------------------------------------------------------- PHP helpers

/** number_format($v, 2, ',', '.') */
export function numberFormatDe(value) {
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (value === null || value === undefined || value === '' || Number.isNaN(n)) return '';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

/** date("Ymd\THis") — utc=true appends the Z like date() on a GMT timestamp. */
export function dateToCal(value, utc = false) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  if (utc) {
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
      + `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  }
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** X_list.php -> /X ; X_view.php -> /X/view — the route shape of this port. */
export function pageToRoute(entity, pageType = 'list') {
  const base = '/' + entity;
  switch (String(pageType).toLowerCase()) {
    case 'list': return base;
    case 'view': return base + '/view';
    case 'add': return base + '/add';
    case 'edit': return base + '/edit';
    case 'search': return base + '/search';
    case 'print': return '/print/' + entity;
    case 'report': return '/report/' + entity;
    case 'export': return '/export/' + entity;
    case 'chart': return '/chart/' + entity;
    case 'dashboard': return '/dashboard/' + entity;
    default: return base;
  }
}

// ------------------------------------------------------------ record fetch

/** $button->getCurrentRecord(): the row the button was pressed on. */
async function getCurrentRecord({ entity, keys = [], prisma, req, teamWhere }) {
  if (!entity || !prisma) return null;
  const slug = String(entity).toLowerCase();
  const delegate = (registry[slug]?.model && prisma[registry[slug].model]) || prisma[slug]
    || prisma[slug.replace(/^./, (c) => c.toUpperCase())]
    || prisma[entity];
  if (!delegate || typeof delegate.findFirst !== 'function') return null;
  const where = teamWhere ? teamWhere(req, {}, slug) : {};
  const cols = ['ID'];
  keys.forEach((k, i) => {
    where[cols[i] || cols[0]] = /^-?\d+$/.test(String(k)) ? Number(k) : k;
  });
  try { return await delegate.findFirst({ where }); } catch { return null; }
}

// ------------------------------------------------------------ vCard / iCal

/** RFC 2426 text escaping. */
function escVcard(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildVcard(rec) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escVcard([rec.Vorname, rec.Nachname].filter(Boolean).join(' '))}`,
    `N:${escVcard(rec.Nachname)};${escVcard(rec.Vorname)};;;`,
  ];
  if (rec.Firma) lines.push(`ORG:${escVcard(rec.Firma)}`);
  if (rec.Stellung) lines.push(`TITLE:${escVcard(rec.Stellung)}`);
  if (rec.Email) lines.push(`EMAIL;TYPE=internet,pref:${escVcard(rec.Email)}`);
  if (rec.Telefon) lines.push(`TEL;TYPE=voice,pref:${escVcard(rec.Telefon)}`);
  if (rec.Handy) lines.push(`TEL;TYPE=cell:${escVcard(rec.Handy)}`);
  if (rec.Website) lines.push(`URL:${escVcard(rec.Website)}`);
  if (rec.Strasse || rec.PLZ || rec.Ort) {
    lines.push(`ADR;TYPE=home:;;${escVcard(rec.Strasse)};${escVcard(rec.Ort)};;${escVcard(rec.PLZ)};`);
  }
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/** RFC 5545 text escaping — semicolons must be escaped inside text values. */
function escIcal(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildIcal(rec) {
  const start = rec.Termin ? new Date(rec.Termin) : new Date();
  const end = new Date(start.getTime() + (Number(rec.Dauer) || 0) * 60000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ap-emlaki//termine//DE',
    'BEGIN:VEVENT',
    `UID:${rec.ID}@ap-emlaki`,
    `DTSTAMP:${dateToCal(new Date(), true)}`,
    `DTSTART:${dateToCal(start)}`,
    `DTEND:${dateToCal(end)}`,
    `SUMMARY:${escIcal([rec.Titel, rec.Zustaendigkeit ? 'Termin fuer ' + rec.Zustaendigkeit : null].filter(Boolean).join(' - '))}`,
  ];
  if (rec.Bemerkungen) lines.push(`DESCRIPTION:${escIcal(rec.Bemerkungen)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------------------------------------------------------------- runner

/**
 * Execute one button handler.
 *
 * @returns {Promise<{status:number, result:any, redirect?, body?,
 *   contentType?, filename?}>}
 */
export async function runHandler({ buttId, entity, keys = [], params = {}, prisma, req, teamWhere } = {}) {
  const spec = getSpec(buttId);
  if (!spec) {
    return { status: 404, result: { error: 'Unbekannter Button: ' + buttId } };
  }
  if (/^Webhook[0-3]?$/.test(String(buttId))) {
    const map = { Webhook: 'adressen', Webhook1: 'aufgaben', Webhook2: 'notizen', Webhook3: 'termine' };
    const target = map[buttId];
    const rec = await getCurrentRecord({ entity: entity || target, keys, prisma });
    if (!rec) return { status: 404, result: { error: 'Datensatz nicht gefunden' } };
    try { return { status: 200, result: await dispatchWebhook({ prisma, entity: target, record: rec, req }) }; }
    catch (error) { return { status: 502, result: { error: error.message } }; }
  }
  if (buttId === 'New_Button' || buttId === 'New_Button3') {
    const rec = await getCurrentRecord({ entity: entity || 'korrespondenz', keys, prisma, req, teamWhere });
    if (!rec) return { status: 404, result: { error: 'Datensatz nicht gefunden' } };
    try { return { status: 200, result: await sendRecordMail({ prisma, record: rec, req }) }; }
    catch (error) { return { status: 502, result: { error: error.message } }; }
  }
  if (buttId === 'Mails_ziehen1' || buttId === 'Mails_ziehen11') {
    try {
      const result = await importMailMessages({ prisma, target: buttId === 'Mails_ziehen11' ? 'kontaktaufnahme' : 'korrespondenz', messages: Array.isArray(params.messages) ? params.messages : [], req });
      return { status: 200, result: { success: true, ...result } };
    } catch (error) { return { status: 400, result: { error: error.message } }; }
  }
  if (buttId === 'SEPA__berweisung') {
    const rec = await getCurrentRecord({ entity: entity || 'journal', keys, prisma });
    if (!rec) return { status: 404, result: { error: 'Datensatz nicht gefunden' } };
    const accounts = prisma.kontenrahmen;
    const sender = await accounts.findFirst({ where: { ID: Number(rec.Gegenkonto) } });
    const recipient = await accounts.findFirst({ where: { ID: Number(rec.Konto) } });
    try {
      const body = buildSepaTransferXml({
        amount: rec.Betrag, date: rec.Datum, reference: rec.Betreff || rec.Belegnummer,
        senderName: sender?.Kontoinhaber || 'INtex Publishing', senderIban: sender?.IBAN, senderBic: sender?.BIC,
        recipientName: recipient?.Kontoinhaber, recipientIban: recipient?.IBAN, recipientBic: recipient?.BIC,
        messageId: `ueberweisung-${rec.Belegnummer || rec.ID}`,
      });
      return { status: 200, result: { success: true }, body, contentType: 'application/xml; charset=utf-8', filename: `ueberweisung${rec.Belegnummer || rec.ID}.xml` };
    } catch (error) { return { status: 400, result: { error: error.message } }; }
  }
  if (ACCOUNTING_HANDLERS.has(buttId) || ['Immobilien', 'Wohnungswirtschaft', 'SKR03', 'SKR04', 'BKVo1', 'BKVo2', 'Kontrollsummen'].includes(buttId)) {
    try {
      const result = await runAccountingHandler({ buttId, entity, keys, params, prisma, req, teamWhere });
      return { status: 200, result: { success: true, ...result }, redirect: result?.url };
    } catch (error) { return { status: 500, result: { error: error.message } }; }
  }
  if (spec.op === 'manual' || spec.op === 'unrecognised') {
    return {
      status: 501,
      result: {
        error: `Handler '${buttId}' ist noch nicht portiert (Quelle: ${spec.source || 'buttonhandler.php'}).`,
      },
    };
  }

  const ctx = { entity, keys, params, prisma, req, teamWhere };
  switch (spec.op) {
    case 'noop':
      return { status: 200, result: {} };

    case 'constant':
      return { status: 200, result: spec.value ?? {} };

    case 'masterDetailLink': {
      const link = `/${spec.page}?masterkey1=${encodeURIComponent(keys[0] ?? '')}`
        + `&mastertable=${encodeURIComponent(entity || spec.masterTable || '')}`;
      return { status: 200, result: link, redirect: link };
    }

    case 'filterLink': {
      const link = pageToRoute(spec.page || entity, 'list');
      return { status: 200, result: link, redirect: link };
    }

    case 'vcard': {
      const rec = await getCurrentRecord(ctx);
      if (!rec) return { status: 404, result: { error: 'Datensatz nicht gefunden' } };
      return {
        status: 200,
        result: { success: true },
        body: buildVcard(rec),
        contentType: 'text/vcard; charset=utf-8',
        filename: (rec.Nachname || 'kontakt') + '.vcf',
      };
    }

    case 'ical': {
      const rec = await getCurrentRecord(ctx);
      if (!rec) return { status: 404, result: { error: 'Datensatz nicht gefunden' } };
      return {
        status: 200,
        result: { success: true },
        body: buildIcal(rec),
        contentType: 'text/calendar; charset=utf-8',
        filename: 'termin-' + (rec.ID || 'event') + '.ics',
      };
    }

    case 'mailto': {
      const rec = await getCurrentRecord(ctx);
      const addr = (rec && spec.field ? rec[spec.field] : null) || spec.address || '';
      const link = 'mailto:' + addr;
      return { status: 200, result: link, redirect: link };
    }

    case 'recordField': {
      const rec = await getCurrentRecord(ctx);
      if (!rec) return { status: 404, result: { error: 'Datensatz nicht gefunden' } };
      return { status: 200, result: rec[spec.field] ?? null };
    }

    case 'sqlScalar':
    case 'dbLookupScalar': {
      // The compiler guarantees spec.sql has no $params interpolation left;
      // values arrive through `binds` and are bound here.
      const binds = (spec.binds || []).map((b) => {
        if (b.from === 'key') return keys[b.index ?? 0];
        if (b.from === 'param') return params[b.name];
        if (b.from === 'session') return req?.session?.user?.[b.name];
        return b.value ?? null;
      });
      try {
        const rows = await prisma.$queryRawUnsafe(spec.sql, ...binds);
        const first = Array.isArray(rows) ? rows[0] : rows;
        const value = first && typeof first === 'object' ? Object.values(first)[0] : first;
        return { status: 200, result: value ?? null };
      } catch (e) {
        return { status: 500, result: { error: e.message } };
      }
    }

    default:
      return { status: 501, result: { error: `Handler '${buttId}' ist noch nicht portiert.` } };
  }
}

export function resetHandlerCatalogue() {
  _catalogue = null;
}

export default {
  runHandler, getSpec, listHandlers, ops, pageToRoute, numberFormatDe,
  dateToCal, resetHandlerCatalogue,
};
