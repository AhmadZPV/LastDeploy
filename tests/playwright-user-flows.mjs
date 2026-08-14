import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseURL = process.env.PW_BASE_URL || 'http://localhost:3100';
const executablePath = process.env.PW_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifacts = path.resolve('tests', 'playwright-artifacts');
fs.mkdirSync(artifacts, { recursive: true });

const results = [];
const failures = [];
function note(area, name, status, detail = '') {
  const row = { area, name, status, detail };
  results.push(row);
  if (status === 'FAIL') failures.push(row);
  console.log(`${status.padEnd(5)} ${area.padEnd(14)} ${name}${detail ? ' - ' + detail : ''}`);
}

async function check(area, name, fn) {
  try { await fn(); note(area, name, 'PASS'); }
  catch (error) { note(area, name, 'FAIL', String(error.message || error).split('\n')[0]); }
}

async function expectVisible(locator, message) {
  if (!(await locator.first().isVisible())) throw new Error(message || 'Expected visible element');
}

async function login(page) {
  await page.goto(baseURL + '/login');
  await page.locator('[name="Benutzername"]').fill('admin');
  await page.locator('[name="Passwort"]').fill('Online@1234');
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState('networkidle');
  if (new URL(page.url()).pathname !== '/') throw new Error(`Login ended at ${page.url()}`);
}

async function fillIfPresent(page, name, value) {
  const field = page.locator(`[name="${name}"]`).first();
  if (await field.count()) await field.fill(String(value));
}

async function selectFirstValue(page, name) {
  const field = page.locator(`select[name="${name}"]`).first();
  if (!(await field.count())) return;
  const values = await field.locator('option').evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
  if (values[0]) await field.selectOption(values[0]);
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => note('Browser', 'Uncaught page error', 'FAIL', error.message));

let authenticated = false;
await check('Authentication', 'Login as admin', async () => {
  await login(page);
  await expectVisible(page.locator('a[href="/logout"]'), 'Logout link missing after login');
  authenticated = true;
});
if (!authenticated) {
  await browser.close();
  const summary = { generatedAt: new Date().toISOString(), baseURL, total: results.length, pass: 0, fail: failures.length, failures, results };
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
  process.exitCode = 1;
} else {

await check('Navigation', 'Sidebar internal links', async () => {
  const links = await page.locator('.sidebar a[href^="/"]').evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('href')).filter(Boolean))]);
  for (const href of links.slice(0, 80)) {
    const response = await page.request.get(baseURL + href, { maxRedirects: 0 });
    if (response.status() >= 500) throw new Error(`${href} returned ${response.status()}`);
  }
});

await check('Localization', 'English and German switch', async () => {
  await page.goto(baseURL + '/lang/en');
  await page.goto(baseURL + '/');
  await expectVisible(page.getByText('Log out', { exact: true }), 'English chrome missing');
  await page.goto(baseURL + '/lang/de');
});

await check('Validation', 'Required fields show notification', async () => {
  await page.goto(baseURL + '/adressen/new');
  await page.locator('.entity-form button').click();
  await expectVisible(page.locator('.notification-error'), 'Required-field notification missing');
  const text = await page.locator('.notification-error').innerText();
  if (!/Kurzname|Klassifikation/.test(text)) throw new Error('Missing required field names in notification');
});

const unique = `PW-${Date.now()}`;
await check('CRUD', 'Create contact with real form submit', async () => {
  await page.goto(baseURL + '/adressen/new');
  await fillIfPresent(page, 'Kurzname', unique);
  await selectFirstValue(page, 'Klassifikation');
  const classification = page.locator('[name="Klassifikation"]').first();
  if ((await classification.count()) && (await classification.inputValue()) === '') await classification.fill('Mieter');
  await Promise.all([page.waitForURL(/\/adressen(?:\?.*)?$/), page.locator('.entity-form button').click()]);
  await fillIfPresent(page, 'q', unique);
  await page.locator('.search-box button').click();
  await expectVisible(page.getByText(unique, { exact: true }), 'Created contact not visible in list');
});

await check('Search', 'Advanced search submit', async () => {
  await page.goto(baseURL + '/adressen/search');
  await fillIfPresent(page, 'Kurzname', unique);
  await Promise.all([page.waitForURL(/\/adressen$/), page.locator('button[type="submit"]').click()]);
  await expectVisible(page.getByText(unique, { exact: true }), 'Advanced search did not find created contact');
});

await check('CRUD DateTime', 'Create loan with date and time', async () => {
  await page.goto(baseURL + '/ausleihen/new');
  await fillIfPresent(page, 'Titel', unique + '-loan');
  await fillIfPresent(page, 'Startdatum', '2026-08-14');
  await fillIfPresent(page, 'Startzeit', '2026-08-14');
  await fillIfPresent(page, 'Enddatum', '2026-08-15');
  await fillIfPresent(page, 'Endzeit', '2026-08-15');
  await page.locator('.entity-form button').click();
  await page.waitForLoadState('networkidle');
  if ((await page.locator('body').innerText()).includes('Invalid `prisma.')) throw new Error('Prisma DateTime error after loan submit');
});

await check('CRUD DateTime', 'Edit task date', async () => {
  await page.goto(baseURL + '/aufgaben');
  const edit = page.locator('a[href^="/aufgaben/"][href$="/edit"]').first();
  await expectVisible(edit, 'No task edit link');
  await edit.click();
  await fillIfPresent(page, 'Datum', '2026-08-15');
  await page.locator('.entity-form button').click();
  await page.waitForLoadState('networkidle');
  if ((await page.locator('body').innerText()).includes('Invalid `prisma.')) throw new Error('Prisma DateTime error after task update');
});

await check('Interaction', 'Search hover and focus contrast', async () => {
  await page.goto(baseURL + '/adressen');
  const input = page.locator('.search-box input').first();
  await input.hover();
  await input.focus();
  const style = await input.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor, placeholder: getComputedStyle(el, '::placeholder').color };
  });
  if (style.color === style.background) throw new Error(`Text and background match: ${JSON.stringify(style)}`);
  await page.screenshot({ path: path.join(artifacts, 'search-focus-desktop.png'), fullPage: true });
});

await check('Analytics', 'Dashboards and charts render', async () => {
  for (const href of ['/dashboard/heute', '/dashboard/immobilien_diagramme', '/chart/Leerstandsquote']) {
    const response = await page.goto(baseURL + href);
    if (!response || response.status() >= 500) throw new Error(`${href} failed`);
    const text = await page.locator('body').innerText();
    if (/Something went wrong|Es ist ein Fehler aufgetreten|Invalid `prisma\./.test(text)) throw new Error(`${href} rendered an application error`);
  }
});

await check('Export', 'CSV download works', async () => {
  await page.goto(baseURL + '/adressen');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('a[href$="export.csv"]').click()]);
  if (!(await download.suggestedFilename()).endsWith('.csv')) throw new Error('CSV filename missing');
});

await check('Responsive', 'Mobile navigation and no horizontal body overflow', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p = await mobile.newPage();
  await login(p);
  await p.locator('[data-nav-toggle]').click();
  await expectVisible(p.locator('#sidebar'), 'Sidebar did not open on mobile');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) throw new Error('Page has horizontal viewport overflow');
  await p.screenshot({ path: path.join(artifacts, 'dashboard-mobile.png'), fullPage: true });
  await mobile.close();
});

await page.goto(baseURL + '/logout');
}
await browser.close();

const summary = {
  generatedAt: new Date().toISOString(), baseURL,
  total: results.length, pass: results.filter((r) => r.status === 'PASS').length,
  fail: failures.length, failures, results,
};
fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('\n' + JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;
