import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import { loadCatalogue } from '../src/menu.js';
import { registry } from '../src/registry.js';
import { getChart, listCharts } from '../src/charts/engine.js';
import { menuDashboards } from '../src/dashboards.js';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const username = process.env.TEST_USERNAME || 'admin';
const password = process.env.TEST_PASSWORD || 'Online@1234';
const prisma = new PrismaClient();
let cookie = '';
const results = [];

function record(area, name, status, detail = '') {
  results.push({ area, name, status, detail });
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status.padEnd(4)} ${area.padEnd(14)} ${name}${suffix}`);
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

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(baseUrl + path, { ...options, headers, redirect: options.redirect || 'manual' });
  updateCookie(response);
  const body = await response.text();
  return { response, body };
}

function csrfFrom(html) {
  return /name="_csrf"\s+value="([^"]+)"/.exec(html)?.[1]
    || /name="csrf-token"\s+content="([^"]+)"/.exec(html)?.[1]
    || '';
}

function applicationError(body) {
  const markers = [
    'Cannot GET', 'List error:', 'Diagramm fehlgeschlagen:', 'Virtuelle Quelle nicht verfügbar',
    'Something went wrong', 'Es ist ein Fehler aufgetreten', 'Invalid `prisma.',
    'Listenfehler:', 'View error:', 'Anzeigefehler:', 'Export error:', 'Exportfehler:',
    'Dashboard error:', 'Dashboard-Fehler:', 'Internal Server Error',
  ];
  return markers.find((marker) => body.includes(marker)) || '';
}

async function probe(area, name, path, expected = [200]) {
  try {
    const { response, body } = await request(path);
    const marker = applicationError(body);
    if (!expected.includes(response.status) || marker) {
      record(area, name, 'FAIL', `HTTP ${response.status}${marker ? `, ${marker}` : ''} (${path})`);
      return false;
    }
    record(area, name, 'PASS', `HTTP ${response.status}`);
    return true;
  } catch (error) {
    record(area, name, 'FAIL', error.message);
    return false;
  }
}

async function login() {
  const loginPage = await request('/login');
  const csrf = csrfFrom(loginPage.body);
  if (loginPage.response.status !== 200 || !csrf) throw new Error('Login page or CSRF token unavailable');
  const form = new URLSearchParams({ Benutzername: username, Passwort: password, _csrf: csrf });
  const result = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (result.response.status !== 302 || result.response.headers.get('location') !== '/') {
    throw new Error(`Login failed with HTTP ${result.response.status}`);
  }
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

console.log(`Feature verification: ${baseUrl}`);
console.log('Read-only mode: no create, update or delete operations are executed.\n');

await probe('Platform', 'Health endpoint', '/healthz');
await probe('Security', 'Anonymous dashboard protection', '/', [302]);

try {
  await login();
  record('Authentication', 'Admin login with CSRF', 'PASS');
} catch (error) {
  record('Authentication', 'Admin login with CSRF', 'FAIL', error.message);
  await prisma.$disconnect();
  process.exitCode = 1;
  throw error;
}

await probe('Navigation', 'Authenticated dashboard', '/');
await probe('Localization', 'Switch to English', '/lang/en', [302]);
const english = await request('/');
record('Localization', 'English application chrome',
  english.response.status === 200 && english.body.includes('Erwin Property Mgmt') && english.body.includes('Log out')
    ? 'PASS' : 'FAIL');
await probe('Localization', 'Switch to German', '/lang/de', [302]);

const menuLinks = [...new Map(loadCatalogue().items
  .filter((item) => item.type === 'Leaf' && !item.external && item.href)
  .map((item) => [item.href, item])).values()];
for (const item of menuLinks) {
  await probe('Sidebar', item.title || item.href, item.href, [200, 302, 403]);
}

for (const [slug, meta] of Object.entries(registry)) {
  await probe('CRUD', `${slug} list`, `/${slug}`);
  await probe('CRUD', `${slug} search form`, `/${slug}/search`);
  await probe('CRUD', `${slug} add form`, `/${slug}/new`, [200, 403]);
  const id = await firstId(meta);
  if (id == null) {
    record('CRUD', `${slug} record workflow`, 'SKIP', meta.primaryKey?.length > 1 ? 'Composite primary key uses dedicated workflow' : 'No record available');
    continue;
  }
  await probe('CRUD', `${slug} detail`, `/${slug}/${encodeURIComponent(String(id.value))}`, [200, 403]);
  await probe('CRUD', `${slug} edit form`, `/${slug}/${encodeURIComponent(String(id.value))}/edit`, [200, 403]);
  await probe('Export', `${slug} CSV`, `/${slug}/export.csv`, [200, 403]);
}

for (const dashboard of menuDashboards()) {
  const name = dashboard.slug || dashboard.entity;
  await probe('Dashboard', name, `/dashboard/${encodeURIComponent(name)}`, [200, 403]);
}

for (const chart of listCharts()) {
  const spec = getChart(chart.entity);
  if (!spec) continue;
  await probe('Chart', chart.displayName || chart.entity, `/chart/${encodeURIComponent(chart.entity)}`, [200, 403]);
  await probe('Chart data', chart.entity, `/chart/${encodeURIComponent(chart.entity)}/data`, [200, 403]);
}

await probe('PWA', 'Web manifest', '/manifest.json');
await probe('PWA', 'Service worker', '/sw.js');
await probe('PWA', 'Offline page', '/offline.html');
await probe('Security', 'Logout', '/logout', [302]);
await probe('Security', 'Session removed after logout', '/', [302]);

await prisma.$disconnect();
const counts = Object.fromEntries(['PASS', 'FAIL', 'SKIP'].map((status) => [status, results.filter((r) => r.status === status).length]));
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  readOnly: true,
  summary: { total: results.length, ...counts },
  failures: results.filter((result) => result.status === 'FAIL'),
  skipped: results.filter((result) => result.status === 'SKIP'),
  results,
};
fs.writeFileSync(new URL('../tests/feature-verification-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log('\nFeature verification summary');
console.log(JSON.stringify({ total: results.length, ...counts }, null, 2));
console.log('Report: tests/feature-verification-report.json');
if (counts.FAIL) process.exitCode = 1;
