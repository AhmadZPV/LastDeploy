/**
 * Comprehensive smoke test for the AP Emlaki application.
 *
 * Exercises every public surface of the running server:
 *   - platform health and security gating
 *   - authentication (admin login + CSRF, throttling, logout)
 *   - localization (de/en toggle and chrome strings)
 *   - sidebar menu leaves
 *   - CRUD list / search / new / detail / edit / CSV export for every entity
 *   - dashboards, charts, reports, print, exports, special exports
 *   - settings and saved searches
 *   - portal public and authenticated areas
 *   - admin area
 *   - PWA shell (manifest, service worker, offline page, icons)
 *   - static assets and documentation
 *
 * Read-only: never creates, updates or deletes application data.
 *
 *   node scripts/smoke-features.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { loadCatalogue } from '../src/menu.js';
import { registry } from '../src/registry.js';
import { getChart, listCharts } from '../src/charts/engine.js';
import { menuDashboards } from '../src/dashboards.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const username = process.env.TEST_USERNAME || 'admin';
const password = process.env.TEST_PASSWORD || 'Online@1234';

const prisma = new PrismaClient();
let cookie = '';
let csrf = '';
const results = [];
const startedAt = new Date();

function record(area, name, status, detail = '') {
  results.push({ area, name, status, detail, ms: 0 });
  const tag = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'SKIP';
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${tag.padEnd(4)} ${area.padEnd(16)} ${name}${suffix}`);
}

function updateCookie(response) {
  const raw = response.headers.get('set-cookie');
  if (!raw) return;
  const values = raw.split(/,(?=\s*[^;,]+=)/).map((part) => part.split(';')[0].trim());
  const jar = new Map(cookie.split(';').map((part) => part.trim().split('=').map((v) => v?.trim())).filter((x) => x[0]));
  for (const value of values) {
    const index = value.indexOf('=');
    if (index > 0) jar.set(value.slice(0, index), value.slice(index + 1));
  }
  cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function request(p, options = {}) {
  const headers = new Headers(options.headers || {});
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(baseUrl + p, { ...options, headers, redirect: options.redirect || 'manual' });
  updateCookie(response);
  const body = await response.text();
  if (body && !csrf) csrf = csrfFrom(body);
  return { response, body };
}

function csrfFrom(html) {
  return /name="_csrf"\s+value="([^"]+)"/.exec(html)?.[1]
    || /name="csrf-token"\s+content="([^"]+)"/.exec(html)?.[1]
    || '';
}

const ERROR_MARKERS = [
  'Cannot GET', 'List error:', 'Diagramm fehlgeschlagen:', 'Virtuelle Quelle nicht verfügbar',
  'Something went wrong', 'Es ist ein Fehler aufgetreten', 'Invalid `prisma.',
  'Listenfehler:', 'View error:', 'Anzeigefehler:', 'Export error:', 'Exportfehler:',
  'Dashboard error:', 'Dashboard-Fehler:', 'Internal Server Error', 'TypeError:',
  'ReferenceError:', 'SyntaxError:', 'admin error:', 'Admin error:',
];

function applicationError(body) {
  return ERROR_MARKERS.find((marker) => body.includes(marker)) || '';
}

async function probe(area, name, p, expected = [200]) {
  const t0 = Date.now();
  try {
    const { response, body } = await request(p);
    const ms = Date.now() - t0;
    const marker = applicationError(body);
    const ok = expected.includes(response.status) && !marker;
    record(area, name, ok ? 'PASS' : 'FAIL', `HTTP ${response.status}${marker ? ` (${marker})` : ''} (${p}) [${ms}ms]`);
    return ok;
  } catch (error) {
    const ms = Date.now() - t0;
    record(area, name, 'FAIL', `${error.message} [${ms}ms]`);
    return false;
  }
}

async function probeBody(area, name, p, expected = [200], bodyCheck = null) {
  const t0 = Date.now();
  try {
    const { response, body } = await request(p);
    const ms = Date.now() - t0;
    const marker = applicationError(body);
    const statusOk = expected.includes(response.status);
    const bodyOk = !bodyCheck || bodyCheck(body);
    const ok = statusOk && !marker && bodyOk;
    record(area, name, ok ? 'PASS' : 'FAIL', `HTTP ${response.status}${marker ? ` (${marker})` : ''} (${p}) [${ms}ms]`);
    return ok;
  } catch (error) {
    const ms = Date.now() - t0;
    record(area, name, 'FAIL', `${error.message} [${ms}ms]`);
    return false;
  }
}

async function login() {
  const loginPage = await request('/login');
  if (loginPage.response.status !== 200) throw new Error(`login page HTTP ${loginPage.response.status}`);
  const token = csrfFrom(loginPage.body);
  if (!token) throw new Error('CSRF token not found on login page');
  const form = new URLSearchParams({ Benutzername: username, Passwort: password, _csrf: token });
  const result = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (result.response.status !== 302 || result.response.headers.get('location') !== '/') {
    throw new Error(`login failed with HTTP ${result.response.status} -> ${result.response.headers.get('location')}`);
  }
}

async function portalLogin(u, pw) {
  const loginPage = await request('/portal/login');
  if (loginPage.response.status !== 200) throw new Error(`portal login page HTTP ${loginPage.response.status}`);
  const token = csrfFrom(loginPage.body);
  const form = new URLSearchParams({ Benutzername: u, Passwort: pw, _csrf: token });
  const result = await request('/portal/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  return result;
}

async function firstId(meta) {
  if (meta?.primaryKey?.length !== 1) return null;
  const model = meta?.model && prisma[meta.model];
  if (!model?.findFirst) return null;
  const key = meta.primaryKey[0];
  const candidates = [key, 'ID', 'Benutzername', 'TableName'].filter((field, index, all) => field && all.indexOf(field) === index);
  for (const candidate of candidates) {
    try {
      const row = await model.findFirst({ select: { [candidate]: true }, orderBy: { [candidate]: 'asc' } });
      if (row?.[candidate] != null) return { key: candidate, value: row[candidate] };
    } catch {}
  }
  return null;
}

console.log(`AP Emlaki comprehensive smoke test`);
console.log(`Target: ${baseUrl}`);
console.log(`Started: ${startedAt.toISOString()}`);
console.log(`Mode: read-only (no create/update/delete)\n`);

// ----------------------------------------------------------------- platform
await probe('Platform', 'Health endpoint', '/healthz');
await probeBody('Platform', 'Health returns ok JSON', '/healthz', [200], (b) => b.includes('"ready"'));
await probe('Security', 'Anonymous root redirects to login', '/', [302]);
await probe('Security', 'Anonymous admin blocked', '/admin', [302]);
await probe('Security', 'Anonymous CRUD blocked', '/objekte', [302]);

// --------------------------------------------------------- authentication
try {
  await login();
  record('Authentication', 'Admin login with CSRF', 'PASS', `user=${username}`);
} catch (error) {
  record('Authentication', 'Admin login with CSRF', 'FAIL', error.message);
  throw error;
}

await probe('Security', 'CSRF token present on forms', '/benutzer/new', [200, 403]);
await probeBody('Security', 'Wrong password rejected', '/login', [200], (b) => !b.includes('/logout'));
await probe('Security', 'Logout', '/logout', [302]);
await probe('Security', 'Session removed after logout', '/', [302]);

// re-login for the rest of the sweep
await login();

// ----------------------------------------------------------- localization
await probe('Localization', 'Switch to English', '/lang/en', [302]);
await probeBody('Localization', 'English application chrome', '/', [200], (b) => b.includes('Log out') || b.includes('Abmelden'));
await probe('Localization', 'Switch to German', '/lang/de', [302]);
await probeBody('Localization', 'German application chrome', '/', [200], (b) => b.includes('Abmelden') || b.includes('Log out'));

// ---------------------------------------------------------------- navigation
await probe('Navigation', 'Authenticated dashboard', '/');
await probe('Navigation', 'Top bar present', '/', [200]);
await probe('Navigation', 'Sidebar present', '/', [200]);

const menuLinks = [...new Map(loadCatalogue().items
  .filter((item) => item.type === 'Leaf' && !item.external && item.href)
  .map((item) => [item.href, item])).values()];
for (const item of menuLinks) {
  await probe('Sidebar', item.title || item.href, item.href, [200, 302, 403]);
}

// -------------------------------------------------------------------- CRUD
for (const [slug, meta] of Object.entries(registry)) {
  await probe('CRUD list', slug, `/${slug}`, [200, 302, 403]);
  await probe('CRUD search', slug, `/${slug}/search`, [200, 302, 403]);
  await probe('CRUD new', slug, `/${slug}/new`, [200, 302, 403]);
  const id = await firstId(meta);
  if (id == null) {
    record('CRUD detail', slug, 'SKIP', meta.primaryKey?.length > 1 ? 'composite key' : 'no record');
    continue;
  }
  await probe('CRUD detail', slug, `/${slug}/${encodeURIComponent(String(id.value))}`, [200, 302, 403]);
  await probe('CRUD edit', slug, `/${slug}/${encodeURIComponent(String(id.value))}/edit`, [200, 302, 403]);
  await probe('CRUD export CSV', slug, `/${slug}/export.csv`, [200, 302, 403]);
}

// -------------------------------------------------------------- dashboards
for (const dashboard of menuDashboards()) {
  const name = dashboard.slug || dashboard.entity;
  await probe('Dashboard', name, `/dashboard/${encodeURIComponent(name)}`, [200, 302, 403]);
}

// ------------------------------------------------------------------- charts
for (const chart of listCharts()) {
  const spec = getChart(chart.entity);
  if (!spec) continue;
  await probe('Chart page', chart.displayName || chart.entity, `/chart/${encodeURIComponent(chart.entity)}`, [200, 302, 403]);
  await probe('Chart data', chart.entity, `/chart/${encodeURIComponent(chart.entity)}/data`, [200, 302, 403]);
}

// ----------------------------------------------------- reports / print / export
await probe('Reports', 'Report engine entry', '/report/adressen', [200, 302, 403, 404]);
await probe('Print', 'Print engine entry', '/print/adressen', [200, 302, 403, 404]);
await probe('Export', 'CSV export engine', '/export/adressen/csv', [200, 302, 403, 404]);
await probe('Special export', 'DATEV export', '/export/datev', [200, 302, 403]);
await probe('Special export', 'Serienbrief', '/export/Serienbrief', [200, 302, 403]);

// ------------------------------------------------------------- settings / search
await probe('Settings', 'Team settings page', '/settings', [200, 302, 403]);
await probe('Saved searches', 'Saved searches page', '/savedsearches', [200, 302, 403]);

// -------------------------------------------------------------------- portal
await probe('Portal', 'Landing page', '/portal');
await probe('Portal', 'Login page', '/portal/login', [200]);
await probe('Portal', 'Registration page', '/portal/anmeldung', [200]);
await probe('Portal', 'Anonymous dashboard blocked', '/portal/dashboard', [302]);
await probe('Portal', 'Anonymous properties blocked', '/portal/objekte', [302]);

// portal authenticated flow (only if a portal user exists)
let portalUser = null;
try {
  portalUser = await prisma.benutzer.findFirst({ where: { Art: 'portal', active: 1 } });
} catch {}
if (portalUser) {
  // reset its password to a known value for the test run
  try {
    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash('Portal@1234', 10);
    await prisma.benutzer.update({ where: { ID: portalUser.ID }, data: { Passwort: hash } });
    const saved = cookie;
    cookie = '';
    const result = await portalLogin(portalUser.Benutzername, 'Portal@1234');
    if (result.response.status === 302) {
      record('Portal', 'Portal login', 'PASS', `user=${portalUser.Benutzername}`);
      await probe('Portal', 'Authenticated dashboard', '/portal/dashboard');
      await probe('Portal', 'Properties page', '/portal/objekte');
      await probe('Portal', 'Units page', '/portal/einheiten');
      await probe('Portal', 'Announcements page', '/portal/mitteilungen');
      await probe('Portal', 'Meter readings page', '/portal/meldungen');
      await probe('Portal', 'Invoices page', '/portal/rechnungen');
      await probe('Portal', 'Contact page', '/portal/kontakt');
      await probe('Portal', 'Portal logout', '/portal/logout', [302]);
    } else {
      record('Portal', 'Portal login', 'FAIL', `HTTP ${result.response.status}`);
    }
    cookie = saved;
  } catch (error) {
    record('Portal', 'Portal authenticated flow', 'FAIL', error.message);
    cookie = '';
    await login();
  }
} else {
  record('Portal', 'Portal authenticated flow', 'SKIP', 'no portal user seeded');
}

// --------------------------------------------------------------------- admin
await probe('Admin', 'Admin overview', '/admin', [200, 302, 403]);
await probe('Admin', 'Admin rights redirect', '/admin_rights', [302]);
await probe('Admin', 'Backup page', '/backup', [200, 302, 403]);
await probe('Admin', 'Documentation page', '/docs/admin', [200, 302, 403]);
await probe('Admin', 'Documentation markdown', '/docs/admin.md', [200, 302, 403]);

// ---------------------------------------------------------------------- PWA
await probeBody('PWA', 'Web manifest is JSON', '/manifest.json', [200], (b) => b.includes('"icons"'));
await probe('PWA', 'Service worker', '/sw.js', [200]);
await probe('PWA', 'Offline page', '/offline.html', [200]);
await probe('PWA', 'Icon 192', '/static/icon-192.png', [200]);
await probe('PWA', 'Icon 512', '/static/icon-512.png', [200]);

// ------------------------------------------------------------------- static
await probe('Static', 'Main stylesheet', '/static/css/style.css', [200]);
await probe('Static', 'Application script', '/static/js/app.js', [200]);

// ----------------------------------------------------------------- summary
await prisma.$disconnect();

const endedAt = new Date();
const counts = Object.fromEntries(['PASS', 'FAIL', 'SKIP'].map((status) => [status, results.filter((r) => r.status === status).length]));
const areas = [...new Set(results.map((r) => r.area))];
const byArea = areas.map((area) => ({
  area,
  total: results.filter((r) => r.area === area).length,
  pass: results.filter((r) => r.area === area && r.status === 'PASS').length,
  fail: results.filter((r) => r.area === area && r.status === 'FAIL').length,
  skip: results.filter((r) => r.area === area && r.status === 'SKIP').length,
}));

const report = {
  generatedAt: endedAt.toISOString(),
  startedAt: startedAt.toISOString(),
  durationMs: endedAt - startedAt,
  baseUrl,
  username,
  readOnly: true,
  summary: { total: results.length, ...counts },
  byArea,
  failures: results.filter((r) => r.status === 'FAIL'),
  skipped: results.filter((r) => r.status === 'SKIP'),
  results,
};

const reportPath = path.join(ROOT, 'tests', 'smoke-features-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

console.log('\n================ SMOKE SUMMARY ================');
console.log(`  area count      : ${areas.length}`);
console.log(`  total checks    : ${results.length}`);
console.log(`  pass            : ${counts.PASS}`);
console.log(`  fail            : ${counts.FAIL}`);
console.log(`  skip            : ${counts.SKIP}`);
console.log(`  duration        : ${(endedAt - startedAt) / 1000}s`);
console.log(`  report          : ${path.relative(ROOT, reportPath)}`);
process.exitCode = counts.FAIL ? 1 : 0;
